'use strict';
// The Discord bot: logs sign ins, warns about cheaters with the reason, and answers the slash commands in botcommands.js.
//
// It talks to Discord directly (its gateway for the commands, its web API for everything said back), with nothing to
// install. It only needs to be invited to one server and given the channels to write in. Without a token it stays off and
// the game server runs as ever. If Discord is down the game doesn't notice: the bot just keeps trying to reconnect.
//
// Only the Discord accounts listed in DISCORD_BOT_ADMINS can use a command. Discord's own permissions are not relied on:
// this is checked here, on every single command and button.
const { WebSocket } = require('../vendor/ws');
const crypto = require('node:crypto');
const { COMMANDS, runCommand, runButton, runModal, suggest, playerLine } = require('./botcommands');

const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const MAX_QUEUE = 500;
const EPHEMERAL = 64;
const NO_RETRY = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const COLOR = { info: 0x3ff0d0, good: 0x4cd964, warn: 0xffb020, bad: 0xff3b5c, ban: 0xb0202c };

// Names come from players. They can't be allowed to format messages, ping people or pretend to be something else.
const esc = (s) => String(s == null ? '' : s).replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/([\\`*_~|>#@:[\]()-])/g, '\\$1').slice(0, 300);
const code = (s) => String(s == null ? '' : s).replace(/[`\s]/g, '').slice(0, 80);
const when = (t) => (t ? `<t:${Math.floor(t / 1000)}:R>` : 'never');
const ids = (s) => String(s || '').split(',').map((x) => x.trim()).filter((x) => /^\d{5,25}$/.test(x));

class Bot {
  constructor(cfg, services) {
    this.token = cfg.token;
    this.guild = cfg.guild;
    this.logChannel = cfg.logChannel;
    this.warnChannel = cfg.warnChannel || cfg.logChannel;
    this.admins = new Set(ids(cfg.admins));
    this.api = cfg.api || API;
    this.gatewayUrl = cfg.gateway || GATEWAY;
    this.s = services;
    this.ws = null;
    this.seq = null;
    this.session = null;
    this.resumeUrl = null;
    this.appId = null;
    this.ready = false;
    this.stopped = false;
    this.backoff = 2000;
    this.queue = [];
    this.sending = false;
    this.user = '';
    this.connectedAt = 0;
    this.lastError = '';
  }

  get on() { return !!this.token; }

