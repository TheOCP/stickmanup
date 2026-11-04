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
const { COMMANDS, runCommand, runButton, runModal, suggest, playerLine, parseBang, didYouMean } = require('./botcommands');
const { Community } = require('./community');

const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const MAX_QUEUE = 500;
const EPHEMERAL = 64;
const NO_RETRY = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
// Guild messages and their text, for the ! commands and the tickets, and members joining and leaving. Each needs a switch in
// Discord's developer portal. If one is off Discord refuses the whole connection without saying which, so it tries less until it works.
const MESSAGE_INTENTS = (1 << 9) | (1 << 15);
const MEMBER_INTENTS = 1 << 1;
const INTENT_TRIES = [MEMBER_INTENTS | MESSAGE_INTENTS, MESSAGE_INTENTS, MEMBER_INTENTS, 0];
const DISALLOWED_INTENTS = 4014;
const NO_COMMANDS = 'Could not set up the slash commands.';
const BANG_OFF = 'The ! commands are off and tickets save less, because Discord says the bot may not read messages. To fix it: in the Discord developer portal, open your application, then Bot, turn on Message Content Intent, and restart the server. Slash commands, logs and warnings all still work.';
const MEMBERS_OFF = 'Join and leave messages are off, because Discord says the bot may not see members. To fix it: in the Discord developer portal, open your application, then Bot, turn on Server Members Intent, and restart the server. Everything else still works.';
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
    this.registerEvery = cfg.registerEvery || 60000;
    this.registerSaid = '';
    this.intentTry = 0;
    this.noBang = false;
    this.noMembers = false;
    this.saidOff = new Set();
    this.lastNote = new Map();
    this.botId = '';
    this.community = new Community(this, services.db, { esc, COLOR });
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
    clearTimeout(this.registerTimer);
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
      // A switch in the developer portal is off. That must not cost anyone the slash commands, the logs or the warnings.
      if (code === DISALLOWED_INTENTS && this.intentTry < INTENT_TRIES.length - 1) {
        this.intentTry++;
        this.session = null;
        this.seq = null;
        this.resumeUrl = null;
        this.again = setTimeout(() => this.connect(), 500);
        this.again.unref();
        return;
      }
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
        else this.sendGateway({ op: 2, d: { token: this.token, intents: INTENT_TRIES[this.intentTry], properties: { os: 'linux', browser: 'stickmanup', device: 'stickmanup' } } });
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
          this.botId = m.d.user ? String(m.d.user.id) : '';
          this.ready = true;
          this.backoff = 2000;
          this.connectedAt = Date.now();
          console.log(`bot: connected as ${this.user}, ${this.admins.size} admin(s) allowed`);
          this.register();
          this.noBang = !(INTENT_TRIES[this.intentTry] & MESSAGE_INTENTS);
          this.noMembers = !(INTENT_TRIES[this.intentTry] & MEMBER_INTENTS);
          if (this.noBang) this.sayOff('! commands are off', BANG_OFF);
          if (this.noMembers) this.sayOff('Join and leave messages are off', MEMBERS_OFF);
        } else if (m.t === 'RESUMED') {
          this.ready = true;
          this.backoff = 2000;
        } else if (m.t === 'INTERACTION_CREATE') {
          this.onInteraction(m.d).catch((e) => console.error('bot: command failed:', e.message));
        } else if (m.t === 'MESSAGE_CREATE') {
          this.onMessage(m.d).catch((e) => console.error('bot: command failed:', e.message));
        } else if ((m.t === 'GUILD_MEMBER_ADD' || m.t === 'GUILD_MEMBER_REMOVE') && m.d && String(m.d.guild_id) === String(this.guild)) {
          if (m.t === 'GUILD_MEMBER_ADD') this.community.onJoin(m.d);
          else this.community.onLeave(m.d);
        }
        break;
    }
  }

  sayOff(title, text) {
    if (this.saidOff.has(title)) return;
    this.saidOff.add(title);
    console.error(`bot: ${text}`);
    this.log(title, text, COLOR.warn);
  }

  // A bot that isn't on the server yet can't have commands there, and nothing tells it when it gets invited. So it keeps trying.
  async register() {
    clearTimeout(this.registerTimer);
    if (!this.appId || !this.guild || this.stopped) return;
    try {
      await this.setCommands();
      this.registerSaid = '';
      if (this.lastError.startsWith(NO_COMMANDS)) this.lastError = '';
    } catch (e) {
      this.lastError = `${NO_COMMANDS} ${e.message}`;
      // Once for each new reason, not once a minute for ever.
      if (this.registerSaid !== e.message) console.error(`bot: ${this.lastError} Trying again every minute.`);
      this.registerSaid = e.message;
      this.registerTimer = setTimeout(() => this.register(), this.registerEvery);
      if (this.registerTimer.unref) this.registerTimer.unref();
    }
  }
  // Discord doesn't like being told again and again, so it hears them only when they aren't there or have changed.
  async setCommands() {
    const url = `/applications/${this.appId}/guilds/${this.guild}/commands`;
    const h = crypto.createHash('sha256').update(JSON.stringify(COMMANDS) + this.guild + this.appId).digest('hex').slice(0, 16);
    if (this.s.db.setting('botCommands') === h) {
      // Throwing the bot off a server takes its commands along, so look rather than remember.
      const now = await this.rest('GET', url);
      if (now && now.ok) {
        const list = await now.json();
        if (Array.isArray(list) && list.length === COMMANDS.length) return;
      }
    }
    const r = await this.rest('PUT', url, COMMANDS);
    if (r && r.ok) {
      this.s.db.setSetting('botCommands', h);
      console.log(`bot: ${COMMANDS.length} commands set up`);
      return;
    }
    if (!r) throw new Error('Discord did not answer.');
    if (r.status === 403 || r.status === 404) throw new Error(`Discord answered ${r.status}: the bot is not on that server yet, or the server ID is wrong. Invite it with the link install.sh --bot shows.`);
    let why = '';
    try { why = (await r.text()).slice(0, 300); } catch (e) {}
    throw new Error(`Discord answered ${r.status}. ${why}`);
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
  // A file, which goes differently from everything else. Answers whether it got there.
  async upload(channel, msg, filename, text) {
    if (!channel || !this.on) return false;
    for (let k = 0; k < 3; k++) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(Object.assign({ allowed_mentions: { parse: [] } }, msg, { attachments: [{ id: 0, filename }] })));
      form.append('files[0]', new Blob([text], { type: 'text/plain' }), filename);
      let r;
      try {
        r = await fetch(`${this.api}/channels/${channel}/messages`, { method: 'POST', headers: { Authorization: `Bot ${this.token}`, 'User-Agent': 'StickManUpServer (https://github.com/TheOCP/stickmanup, 1)' }, body: form });
      } catch (e) {
        this.lastError = e.message;
        await new Promise((f) => setTimeout(f, 1500 * (k + 1)));
        continue;
      }
      if (r.status !== 429) {
        if (!r.ok) this.lastError = `Discord answered ${r.status} when sending a file to channel ${channel}.`;
        return r.ok;
      }
      let wait = 2;
      try { wait = (await r.json()).retry_after || 2; } catch (e) {}
      await new Promise((f) => setTimeout(f, Math.min(60, wait) * 1000 + 100));
    }
    return false;
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
    // Ticket buttons are for everyone on our Discord server, and check for themselves who may do what.
    if ((i.type === 3 || i.type === 5) && String(i.data && i.data.custom_id).startsWith('tk:')) {
      if (!this.guild || String(i.guild_id) !== String(this.guild)) return undefined;
      return this.community.onInteraction(i, who);
    }
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
      s: this.s, bot: this, who: whoName, whoShort: who.username || String(who.id), userId: String(who.id), whoUser: who, channel: String(i.channel_id),
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

  // ---------------------------------------------------------------- the commands typed with a !
  // Only the people on the list, only on our server, and only in the bot's own channels: an answer here is for everyone in the
  // channel to read, and answers can show IP addresses. Anyone else talking to some other bot with a ! gets no answer from this one.
  async onMessage(m) {
    // Whatever it says, if it is in a ticket it gets remembered.
    if (m && String(m.guild_id) === String(this.guild)) this.community.capture(m);
    if (!m || typeof m.content !== 'string' || m.content[0] !== '!') return;
    if ((m.author && m.author.bot) || m.webhook_id || !m.author) return;
    if (!this.guild || String(m.guild_id) !== String(this.guild)) return;
    const b = parseBang(m.content);
    if (!b) return;
    const channel = String(m.channel_id), own = channel === String(this.logChannel) || channel === String(this.warnChannel);
    const who = m.author, allowed = this.admins.has(String(who.id)), whoName = `${who.username || 'someone'} (${who.id})`;
    const reply = (text, o = {}) => {
      const msg = { embeds: [{ description: String(text).slice(0, 4000), color: COLOR[o.color || 'info'] }] };
      if (o.components) msg.components = o.components;
      this.post(channel, msg);
    };
    if (!own) {
      if (allowed && this.notedLately(who.id)) reply(`The ! commands only work in <#${this.logChannel}>, because their answers can show IP addresses and everyone in the channel can read them. Slash commands work anywhere: only you see their answers.`, { color: 'warn' });
      return;
    }
    if (!allowed) {
      if (b.unknown || !this.notedLately(who.id)) return;
      console.log(`bot: refused ${whoName}`);
      this.log('Refused', `${esc(whoName)} tried to use the bot and is not on the list.`, COLOR.warn);
      reply(this.admins.size ? 'You are not allowed to use this.' : 'Nobody is allowed to use the bot yet. Add Discord user IDs with: install.sh --bot', { color: 'bad' });
      return;
    }
    if (b.unknown) return reply(`There is no \`!${esc(b.unknown).slice(0, 40)}\`.${didYouMean(b.near || [], '!')} \`!help\` lists them all.`, { color: 'warn' });
    if (b.err) return reply(`${esc(b.err)}\nHow to use it: \`${b.usage}\``, { color: 'warn' });
    const ctx = {
      s: this.s, bot: this, who: whoName, whoShort: who.username || String(who.id), userId: String(who.id), whoUser: who, channel, bang: true,
      reply,
      modal: () => reply('That only works from a button.', { color: 'warn' }),
      slow: async (fn) => reply(await fn()),
    };
    try {
      await runCommand(ctx, b.data);
    } catch (e) {
      console.error(`bot: !${b.data.name} failed:`, e.message);
      reply('That went wrong on the server. The server log has the details.', { color: 'bad' });
    }
  }
  // One word about it a minute per person, however much they type.
  notedLately(id) {
    const now = Date.now(), last = this.lastNote.get(id) || 0;
    if (now - last < 60000) return false;
    if (this.lastNote.size > 1000) this.lastNote.clear();
    this.lastNote.set(id, now);
    return true;
  }

  status() {
    if (!this.on) return { on: false };
    return { on: true, bang: !this.noBang, members: !this.noMembers, ready: this.ready, user: this.user, since: this.connectedAt, admins: this.admins.size, commands: COMMANDS.length, queue: this.queue.length, error: this.lastError };
  }
}

module.exports = { Bot, esc, when, ids, COLOR };
