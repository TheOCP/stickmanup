'use strict';
// The terminal in the game. The team types the same commands the Discord bot takes, and the answers come back over the live
// socket (friends.js). Who may run what is worked out here, from their role and their own permissions (staff.js), never from
// anything the game says about itself.
const { parseBang, runCommand, closest, didYouMean, COMMANDS, DISCORD_ONLY } = require('./botcommands');
const { Limiter } = require('./limits');

// Discord's time stamps, as words.
function ago(t) {
  const d = Date.now() - t, a = Math.abs(d), s = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const v = a < 60000 ? null : a < 3600000 ? s(Math.round(a / 60000), 'minute') : a < 172800000 ? s(Math.round(a / 3600000), 'hour') : s(Math.round(a / 86400000), 'day');
  if (!v) return 'just now';
  return d >= 0 ? `${v} ago` : `in ${v}`;
}
// The answers are written for Discord. The game shows plain text.
function plain(s) {
  return String(s == null ? '' : s)
    .replace(/<t:(\d+):R>/g, (_, t) => ago(+t * 1000))
    .replace(/<@&(\d+)>/g, '@role').replace(/<@!?(\d+)>/g, '@$1').replace(/<#(\d+)>/g, '#$1')
    .replace(/\*\*/g, '').replace(/`/g, '')
    .replace(/\\([\\`*_~|>#@:[\]()-])/g, '$1');
}

class Terminal {
  constructor(services, bot) {
    this.s = services;
    this.bot = bot;
    this.limit = new Limiter(20, 2);
    this.sweep = setInterval(() => this.limit.sweep(), 60000);
    this.sweep.unref();
  }

  // The commands this player may use in the game, for the suggestions as they type.
  menu(u) {
    const st = this.s.staff;
    return COMMANDS.filter((c) => !DISCORD_ONLY.has(c.name) && st.can(u, c.name)).map((c) => ({
      n: c.name, d: c.description,
      o: c.options.map((o) => ({ n: o.name, r: !!o.required, k: o.type === 5 ? 'yes/no' : o.type === 4 ? 'number' : o.name === 'player' ? 'player' : o.name, c: o.choices ? o.choices.map((x) => x.value) : undefined })),
    }));
  }

  async run(ws, m, send) {
    const id = Number.isInteger(m.id) ? m.id : 0;
    const out = (text, color = 'info') => send({ t: 'out', id, text: plain(text).slice(0, 8000), color });
    const st = this.s.staff, u = this.s.admin.info(ws.uid);
    if (!u) return undefined;
    if (!this.limit.take(u.id)) return out('Slow down a little.', 'warn');
    if (!st.isStaff(u)) return out('Only the team can use commands.', 'bad');
    const line = String(m.line == null ? '' : m.line).replace(/[\r\n]+/g, ' ').trim().slice(0, 1500).replace(/^[/!]+/, '');
    if (!line) return undefined;
    const b = parseBang('!' + line);
    if (!b) return out('Type a command, like /help.', 'warn');
    if (b.unknown) {
      const mine = COMMANDS.map((c) => c.name).filter((n) => !DISCORD_ONLY.has(n) && st.can(u, n));
      return out(`There is no /${b.unknown}.${didYouMean(closest(b.unknown, mine), '/')} /help lists what you can use.`, 'warn');
    }
    if (b.err) return out(`${b.err}\nHow to use it: ${String(b.usage).replace(/^!/, '/')}`, 'warn');
    const shown = u.game_name || u.name;
    const ctx = {
      s: this.s, bot: this.bot, game: true, actor: u, userId: null,
      who: `${shown} #${u.num} (in the game)`, whoShort: `${shown} #${u.num}`,
      can: (n) => st.can(u, n),
      reply: (text, o = {}) => out(text, o.color || 'info'),
      act: (o) => send(Object.assign({ t: 'act' }, o)),
      slow: async (fn) => out(await fn()),
      modal: () => out('That only works on Discord.', 'warn'),
    };
    try {
      await runCommand(ctx, b.data);
    } catch (e) {
      console.error(`terminal: /${b.data.name} failed:`, e.message);
      out('That went wrong on the server. The server log has the details.', 'bad');
    }
    return undefined;
  }
}

module.exports = { Terminal, plain };