  start() {
    if (!this.on) return;
    this.connect();
    const a = this.s.admin;
    a.notify.signin = (o) => this.logSignIn(o);
    a.notify.flag = (o) => this.logFlag(o);
    a.notify.ban = (o) => this.logBan(o);
    a.notify.unban = (o) => this.logUnban(o);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.beat);
    clearTimeout(this.again);
    if (this.ws) { try { this.ws.close(1000); } catch (e) {} }
  }

  // ---------------------------------------------------------------- the gateway
  connect() {
    if (this.stopped) return;
    let ws;
    try {
      ws = this.ws = new WebSocket(this.resumeUrl && this.session ? `${this.resumeUrl}/?v=10&encoding=json` : this.gatewayUrl, { perMessageDeflate: false, handshakeTimeout: 15000 });
    } catch (e) {
      return this.retry(e.message);
    }
    ws.on('message', (d) => { try { this.onGateway(JSON.parse(d.toString())); } catch (e) { console.error('bot:', e.message); } });
    ws.on('error', (e) => { this.lastError = e.message; });
    ws.on('close', (code) => {
      clearInterval(this.beat);
      this.ready = false;
      if (this.stopped) return;
      if (NO_RETRY.has(code)) {
        this.lastError = code === 4004 ? 'Discord refused the bot token.' : `Discord refused the bot (code ${code}).`;
        console.error(`bot: ${this.lastError} Fix it with install.sh --bot.`);
        return;
      }
      this.retry(`closed ${code}`);
    });
  }
  retry(why) {
    this.lastError = why;
    clearTimeout(this.again);
    this.again = setTimeout(() => this.connect(), this.backoff);
    this.again.unref();
    this.backoff = Math.min(this.backoff * 2, 120000);
  }
  sendGateway(o) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o)); }

  onGateway(m) {
    if (m.s !== null && m.s !== undefined) this.seq = m.s;
    switch (m.op) {
      case 10: {
        clearInterval(this.beat);
        this.acked = true;
        this.beat = setInterval(() => {
          // No answer to the last one means the line is dead, whatever the socket thinks.
          if (!this.acked) { try { this.ws.terminate(); } catch (e) {} return; }
          this.acked = false;
          this.sendGateway({ op: 1, d: this.seq });
        }, m.d.heartbeat_interval);
        this.beat.unref();
        if (this.session) this.sendGateway({ op: 6, d: { token: this.token, session_id: this.session, seq: this.seq } });
        else this.sendGateway({ op: 2, d: { token: this.token, intents: 0, properties: { os: 'linux', browser: 'stickmanup', device: 'stickmanup' } } });
        break;
      }
      case 11: this.acked = true; break;
      case 1: this.sendGateway({ op: 1, d: this.seq }); break;
      case 7: this.ws.close(4000); break;
      case 9:
        if (!m.d) { this.session = null; this.seq = null; this.resumeUrl = null; }
        this.ws.close(4000);
        break;
      case 0:
        if (m.t === 'READY') {
          this.session = m.d.session_id;
          this.resumeUrl = m.d.resume_gateway_url;
          this.appId = m.d.application && m.d.application.id;
          this.user = m.d.user ? m.d.user.username : '';
          this.ready = true;
          this.backoff = 2000;
          this.connectedAt = Date.now();
          console.log(`bot: connected as ${this.user}, ${this.admins.size} admin(s) allowed`);
          this.register().catch((e) => { this.lastError = e.message; console.error('bot: could not set up the commands:', e.message); });
        } else if (m.t === 'RESUMED') {
          this.ready = true;
          this.backoff = 2000;
        } else if (m.t === 'INTERACTION_CREATE') {
          this.onInteraction(m.d).catch((e) => console.error('bot: command failed:', e.message));
        }
        break;
    }
  }

  // The commands only change with a new version of the server, and Discord doesn't like being told again and again.
  async register() {
    if (!this.appId || !this.guild) return;
    const text = JSON.stringify(COMMANDS), h = crypto.createHash('sha256').update(text + this.guild + this.appId).digest('hex').slice(0, 16);
    if (this.s.db.setting('botCommands') === h) return;
    const r = await this.rest('PUT', `/applications/${this.appId}/guilds/${this.guild}/commands`, COMMANDS);
    if (r && r.ok) {
      this.s.db.setSetting('botCommands', h);
      console.log(`bot: ${COMMANDS.length} commands set up`);
    } else throw new Error(`Discord answered ${r ? r.status : 'nothing'}. Is the bot invited to that server, and is the server ID right?`);
  }

  // ---------------------------------------------------------------- saying things
  async rest(method, url, body) {
    for (let k = 0; k < 4; k++) {
      let r;
      try {
        r = await fetch(this.api + url, { method, headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': 'StickManUpServer (https://github.com/TheOCP/stickmanup, 1)' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      } catch (e) {
        this.lastError = e.message;
        await new Promise((f) => setTimeout(f, 1500 * (k + 1)));
        continue;
      }
      if (r.status !== 429) return r;
      let wait = 2;
      try { wait = (await r.json()).retry_after || 2; } catch (e) {}
      await new Promise((f) => setTimeout(f, Math.min(60, wait) * 1000 + 100));
    }
    return null;
  }
  // In order, one at a time, and it never grows without end when Discord is away.
  post(channel, msg) {
    if (!channel || !this.on) return;
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push({ channel, msg });
    this.pump();
  }
  async pump() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length && !this.stopped) {
        const { channel, msg } = this.queue.shift();
        const r = await this.rest('POST', `/channels/${channel}/messages`, Object.assign({ allowed_mentions: { parse: [] } }, msg));
        if (r && !r.ok) { this.lastError = `Discord answered ${r.status} when writing in channel ${channel}. Can the bot see that channel and write in it?`; console.error('bot: ' + this.lastError); }
      }
    } finally {
      this.sending = false;
    }
  }
  log(title, text, color = COLOR.info) { this.post(this.logChannel, { embeds: [{ title, description: text, color, timestamp: new Date().toISOString() }] }); }

  // ---------------------------------------------------------------- logging
  logSignIn(o) {
    if (o.provider === 'guest' && !this.s.admin.logGuests) return;
    const u = o.user;
    this.log(o.isNew ? (o.provider === 'guest' ? 'New guest' : 'New player') : 'Sign in', `**${esc(u.name)}** #${u.num}\nWith: ${esc(o.provider)}\nIP: \`${code(o.ip)}\`\nID: \`${u.id}\``, o.isNew ? COLOR.good : COLOR.info);
  }
  logFlag(o) {
    const u = o.user, watching = o.mode !== 'enforce' || u.trusted;
    const lines = [`**${esc(playerLine(u))}**`, esc(o.detail), `Kind: ${esc(o.kind)}. This counts ${o.score}, total now ${o.total} of ${this.s.admin.banScore}.`, watching ? (u.trusted ? 'This player is trusted, so nothing was done.' : 'The anticheat is only watching, so nothing was done.') : 'Coins from this climb have stopped.'];
    this.post(this.warnChannel, {
      embeds: [{ title: 'Possible cheater', description: lines.join('\n'), color: COLOR.warn, timestamp: new Date().toISOString() }],
      components: [{ type: 1, components: [
        { type: 2, style: 4, label: 'Ban', custom_id: `ac:ban:${u.id}` },
        { type: 2, style: 2, label: 'Player', custom_id: `ac:info:${u.id}` },
        { type: 2, style: 3, label: 'Not a cheat, clear', custom_id: `ac:clear:${u.id}` },
      ] }],
    });
  }
  logBan(o) {
    const target = o.user ? playerLine(o.user) : o.ip ? 'address ' + o.ip : 'a device';
    this.post(this.warnChannel, { embeds: [{ title: 'Banned', description: `**${esc(target)}**\nReason: ${esc(o.reason)}\nBy: ${esc(o.by)}\n${o.until ? 'Until ' + when(o.until) : 'For good'}${o.ip && o.user ? `\nAlso their address: \`${code(o.ip)}\`` : ''}${o.device && o.user ? '\nAlso their phone' : ''}`, color: COLOR.ban, timestamp: new Date().toISOString() }] });
  }
  logUnban(o) {
    const target = o.user ? playerLine(o.user) : o.ip ? 'address ' + o.ip : 'a device';
    this.post(this.warnChannel, { embeds: [{ title: 'Unbanned', description: `**${esc(target)}**\nBy: ${esc(o.by)}${o.reason ? `\nReason: ${esc(o.reason)}` : ''}`, color: COLOR.good, timestamp: new Date().toISOString() }] });
  }

  // ---------------------------------------------------------------- commands
  answer(i, type, data) {
    return this.rest('POST', `/interactions/${i.id}/${i.token}/callback`, { type, data });
  }
  say(i, text, o = {}) {
    const d = { flags: o.public ? 0 : EPHEMERAL, allowed_mentions: { parse: [] }, embeds: [{ description: String(text).slice(0, 4000), color: COLOR[o.color || 'info'] }] };
    if (o.components) d.components = o.components;
    return this.answer(i, 4, d);
  }

  async onInteraction(i) {
    const who = (i.member && i.member.user) || i.user || {};
    // Autocomplete shows names, so it is for admins too.
    const allowed = this.admins.has(String(who.id)) && (!this.guild || String(i.guild_id) === String(this.guild));
    const whoName = `${who.username || 'someone'} (${who.id})`;
    if (i.type === 4) {
      if (!allowed) return this.answer(i, 8, { choices: [] });
      return this.answer(i, 8, { choices: suggest(this.s, i.data) });
    }
    if (!allowed) {
      console.log(`bot: refused ${whoName}`);
      this.log('Refused', `${esc(whoName)} tried to use the bot and is not on the list.`, COLOR.warn);
      return this.say(i, this.admins.size ? 'You are not allowed to use this.' : 'Nobody is allowed to use the bot yet. Add Discord user IDs with: install.sh --bot', { color: 'bad' });
    }
    const ctx = {
      s: this.s, bot: this, who: whoName, whoShort: who.username || String(who.id),
      reply: (text, o) => this.say(i, text, o),
      modal: (d) => this.answer(i, 9, d),
      // Something that can take a while: say so first, then answer.
      slow: async (fn) => {
        await this.answer(i, 5, { flags: EPHEMERAL });
        const text = await fn();
        return this.rest('PATCH', `/webhooks/${this.appId}/${i.token}/messages/@original`, { allowed_mentions: { parse: [] }, embeds: [{ description: String(text).slice(0, 4000), color: COLOR.info }] });
      },
    };
    if (i.type === 2) return runCommand(ctx, i.data);
    if (i.type === 3) return runButton(ctx, i.data.custom_id);
    if (i.type === 5) return runModal(ctx, i.data);
    return undefined;
  }

  status() {
    if (!this.on) return { on: false };
    return { on: true, ready: this.ready, user: this.user, since: this.connectedAt, admins: this.admins.size, commands: COMMANDS.length, queue: this.queue.length, error: this.lastError };
  }
}

module.exports = { Bot, esc, when, ids, COLOR };
