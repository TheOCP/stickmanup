'use strict';
// Every slash command the bot has. To add one: put it in COMMANDS, and give it a function in RUN with the same name.
// Everyone who gets this far is already on the admin list (discord.js checks). What is typed in can still be nonsense, so
// each one checks its own input, and everything that changes something is written down in the audit log and the log channel.

const PLAYER = { type: 3, name: 'player', description: 'Name, #number or ID', required: true, autocomplete: true };
const REASON = (required) => ({ type: 3, name: 'reason', description: 'Why', required, max_length: 300 });
const { DEFAULT_WELCOME } = require('./community');
const COUNT = { type: 4, name: 'count', description: 'How many to show', required: false, min_value: 1, max_value: 50 };
const PAGE = { type: 4, name: 'page', description: 'Which page', required: false, min_value: 1, max_value: 100000 };
const AMOUNT = { type: 4, name: 'amount', description: 'How many coins', required: true, min_value: 1, max_value: 100000000 };
const IP = { type: 3, name: 'ip', description: 'The address', required: true, max_length: 64 };
const DAYS = { type: 4, name: 'days', description: 'For how many days (leave empty for good)', required: false, min_value: 1, max_value: 36500 };
const ITEM = { type: 3, name: 'item', description: 'Which item', required: true, autocomplete: true };
const CONFIRM = { type: 5, name: 'confirm', description: 'Say true: this can not be undone', required: true };
const ROLE = { type: 3, name: 'role', description: 'Which role', required: true, autocomplete: true, max_length: 16 };
const PERM = { type: 3, name: 'perm', description: 'A command, a @group of them, or * for all', required: true, autocomplete: true, max_length: 24 };
const RELIC = { type: 3, name: 'relic', description: 'Which relic: like storm:e, a map (all of its relics) or all', required: true, autocomplete: true, max_length: 24 };
const TAG = { type: 3, name: 'tag', description: 'What it says next to names', required: false, max_length: 12 };
const COLOUR = { type: 3, name: 'color', description: 'Its colour, like #ff8800', required: false, max_length: 7 };
const RANK = { type: 4, name: 'rank', description: 'Higher ranks can act on lower ones (owner 1000, admin 80, mod 50)', required: false, min_value: 1, max_value: 999 };
const cmd = (name, description, ...options) => ({ name, description, options, type: 1, dm_permission: false });

const COMMANDS = [
  cmd('help', 'The commands, or one of them in detail', { type: 3, name: 'command', description: 'One command, for its details', required: false, autocomplete: true }),
  // Players
  cmd('player', 'Everything about one player', PLAYER),
  cmd('players', 'All players, with their numbers, names and IDs', PAGE),
  cmd('search', 'Find players by part of a name', { type: 3, name: 'text', description: 'Part of a name, a number or an ID', required: true, max_length: 64 }),
  cmd('recent', 'Who played last', COUNT),
  cmd('lastplayed', 'When a player last played, or who played last of all', { ...PLAYER, required: false }),
  cmd('new', 'The newest accounts', COUNT),
  cmd('online', 'Who is around right now'),
  cmd('top', 'The top players', { type: 3, name: 'by', description: 'Top what', required: false, choices: [{ name: 'coins', value: 'coins' }, { name: 'coins ever earned', value: 'earned' }, { name: 'climbs', value: 'climbs' }, { name: 'wins', value: 'wins' }] }, COUNT),
  cmd('stats', 'The game in numbers'),
  cmd('alts', 'Other accounts on the same address or phone', PLAYER),
  cmd('ip', 'Accounts seen on an address', IP),
  cmd('ips', 'The addresses a player has used', PLAYER),
  cmd('rename', 'Change a player\'s name', PLAYER, { type: 3, name: 'name', description: 'The new name', required: true, max_length: 32 }),
  cmd('note', 'Keep a note about a player', PLAYER, { type: 3, name: 'text', description: 'The note', required: true, max_length: 500 }),
  cmd('notes', 'The notes about a player', PLAYER),
  cmd('signout', 'Sign a player out on all their phones', PLAYER),
  cmd('deleteplayer', 'Delete an account for good', PLAYER, CONFIRM),
  // Coins and items
  cmd('coins', 'How many coins a player has', PLAYER),
  cmd('givecoins', 'Give coins to a player', PLAYER, AMOUNT, REASON(false)),
  cmd('takecoins', 'Take coins from a player', PLAYER, AMOUNT, REASON(false)),
  cmd('setcoins', 'Set a player\'s coins', PLAYER, { ...AMOUNT, min_value: 0, description: 'The new balance' }, REASON(false)),
  cmd('giveall', 'Give coins to everyone', AMOUNT, REASON(true), CONFIRM),
  cmd('resetwallet', 'Take all coins and items from a player', PLAYER, REASON(true), CONFIRM),
  cmd('history', 'Where a player\'s coins came from and went', PLAYER, COUNT),
  cmd('items', 'What a player owns', PLAYER),
  cmd('giveitem', 'Give an item to a player', PLAYER, ITEM, REASON(false)),
  cmd('takeitem', 'Take an item from a player', PLAYER, ITEM, REASON(false)),
  cmd('catalog', 'Everything you can give, and the names to use for items', { type: 3, name: 'search', description: 'Part of a name', required: false, max_length: 40 },
    { type: 3, name: 'kind', description: 'Only this kind of thing', required: false, choices: [{ name: 'suits', value: 'suit' }, { name: 'epic suits, faces and hats', value: 'epic' }, { name: 'legendary suits', value: 'legend' }, { name: 'faces', value: 'face' }, { name: 'hats', value: 'hat' }, { name: 'hair', value: 'hair' }, { name: 'emotes', value: 'emote' }, { name: 'weapons', value: 'weapon' }] }, PAGE),
  cmd('giverelic', 'Give a player a relic, so what it opens can be bought', PLAYER, RELIC, REASON(false)),
  cmd('takerelic', 'Take a relic from a player', PLAYER, RELIC, REASON(false)),
  cmd('dailycap', 'The most coins one player can earn in a day', { type: 4, name: 'amount', description: 'The new limit. Empty just shows it', required: false, min_value: 0, max_value: 100000000 }),
  // Climbs
  cmd('climbs', 'A player\'s last climbs and what the rerun found', PLAYER, COUNT),
  cmd('climb', 'One climb in detail', { type: 3, name: 'id', description: 'The climb ID, from /climbs', required: true, max_length: 64 }),
  // Bans
  cmd('ban', 'Ban a player, with a reason', PLAYER, REASON(true), DAYS, { type: 5, name: 'ip', description: 'Their address too (yes unless you say no)', required: false }, { type: 5, name: 'phone', description: 'Their phone too (yes unless you say no)', required: false }),
  cmd('unban', 'Lift a player\'s ban', PLAYER, REASON(false)),
  cmd('tempban', 'Ban a player for some days', PLAYER, { ...DAYS, required: true }, REASON(true)),
  cmd('banip', 'Ban an address', IP, REASON(true), DAYS),
  cmd('unbanip', 'Lift a ban on an address', IP, REASON(false)),
  cmd('banphone', 'Ban a player\'s phone', PLAYER, REASON(true), DAYS),
  cmd('unbanphone', 'Lift a ban on a player\'s phone', PLAYER, REASON(false)),
  cmd('bans', 'Everyone who is banned, and why', PAGE),
  cmd('baninfo', 'Whether a player is banned, and their history', PLAYER),
  cmd('kick', 'Throw a player out of the room they are in', PLAYER, REASON(false)),
  cmd('resetcheckpoint', 'Send a player back to the start of the map and forget their saved climb', PLAYER, REASON(false)),
  cmd('tp', 'Move a climber: to a player, a height, the start or the top. That climb stops earning', PLAYER, { type: 3, name: 'to', description: 'A player, a height like 300m, start or top', required: true, max_length: 64 }, REASON(false)),
  cmd('tell', 'Send a player a message in the game', PLAYER, { type: 3, name: 'text', description: 'The message', required: true, max_length: 300 }),
  // Anticheat
  cmd('flags', 'What was flagged lately, or for one player', { ...PLAYER, required: false }, COUNT),
  cmd('suspects', 'Players with the most against them', COUNT),
  cmd('clearflags', 'Forget a player\'s flags', PLAYER, REASON(false)),
  cmd('trust', 'Never ban or cut off this player automatically (testers)', PLAYER),
  cmd('untrust', 'Treat this player like everyone else again', PLAYER),
  cmd('anticheat', 'Watch only, or act', { type: 3, name: 'mode', description: 'Leave empty to see it', required: false, choices: [{ name: 'watch (report only)', value: 'watch' }, { name: 'enforce (no coins for what fails)', value: 'enforce' }] }),
  cmd('phone', 'What a player\'s phone reported', PLAYER),
  // Rooms
  cmd('rooms', 'The rooms open right now'),
  cmd('closeroom', 'Close a room', { type: 3, name: 'code', description: 'The 5 letter code', required: true, max_length: 5 }, REASON(false)),
  // Live, in the game
  cmd('vanish', 'Be invisible and fly, on a climb or watching one, and offline to friends', { type: 5, name: 'on', description: 'On or off (empty switches it)', required: false }, { ...PLAYER, required: false, description: 'Whose (you, if empty)' }),
  cmd('watch', 'Watch any climb, solo or in a room (in the game)', PLAYER),
  cmd('join', 'Join the room a player is in, past its password (in the game)', { ...PLAYER, description: 'Name, #number, ID or a room code' }),
  // The server
  cmd('status', 'How the server is doing'),
  cmd('announce', 'Show a message to everyone in the game', { type: 3, name: 'text', description: 'The message. "off" removes it', required: true, max_length: 400 }, { type: 4, name: 'minutes', description: 'For how long (empty for until removed)', required: false, min_value: 1, max_value: 100000 }),
  cmd('maintenance', 'Stop sign ins, new climbs and rooms for a while', { type: 5, name: 'on', description: 'On or off', required: true }, { type: 3, name: 'message', description: 'What players are told', required: false, max_length: 300 }),
  cmd('logguests', 'Log new guests in the channel, or not', { type: 5, name: 'on', description: 'On or off', required: true }),
  cmd('backup', 'Make a backup of everything now'),
  cmd('audit', 'What the admins did lately', COUNT),
  cmd('admins', 'Who may use the bot'),
  // Roles and permissions
  cmd('setrole', 'Give a player a role (their flag in the game), or none', PLAYER, { ...ROLE, description: 'The role, or none to take it away' }),
  cmd('roles', 'Every role: its rank, what it may do and who has it'),
  cmd('newrole', 'Make a new role', { type: 3, name: 'key', description: 'A short name: small letters, numbers and _', required: true, max_length: 16 }, TAG, COLOUR, RANK),
  cmd('editrole', 'Change a role\'s tag, colour or rank', ROLE, TAG, COLOUR, RANK),
  cmd('delrole', 'Delete a role: whoever has it loses it', ROLE, CONFIRM),
  cmd('roleperm', 'Let a role use a command, or stop it', ROLE, { type: 3, name: 'action', description: 'Add or remove', required: true, choices: [{ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }] }, PERM),
  cmd('playerperm', 'Let one player use a command, forbid it, or go back to their role', PLAYER, { type: 3, name: 'action', description: 'Allow, deny or reset', required: true, choices: [{ name: 'allow', value: 'allow' }, { name: 'deny', value: 'deny' }, { name: 'reset', value: 'reset' }] }, PERM),
  cmd('perms', 'What a role or a player may do', { type: 3, name: 'who', description: 'A role or a player (empty: yourself in the game, or the groups)', required: false, autocomplete: true, max_length: 64 }),
  cmd('welcome', 'Where to say who joined and who left, or see how it is set', { type: 7, name: 'channel', description: 'The channel for joins, and for leaves unless given below', required: false, channel_types: [0, 5] }, { type: 7, name: 'leavechannel', description: 'Another channel for who left (optional)', required: false, channel_types: [0, 5] }, { type: 3, name: 'message', description: 'The welcome. {user} pings them, {name} is their name', required: false, max_length: 500 }, { type: 5, name: 'off', description: 'Turn these messages off', required: false }, { type: 5, name: 'test', description: 'Show both messages using you as the example', required: false }),
  cmd('ticketsetup', 'Where tickets go and who answers them, or see how it is set', { type: 7, name: 'category', description: 'The category new ticket channels go in', required: false, channel_types: [4] }, { type: 7, name: 'logchannel', description: 'A private channel for finished tickets (otherwise the log channel)', required: false, channel_types: [0] }, { type: 8, name: 'staffrole', description: 'The role that sees and answers tickets', required: false }),
  cmd('ticketpanel', 'Put the Open a ticket button in a channel', { type: 7, name: 'channel', description: 'The channel for the button', required: true, channel_types: [0, 5] }, { type: 3, name: 'text', description: 'What it says above the button', required: false, max_length: 1500 }),
  cmd('tickets', 'List tickets: open ones, or for one person', { type: 3, name: 'status', description: 'Which tickets', required: false, choices: [{ name: 'open', value: 'open' }, { name: 'closed', value: 'closed' }, { name: 'all', value: 'all' }] }, { type: 6, name: 'user', description: 'All tickets of this person', required: false }, COUNT),
  cmd('transcript', 'Post what was said in a ticket, as a file in the private channel', { type: 4, name: 'number', description: 'The ticket number', required: true, min_value: 1, max_value: 100000000 }),
  cmd('closeticket', 'Close a ticket. Without a number, the one in this channel', { type: 4, name: 'number', description: 'The ticket number', required: false, min_value: 1, max_value: 100000000 }, REASON(false)),
];

// Commands come in groups, so a role can be given a whole group at once (@bans and so on). See staff.js.
const GROUPS = {
  players: ['player', 'players', 'search', 'recent', 'lastplayed', 'new', 'online', 'top', 'stats', 'alts', 'ip', 'ips', 'rename', 'note', 'notes', 'signout', 'deleteplayer', 'tell', 'resetcheckpoint', 'tp'],
  coins: ['coins', 'givecoins', 'takecoins', 'setcoins', 'giveall', 'resetwallet', 'history', 'items', 'giveitem', 'takeitem', 'catalog', 'giverelic', 'takerelic', 'dailycap'],
  climbs: ['climbs', 'climb'],
  bans: ['ban', 'unban', 'tempban', 'banip', 'unbanip', 'banphone', 'unbanphone', 'bans', 'baninfo', 'kick'],
  anticheat: ['flags', 'suspects', 'clearflags', 'trust', 'untrust', 'anticheat', 'phone'],
  rooms: ['rooms', 'closeroom'],
  live: ['vanish', 'watch', 'join'],
  server: ['status', 'announce', 'maintenance', 'logguests', 'backup', 'audit', 'admins', 'help'],
  staff: ['setrole', 'roles', 'newrole', 'editrole', 'delrole', 'roleperm', 'playerperm', 'perms'],
  discord: ['welcome', 'ticketsetup', 'ticketpanel', 'tickets', 'transcript', 'closeticket'],
};
// What can't work from the game, and what can't work from Discord.
const DISCORD_ONLY = new Set([...GROUPS.discord, 'admins']);
const GAME_ONLY = new Set(['watch', 'join']);
const IN_GAME = 'That works in the game: open the terminal there (staff have a Terminal button on the main menu and in the pause menu).';
// Commands that only look at a player, or give them something. All the others need a higher rank than theirs, in the game.
const GENTLE = new Set(['player', 'coins', 'items', 'history', 'notes', 'note', 'climbs', 'flags', 'baninfo', 'lastplayed', 'alts', 'ips', 'phone', 'perms', 'givecoins', 'giveitem', 'giverelic', 'tell']);

// How far apart two words are, in letters changed, added, left out or swapped round.
function dist(a, b) {
  const m = a.length, n = b.length, d = [];
  for (let i = 0; i <= m; i++) d.push([i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}
// The words that were probably meant, best first.
function closest(word, names, n = 3) {
  const w = String(word || '').toLowerCase();
  if (!w) return [];
  return names.map((x) => [x, dist(w, String(x).toLowerCase())])
    .filter(([x, s]) => s <= Math.max(1, Math.floor(String(x).length / 3)) || (w.length >= 3 && String(x).toLowerCase().startsWith(w)))
    .sort((a, b) => a[1] - b[1]).slice(0, n).map((x) => x[0]);
}
const didYouMean = (near, mark = '') => (near.length ? ` Did you mean ${near.map((x) => `\`${mark}${x}\``).join(' or ')}?` : '');

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s == null ? '' : s).replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/([\\`*_~|>#@:[\]()-])/g, '\\$1').slice(0, 300);
const code = (s) => String(s == null ? '' : s).replace(/[`\s]/g, '').slice(0, 80);
const when = (t) => (t ? `<t:${Math.floor(t / 1000)}:R>` : 'never');
const n0 = (v) => Number(v || 0).toLocaleString('en-US');
const opt = (data, name) => { const o = (data.options || []).find((x) => x.name === name); return o ? o.value : undefined; };
const nameOf = (u) => (u.game_name && u.game_name !== u.name ? `${u.name} (plays as ${u.game_name})` : u.name);
const playerLine = (u) => `${nameOf(u)} #${u.num}`;
const line = (u) => `\`#${u.num}\` ${esc(nameOf(u))}`;
const PROVIDER = { discord: 'Discord', google: 'Google', steam: 'Steam', guest: 'Guest' };
const DIFF = ['Easy', 'Normal', 'Hardcore', 'Insane'];
const fmtH = (ms) => { const m = Math.floor(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const clip = (rows, none) => (rows.length ? rows.join('\n') : none);

// Finds the player the command is about, or explains why it can't. Several people called the same? Then it lists them.
function target(ctx, data, name = 'player') {
  const text = opt(data, name), r = ctx.s.admin.find(text);
  if (r.many) { ctx.reply(`More than one player is called that. Use a number:\n${r.many.map(line).join('\n')}`, { color: 'warn' }); return null; }
  if (!r.id) {
    // Part of a name, or the start of one with a typo further on.
    const t = String(text || '').trim();
    let near = t ? ctx.s.admin.search(t, 5) : [];
    if (!near.length && t.length >= 3) {
      // A typo: the names of everyone in the game now, and of players whose name starts the same way.
      const pool = new Map();
      for (const x of ctx.s.friends ? ctx.s.friends.everyone() : []) { const u = ctx.s.admin.info(x.id); if (u) pool.set(u.id, u); }
      for (const u of ctx.s.admin.search(t.slice(0, 2), 40)) pool.set(u.id, u);
      const users = [...pool.values()], names = users.flatMap((u) => [u.name, u.game_name].filter(Boolean));
      const best = closest(t, names, 5);
      near = users.filter((u) => best.includes(u.name) || best.includes(u.game_name)).slice(0, 5);
    }
    ctx.reply(`No player found for "${esc(text)}".${near.length ? ` Did you mean: ${near.map(line).join(', ')}?` : ''}`, { color: 'warn' });
    return null;
  }
  const u = ctx.s.admin.info(r.id);
  if (u && ctx.game && !GENTLE.has(ctx.cmd) && !ctx.s.staff.outranks(ctx.actor, u)) {
    ctx.reply(`${line(u)} has the same rank as you or a higher one, so you can't do that to them.`, { color: 'bad' });
    return null;
  }
  return u;
}
// The player who typed it: in the game that is them, on Discord the account they signed in to the game with.
function self(ctx) {
  if (ctx.game) return ctx.actor;
  const id = ctx.s.admin.byIdentity('discord', ctx.userId), u = id ? ctx.s.admin.info(id) : null;
  if (!u) ctx.reply('Your Discord account has no player in the game yet: sign in to the game with Discord, or name a player.', { color: 'warn' });
  return u;
}
const roleTag = (ctx, key) => { const r = key && ctx.s.staff.role(key); return r ? r.tag : ''; };
// What someone is doing right now, from what their game last said (friends.js).
function doing(ctx, p) {
  const map = p.map !== undefined ? mapName(ctx, p.map) : '', diff = DIFF[p.diff] || '';
  if (p.st === 'climb') return `climbing ${esc(map)}, ${diff}, ${p.h} of ${p.top} m${p.solo ? ', alone' : `, ${p.n} climbers`}${p.room ? `, room ${p.room.code}${p.room.kind === 'online' ? ' (Online)' : ''}` : ''}${p.paused ? ', paused' : ''}${p.won ? ', at the top' : ''}`;
  if (p.st === 'lobby') return `in the lobby of ${p.room ? `room ${p.room.code}` : 'a room'}, ${esc(map)}, ${p.n} climbers`;
  if (p.st === 'watch') return 'watching a climb';
  if (p.st === 'menu') return 'in the menus';
  return 'not in the game';
}
// May they hand this out? Only what they have themselves, and roles below their own.
const mayGivePerm = (ctx, perm) => !ctx.game || ctx.s.staff.can(ctx.actor, perm);
const belowMe = (ctx, rank) => !ctx.game || ctx.s.staff.isOwner(ctx.actor) || rank < ctx.s.staff.rankOf(ctx.actor);
function permFrom(ctx, text) {
  const p = ctx.s.staff.perm(text);
  if (!p) {
    const all = ctx.s.staff.permNames(), bare = (x) => x.replace(/^[@/]/, '');
    const near = [...new Set(closest(bare(String(text)), all.map(bare), 3))].flatMap((w) => all.filter((x) => bare(x) === w));
    ctx.reply(`There is no command or group called "${esc(text)}".${didYouMean(near.slice(0, 3))} Groups: ${Object.keys(GROUPS).map((g) => '@' + g).join(', ')}.`, { color: 'warn' });
  }
  return p;
}
function roleFrom(ctx, text) {
  const r = ctx.s.staff.findRole(text);
  if (!r) ctx.reply(`There is no role called "${esc(text)}".${didYouMean(closest(text, ctx.s.staff.list().map((x) => x.key)))} /roles lists them.`, { color: 'warn' });
  return r;
}
// What a player may do, by group.
function permsText(ctx, u) {
  const can = new Set(ctx.s.staff.commandsOf(u)), out = [];
  for (const [g, list] of Object.entries(GROUPS)) {
    const mine = list.filter((n) => can.has(n));
    if (mine.length) out.push(`@${g}: ${mine.length === list.length ? 'all' : mine.join(', ')}`);
  }
  return out.length ? out.join('\n') : 'No commands.';
}
function done(ctx, cmdName, detail, text, o) {
  ctx.s.admin.audit(ctx.who, cmdName, detail);
  ctx.bot.log('Admin', `**${esc(ctx.whoShort)}** used /${cmdName}\n${esc(detail)}`);
  return ctx.reply(text, Object.assign({ color: 'good' }, o));
}
// The player hears about it in the game, with the reason.
function tell(ctx, u, what, why) { ctx.s.admin.tell(u.id, why ? `${what} Reason: ${why}` : what); }
const withWhy = (why) => (why ? ` Reason: ${esc(why)}` : ' No reason given.');
function mapName(ctx, i) { const m = ctx.s.wallet.mapNames; return m[i] || String(i); }

function playerText(ctx, u) {
  const a = ctx.s.admin, w = ctx.s.wallet.get(u.id), ban = a.banOf(u.id), score = a.score(u.id);
  const out = [`**${esc(nameOf(u))}** \`#${u.num}\``, `ID: \`${u.id}\``, `Signed in with: ${PROVIDER[u.provider] || esc(u.provider)}`, `Joined ${when(u.created)}, last seen ${when(u.last_seen)}`];
  if (roleTag(ctx, u.role)) out.push(`Role: **${esc(roleTag(ctx, u.role))}**${ctx.s.staff.vanished(u.id) ? ', vanished' : ''}`);
  if (!ctx.game || ctx.can('ips')) out.push(`Last address: \`${code(u.last_ip || 'unknown')}\``);
  out.push(`Coins: **${n0(w.coins)}**, ever earned ${n0(w.earned)}, items ${w.own.length}, relics ${w.relics.length}`);
  out.push(u.last_played ? `Last played ${when(u.last_played)}: ${esc(mapName(ctx, u.last_map))}, ${DIFF[u.last_diff] || u.last_diff}, ${u.last_h} m up. ${u.climbs} climbs in all.` : 'Has not played yet.');
  out.push(`Flags: ${score} of ${a.banScore} in the last 30 days${u.trusted ? '. Trusted' : ''}`);
  out.push(ban ? `**BANNED**: ${esc(ban.reason)}, by ${esc(ban.by_who)}, ${ban.until ? 'until ' + when(ban.until) : 'for good'}` : 'Not banned');
  return out.join('\n');
}

// ---------------------------------------------------------------- the commands
// The account, its phone and its address, so a new account on the same phone doesn't get round it. /unban lifts all of it.
function banAll(ctx, u, cmdName, why, days, withIp, withPhone) {
  const ip = withIp ? u.last_ip : null, device = withPhone ? u.device : null;
  ctx.s.admin.ban({ userId: u.id, reason: why, by: ctx.whoShort, days, ip, device });
  const also = [device && 'phone', ip && 'address'].filter(Boolean);
  return done(ctx, cmdName, `${playerLine(u)}${days ? ` for ${days} days` : ''}: ${why}`, `Banned ${line(u)}${days ? ` for ${days} days` : ''}. Reason: ${esc(why)}${also.length ? `\nAlso banned: their ${also.join(' and ')}.` : ''}`);
}

// What takes a while and talks to Discord: say so first, and always come back with an answer.
function safely(ctx, fn) {
  return ctx.slow(async () => {
    try {
      return await fn();
    } catch (e) {
      console.error('bot: command failed:', e.message);
      return 'That went wrong on the server. The server log has the details.';
    }
  });
}

const RUN = {
  help(ctx, d) {
    const c = opt(d, 'command'), mark = ctx.game ? '/' : '!';
    if (c) {
      const want = String(c).replace(/^[/!]/, '').toLowerCase(), f = COMMANDS.find((x) => x.name === want);
      if (!f) return ctx.reply(`No such command.${didYouMean(closest(want, COMMANDS.map((x) => x.name)), ctx.game || ctx.bang ? mark : '/')}`, { color: 'warn' });
      return ctx.reply(`**${ctx.bang || ctx.game ? mark : '/'}${f.name}**: ${f.description}\n${ctx.bang || ctx.game ? `\`${usage(f, mark)}\`\n` : ''}${f.options.map((o) => `\`${o.name}\`${o.required ? '' : ' (optional)'}: ${o.description}${o.choices ? ` (${o.choices.map((x) => x.value).join(', ')})` : ''}`).join('\n')}`);
    }
    if (ctx.game) {
      const mine = COMMANDS.filter((x) => !DISCORD_ONLY.has(x.name) && ctx.can(x.name));
      return ctx.reply(`Type a command and press Enter. A player is a name, a #number or an ID, and a name with spaces goes in quotes: /ban "Cool Guy" flying around days=3. /help ban explains one.\n${mine.map((x) => `/${x.name}: ${x.description}`).join('\n')}`);
    }
    if (ctx.bang) return ctx.reply(`A player can be given by name, by number (#12) or by ID. A name with spaces goes in quotes, and optional parts go by name: \`!ban "Cool Guy" flying around days=3\`\n${COMMANDS.map((x) => `\`!${x.name}\` ${x.description}`).join('\n')}`.slice(0, 3900));
    return ctx.reply(`A player can always be given by name, by number (#12) or by ID, and the list suggests them as you type. Everything also works with a ! in the log channel, like \`!ban #12 flying around\`.\n${COMMANDS.map((x) => `\`/${x.name}\` ${x.description}`).join('\n')}`.slice(0, 3900));
  },
  player(ctx, d) { const u = target(ctx, d); if (u) return ctx.reply(playerText(ctx, u)); },
  players(ctx, d) {
    const size = 25, page = Math.max(1, opt(d, 'page') || 1), rows = ctx.s.admin.list(page - 1, size), total = ctx.s.admin.stats().players;
    return ctx.reply(`Players, page ${page} of ${Math.max(1, Math.ceil(total / size))} (${n0(total)} in all)\n${clip(rows.map((u) => `${line(u)} \`${u.id}\` ${PROVIDER[u.provider] || ''}`), 'Nobody on this page.')}`);
  },
  search(ctx, d) {
    const rows = ctx.s.admin.search(opt(d, 'text'), 25);
    return ctx.reply(clip(rows.map((u) => `${line(u)} \`${u.id}\`, last seen ${when(u.last_seen)}`), 'Nobody found.'));
  },
  recent(ctx, d) {
    const rows = ctx.s.admin.recent(opt(d, 'count') || 15);
    return ctx.reply(`Who played last\n${clip(rows.map((u) => `${line(u)} ${when(u.last_played)}: ${esc(mapName(ctx, u.last_map))}, ${DIFF[u.last_diff] || ''}, ${u.last_h} m`), 'Nobody has played yet.')}`);
  },
  lastplayed(ctx, d) {
    if (opt(d, 'player') === undefined) {
      const r = ctx.s.admin.recent(1)[0];
      return ctx.reply(r ? `The last to play was ${line(r)} ${when(r.last_played)}: ${esc(mapName(ctx, r.last_map))}, ${DIFF[r.last_diff] || ''}, ${r.last_h} m up.` : 'Nobody has played yet.');
    }
    const u = target(ctx, d);
    if (u) return ctx.reply(u.last_played ? `${line(u)} last played ${when(u.last_played)}: ${esc(mapName(ctx, u.last_map))}, ${DIFF[u.last_diff] || ''}, ${u.last_h} m up.` : `${line(u)} has not played yet.`);
  },
  new(ctx, d) {
    const rows = ctx.s.admin.newest(opt(d, 'count') || 15);
    return ctx.reply(clip(rows.map((u) => `${line(u)} ${PROVIDER[u.provider] || ''}, joined ${when(u.created)}, \`${code(u.last_ip || '')}\``), 'No accounts yet.'));
  },
  online(ctx) {
    const a = ctx.s.admin, r = ctx.s.rooms.stats(), live = ctx.s.friends.everyone(), seen = new Set(live.map((x) => x.id));
    const rows = live.slice(0, 50).map((x) => {
      const u = a.info(x.id), tag = u && roleTag(ctx, u.role);
      return u ? `${line(u)}${tag ? ` ${esc(tag)}` : ''}${x.vanished ? ' (vanished)' : ''}: ${doing(ctx, x.p)}` : null;
    }).filter(Boolean);
    // Older games don't keep the live line open, but still say they are there.
    const old = a.online().filter((p) => !seen.has(p.id)).slice(0, 20).map((p) => {
      const u = a.info(p.id);
      return u ? `${line(u)}: ${p.climbing && Date.now() - p.climbing < 60000 ? `climbing ${esc(mapName(ctx, p.map))}, ${p.h} m` : 'around'} (older version)` : null;
    }).filter(Boolean);
    return ctx.reply(`${live.length + old.length} in the game right now, ${r.players} of them in ${r.rooms} rooms.\n${clip([...rows, ...old], 'Nobody right now.')}`);
  },
  top(ctx, d) {
    const by = opt(d, 'by') || 'coins', rows = ctx.s.admin.top(by, opt(d, 'count') || 15);
    return ctx.reply(`Top by ${by}\n${clip(rows.map((u, i) => `${i + 1}. ${line(u)}: ${n0(u.v)}`), 'Nobody yet.')}`);
  },
  stats(ctx) {
    const s = ctx.s.admin.stats(), r = ctx.s.rooms.stats();
    return ctx.reply(`Players: **${n0(s.players)}**, of whom ${n0(s.guests)} guests\nSeen in the last day: ${n0(s.active)}, played: ${n0(s.played)}\nClimbs in the last day: ${n0(s.climbs)}, reached the top: ${n0(s.wins)}\nCoins held: ${n0(s.coins)}, ever earned: ${n0(s.earned)}\nRooms open: ${r.rooms}, in them: ${r.players}\nBanned: ${n0(s.bans)}, with flags: ${n0(s.suspects)}`);
  },
  alts(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const a = ctx.s.admin.alts(u.id);
    return ctx.reply(`Same phone as ${line(u)}:\n${clip(a.device.map(line), 'Nobody.')}\n\nSame address (a home or a phone network can be shared by honest people):\n${clip(a.ip.map((x) => `${line(x)} on \`${code(x.via)}\``), 'Nobody.')}`);
  },
  ip(ctx, d) {
    const ip = opt(d, 'ip'), rows = ctx.s.admin.usersOnIp(ip), ban = ctx.s.admin.banRow('ip', ip);
    return ctx.reply(`\`${code(ip)}\`${ban ? ` is **banned**: ${esc(ban.reason)}` : ''}\n${clip(rows.map((u) => `${line(u)} ${when(u.last)}`), 'Nobody seen there in the last 90 days.')}`);
  },
  ips(ctx, d) {
    const u = target(ctx, d);
    if (u) return ctx.reply(`${line(u)}\n${clip(ctx.s.admin.ips(u.id, 20).map((x) => `\`${code(x.ip)}\` last ${when(x.last)}, first ${when(x.first)}`), 'None in the last 90 days.')}`);
  },
  rename(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const name = opt(d, 'name');
    if (!ctx.s.admin.rename(u.id, name)) return ctx.reply('That name can not be used.', { color: 'warn' });
    return done(ctx, 'rename', `${playerLine(u)} to ${name}`, `Renamed ${line(u)} to ${esc(name)}.`);
  },
  note(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    ctx.s.admin.addNote(u.id, ctx.whoShort, opt(d, 'text'));
    return done(ctx, 'note', `${playerLine(u)}: ${opt(d, 'text')}`, `Note kept on ${line(u)}.`);
  },
  notes(ctx, d) {
    const u = target(ctx, d);
    if (u) return ctx.reply(`${line(u)}\n${clip(ctx.s.admin.notes(u.id, 15).map((x) => `${when(x.at)} ${esc(x.by_who)}: ${esc(x.text)}`), 'No notes.')}`);
  },
  signout(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    if (u.provider === 'guest') return ctx.reply(`${line(u)} is a guest and could never sign back in: they would lose everything. Use /ban if that is the idea.`, { color: 'warn' });
    const n = ctx.s.admin.endSessions(u.id);
    return done(ctx, 'signout', playerLine(u), `${line(u)} is signed out on ${n} phone(s).`);
  },
  deleteplayer(ctx, d) {
    if (opt(d, 'confirm') !== true) return ctx.reply('Nothing was deleted. Say confirm: true if you mean it.', { color: 'warn' });
    const u = target(ctx, d);
    if (!u) return undefined;
    const label = playerLine(u);
    ctx.s.admin.deletePlayer(u.id);
    return done(ctx, 'deleteplayer', label, `Deleted ${esc(label)} and everything of theirs.`);
  },
  coins(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const w = ctx.s.wallet.get(u.id);
    return ctx.reply(`${line(u)} has **${n0(w.coins)}** coins. Ever earned ${n0(w.earned)}, can still earn ${n0(w.dayLeft)} today.`);
  },
  givecoins(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const amount = opt(d, 'amount'), said = opt(d, 'reason'), why = said || 'no reason given';
    const left = ctx.s.wallet.adjust(u.id, amount, `given by ${ctx.whoShort}: ${why}`);
    tell(ctx, u, `You got ${n0(amount)} coins.`, said);
    return done(ctx, 'givecoins', `${n0(amount)} to ${playerLine(u)}: ${why}`, `Gave ${n0(amount)} coins to ${line(u)}, who now has ${n0(left)}.${withWhy(said)}`);
  },
  takecoins(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const amount = opt(d, 'amount'), said = opt(d, 'reason'), why = said || 'no reason given';
    const left = ctx.s.wallet.adjust(u.id, -amount, `taken by ${ctx.whoShort}: ${why}`);
    tell(ctx, u, `${n0(amount)} coins were taken from you.`, said);
    return done(ctx, 'takecoins', `${n0(amount)} from ${playerLine(u)}: ${why}`, `Took coins from ${line(u)}, who now has ${n0(left)}.${withWhy(said)}`);
  },
  setcoins(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const amount = opt(d, 'amount'), said = opt(d, 'reason'), why = said || 'no reason given';
    const left = ctx.s.wallet.setCoins(u.id, amount, `set by ${ctx.whoShort}: ${why}`);
    tell(ctx, u, `Your coins were set to ${n0(left)}.`, said);
    return done(ctx, 'setcoins', `${playerLine(u)} to ${n0(amount)}: ${why}`, `${line(u)} now has ${n0(left)} coins.${withWhy(said)}`);
  },
  giveall(ctx, d) {
    if (opt(d, 'confirm') !== true) return ctx.reply('Nothing was given. Say confirm: true if you mean it.', { color: 'warn' });
    const amount = opt(d, 'amount'), why = opt(d, 'reason');
    const n = ctx.s.wallet.giveAll(amount, `event from ${ctx.whoShort}: ${why}`);
    ctx.s.admin.tellAll(`Everyone got ${n0(amount)} coins. Reason: ${why}`);
    return done(ctx, 'giveall', `${n0(amount)} to ${n} players: ${why}`, `Gave ${n0(amount)} coins to ${n0(n)} players.${withWhy(why)}`);
  },
  resetwallet(ctx, d) {
    if (opt(d, 'confirm') !== true) return ctx.reply('Nothing changed. Say confirm: true if you mean it.', { color: 'warn' });
    const u = target(ctx, d);
    if (!u) return undefined;
    const why = opt(d, 'reason');
    ctx.s.wallet.reset(u.id, `reset by ${ctx.whoShort}: ${why}`);
    tell(ctx, u, 'Your coins and items were reset.', why);
    return done(ctx, 'resetwallet', `${playerLine(u)}: ${why}`, `${line(u)} now has no coins and no items.${withWhy(why)}`);
  },
  history(ctx, d) {
    const u = target(ctx, d);
    if (u) return ctx.reply(`${line(u)}\n${clip(ctx.s.wallet.history(u.id, opt(d, 'count') || 15).map((x) => `${when(x.at)} ${x.delta >= 0 ? '+' : ''}${n0(x.delta)}: ${esc(x.why)}`), 'Nothing yet.')}`);
  },
  items(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const w = ctx.s.wallet.get(u.id);
    return ctx.reply(`${line(u)}\nOwns (${w.own.length}): ${esc(w.own.join(', ') || 'nothing')}\nRelics: ${esc(w.relics.join(', ') || 'none')}\nAchievements: ${esc(w.ach.join(', ') || 'none')}`);
  },
  giveitem(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const found = ctx.s.wallet.findItem(opt(d, 'item')), said = opt(d, 'reason'), why = said || 'no reason given';
    if (found.many) return ctx.reply(`More than one item is called that. Use one of these: ${found.many.map((k) => `\`${esc(k)}\``).join(', ')}`, { color: 'warn' });
    if (!found.key) return ctx.reply('That item is not in the catalog. Try /catalog. The Hacker and GG Girl go with a flag: use /setrole.', { color: 'warn' });
    const item = found.key, name = ctx.s.wallet.itemName(item);
    if (!ctx.s.wallet.giveItem(u.id, item, `${ctx.whoShort}: ${why}`)) return ctx.reply(`${line(u)} already has that.`, { color: 'warn' });
    tell(ctx, u, `You got a new item: ${name}.`, said);
    return done(ctx, 'giveitem', `${item} to ${playerLine(u)}: ${why}`, `Gave ${esc(name)} to ${line(u)}.${withWhy(said)}`);
  },
  takeitem(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const text = opt(d, 'item'), found = ctx.s.wallet.findItem(text), said = opt(d, 'reason'), why = said || 'no reason given';
    if (found.many) return ctx.reply(`More than one item is called that. Use one of these: ${found.many.map((k) => `\`${esc(k)}\``).join(', ')}`, { color: 'warn' });
    const item = found.key || text, name = ctx.s.wallet.itemName(item);
    if (!ctx.s.wallet.takeItem(u.id, item, `${ctx.whoShort}: ${why}`)) return ctx.reply(`${line(u)} does not have that.`, { color: 'warn' });
    tell(ctx, u, `An item was taken from you: ${name}.`, said);
    return done(ctx, 'takeitem', `${item} from ${playerLine(u)}: ${why}`, `Took ${esc(name)} from ${line(u)}.${withWhy(said)}`);
  },
  catalog(ctx, d) {
    const q = String(opt(d, 'search') || '').toLowerCase(), kind = opt(d, 'kind') || '', per = 60;
    const all = ctx.s.wallet.catalogList().filter(([k, name, , kd]) => (k.toLowerCase().includes(q) || name.toLowerCase().includes(q)) &&
      (!kind || (kind === 'epic' ? kd.endsWith(':epic') : kd.split(':')[0] === kind)));
    const pages = Math.max(1, Math.ceil(all.length / per)), page = Math.min(pages, opt(d, 'page') || 1), shown = all.slice((page - 1) * per, page * per);
    const more = pages > 1 ? `\nPage ${page} of ${pages}.${page < pages ? ' Add page: ' + (page + 1) + ' for the next, or search for part of a name.' : ''}` : '';
    return ctx.reply(`${all.length} items\n${shown.map(([k, name, price]) => `${esc(name)} \`${esc(k)}\` ${price ? n0(price) : 'not for sale'}`).join(', ')}${more}`);
  },
  dailycap(ctx, d) {
    const a = opt(d, 'amount');
    if (a === undefined) return ctx.reply(`One player can earn up to ${n0(ctx.s.wallet.dayCap)} coins a day.`);
    ctx.s.wallet.setDayCap(a);
    ctx.s.db.setSetting('dayCap', String(a));
    return done(ctx, 'dailycap', n0(a), `One player can now earn up to ${n0(a)} coins a day.`);
  },
  climbs(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const rows = ctx.s.verifier.recent(u.id, opt(d, 'count') || 10).map((r) => `\`${r.id.slice(0, 22)}\` ${when(r.started)} ${esc(mapName(ctx, r.map))}, ${DIFF[r.diff] || r.diff}, ${r.best_h} m, ${r.won ? 'reached the top' : 'not finished'}, ${Math.round(r.ticks / 60)} s ${r.tainted ? `**FAILED**: ${esc(r.verdict || '')}` : 'clean'}`);
    return ctx.reply(`${line(u)}\n${clip(rows, 'No climbs yet.')}`);
  },
  climb(ctx, d) {
    const r = ctx.s.verifier.run(opt(d, 'id'));
    if (!r) return ctx.reply('No climb has that ID. Old ones are gone after a while.', { color: 'warn' });
    const u = ctx.s.admin.info(r.user_id), coins = JSON.parse(r.coins || '[]').length;
    return ctx.reply(`Climb by ${u ? line(u) : 'a deleted player'}\n${esc(mapName(ctx, r.map))}, ${DIFF[r.diff] || r.diff}${r.custom ? ', custom rules' : ''}, ${esc(r.mode)}\nStarted ${when(r.started)}, played ${Math.round(r.ticks / 60)} s, reached ${r.best_h} m, ${r.falls} falls\nCoins paid: ${coins}. ${r.won ? 'Reached the top.' : 'Not finished.'}\n${r.tainted ? `**Failed the rerun**: ${esc(r.verdict || '')}` : 'The rerun found nothing wrong.'}`);
  },
  ban(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const why = opt(d, 'reason'), days = opt(d, 'days');
    return banAll(ctx, u, 'ban', why, days, opt(d, 'ip') !== false, opt(d, 'phone') !== false);
  },
  unban(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const why = opt(d, 'reason') || '', n = ctx.s.admin.unban(u.id, ctx.whoShort, why);
    if (!n) return ctx.reply(`${line(u)} is not banned.`, { color: 'warn' });
    return done(ctx, 'unban', `${playerLine(u)}: ${why}`, `${line(u)} is not banned any more.`);
  },
  tempban(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const why = opt(d, 'reason'), days = opt(d, 'days');
    return banAll(ctx, u, 'tempban', why, days, true, true);
  },
  banip(ctx, d) {
    const ip = opt(d, 'ip'), why = opt(d, 'reason'), days = opt(d, 'days');
    ctx.s.admin.ban({ ip, reason: why, by: ctx.whoShort, days });
    return done(ctx, 'banip', `${ip}: ${why}`, `Banned the address \`${code(ip)}\`. Everyone sharing it is shut out too. Reason: ${esc(why)}`);
  },
  unbanip(ctx, d) {
    const ip = opt(d, 'ip'), why = opt(d, 'reason') || '';
    if (!ctx.s.admin.unbanValue('ip', ip, ctx.whoShort, why)) return ctx.reply('That address is not banned.', { color: 'warn' });
    return done(ctx, 'unbanip', `${ip}: ${why}`, `\`${code(ip)}\` is not banned any more.`);
  },
  banphone(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    if (!u.device) return ctx.reply(`${line(u)} has not reported a phone yet.`, { color: 'warn' });
    const why = opt(d, 'reason');
    ctx.s.admin.ban({ device: u.device, reason: why, by: ctx.whoShort, days: opt(d, 'days') });
    return done(ctx, 'banphone', `${playerLine(u)}: ${why}`, `Banned the phone of ${line(u)}. Reason: ${esc(why)}`);
  },
  unbanphone(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const why = opt(d, 'reason') || '';
    if (!u.device || !ctx.s.admin.unbanValue('device', u.device, ctx.whoShort, why)) return ctx.reply('That phone is not banned.', { color: 'warn' });
    return done(ctx, 'unbanphone', `${playerLine(u)}: ${why}`, `The phone of ${line(u)} is not banned any more.`);
  },
  bans(ctx, d) {
    const size = 20, page = Math.max(1, opt(d, 'page') || 1), { rows, total } = ctx.s.admin.bans(page - 1, size);
    return ctx.reply(`Banned, page ${page} of ${Math.max(1, Math.ceil(total / size))} (${n0(total)} in all)\n${clip(rows.map((b) => `${esc(b.name || (b.kind === 'ip' ? 'address ' + b.value : 'a phone'))} by ${esc(b.by_who)} ${when(b.at)}${b.until ? ', until ' + when(b.until) : ''}: ${esc(b.reason)}`), 'Nobody.')}`);
  },
  baninfo(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const b = ctx.s.admin.banOf(u.id), rows = ctx.s.admin.banHistory(u.id, 10).map((x) => `${when(x.at)} by ${esc(x.by_who)}: ${esc(x.reason)}${x.lifted_at ? ` (lifted ${when(x.lifted_at)} by ${esc(x.lifted_by)}${x.lift_reason ? ': ' + esc(x.lift_reason) : ''})` : ''}`);
    return ctx.reply(`${line(u)} is ${b ? `**banned**${b.until ? ' until ' + when(b.until) : ' for good'}` : 'not banned'}.\n${clip(rows, 'No bans in the past.')}`);
  },
  kick(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const why = opt(d, 'reason') || 'An admin removed you from the game.', n = ctx.s.rooms.kickUser(u.id, why);
    if (!n) return ctx.reply(`${line(u)} is not in a room.`, { color: 'warn' });
    return done(ctx, 'kick', `${playerLine(u)}: ${why}`, `${line(u)} was removed from their room.`);
  },
  flags(ctx, d) {
    const count = opt(d, 'count') || 15;
    if (opt(d, 'player') !== undefined) {
      const u = target(ctx, d);
      if (u) return ctx.reply(`${line(u)}: ${ctx.s.admin.score(u.id)} of ${ctx.s.admin.banScore}\n${clip(ctx.s.admin.flags(u.id, count).map((f) => `${when(f.at)} **${esc(f.kind)}** (${f.score})${f.cleared ? ' cleared' : ''}: ${esc(f.detail)}`), 'Nothing.')}`);
      return undefined;
    }
    return ctx.reply(clip(ctx.s.admin.flags(null, count).map((f) => `${when(f.at)} ${line(f)} **${esc(f.kind)}**: ${esc(f.detail)}`), 'Nothing flagged. A quiet day.'));
  },
  suspects(ctx, d) {
    return ctx.reply(clip(ctx.s.admin.suspects(opt(d, 'count') || 15).map((u) => `${line(u)}: ${u.score} from ${u.n} flags, last ${when(u.last)}`), 'Nobody has anything against them.'));
  },
  clearflags(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const why = opt(d, 'reason') || '', n = ctx.s.admin.clearFlags(u.id);
    return done(ctx, 'clearflags', `${playerLine(u)}: ${why}`, `Forgot ${n} flags on ${line(u)}.`);
  },
  trust(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    ctx.s.admin.trust(u.id, true);
    return done(ctx, 'trust', playerLine(u), `${line(u)} is trusted. Flags are still reported, but nothing happens automatically.`);
  },
  untrust(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    ctx.s.admin.trust(u.id, false);
    return done(ctx, 'untrust', playerLine(u), `${line(u)} is treated like everyone else again.`);
  },
  anticheat(ctx, d) {
    const m = opt(d, 'mode'), a = ctx.s.admin;
    const says = (x) => (x === 'enforce' ? '**enforce**: only what the server sees in its own rerun of a climb pays, and repeated cheating bans automatically.' : '**watch**: everything is checked and reported, and coins are paid as before.');
    if (!m) return ctx.reply(`The anticheat is on ${says(a.mode)}\nBan at a score of ${a.banScore}.`);
    a.setMode(m);
    return done(ctx, 'anticheat', m, `The anticheat is now on ${says(m)}`);
  },
  phone(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const rows = ctx.s.admin.devices(u.id, 5).map((x) => `\`${x.device.slice(0, 16)}\` ${when(x.last)}\n${guardText(x.guard)}`);
    return ctx.reply(`${line(u)}\n${clip(rows, 'No phone reported yet.')}`);
  },
  rooms(ctx) {
    const rows = ctx.s.rooms.all().slice(0, 30).map((r) => {
      const who = r.users.map((id) => { const u = ctx.s.admin.info(id); return u ? line(u) : 'someone'; });
      return `\`${r.code}\` ${esc(r.name)}: ${r.n} climbers, ${esc(mapName(ctx, r.map))}, ${r.pub ? 'public' : 'private'}${r.locked ? ', password' : ''}, ${r.started ? 'playing' : 'in the lobby'}${who.length ? '\n  ' + who.join(', ') : ''}`;
    });
    return ctx.reply(clip(rows, 'No rooms open.'));
  },
  closeroom(ctx, d) {
    const code = String(opt(d, 'code')).toUpperCase(), why = opt(d, 'reason') || 'An admin closed this game.';
    if (!ctx.s.rooms.closeRoom(code, why)) return ctx.reply('No room has that code.', { color: 'warn' });
    return done(ctx, 'closeroom', `${code}: ${why}`, `Closed room ${esc(code)}.`);
  },
  status(ctx) {
    const s = ctx.s, m = process.memoryUsage(), b = ctx.bot.status(), v = s.verifier.stats, a = s.admin;
    return ctx.reply(`Server ${esc(s.version)}, up ${fmtH(process.uptime() * 1000)}\nMemory: ${Math.round(m.rss / 1048576)} MB\nAnticheat: **${a.mode}**, ${n0(v.chunks)} chunks checked since starting (${v.chunks ? Math.round(v.ms / v.chunks) : 0} ms each), ${v.flags} flags, ${s.verifier.queueLength()} waiting\nBot: ${b.on ? `${b.commands} commands, ${b.admins} admins, ${b.queue} messages waiting, ! commands ${b.bang ? 'on' : 'off'}, join and leave messages ${b.members ? 'on' : 'off'}${b.error ? `\nLast trouble: ${esc(b.error)}` : ''}` : 'off'}\nMaintenance: ${a.maintenance ? esc(a.maintenance) : 'off'}\nAnnouncement: ${a.liveAnnouncement() ? esc(a.liveAnnouncement().text) : 'none'}`);
  },
  announce(ctx, d) {
    const text = opt(d, 'text');
    if (String(text).toLowerCase() === 'off') {
      ctx.s.admin.announce('');
      return done(ctx, 'announce', 'removed', 'The announcement is gone.');
    }
    ctx.s.admin.announce(text, opt(d, 'minutes'));
    return done(ctx, 'announce', text, 'Everyone sees that the next time they open the game or come back to it.');
  },
  maintenance(ctx, d) {
    const on = opt(d, 'on'), msg = opt(d, 'message') || 'The server is having some work done. Back soon!';
    ctx.s.admin.setMaintenance(on ? msg : '');
    return done(ctx, 'maintenance', on ? `on: ${msg}` : 'off', on ? 'Maintenance is on: no new sign ins, climbs or rooms. Games already running carry on.' : 'Maintenance is off.');
  },
  logguests(ctx, d) {
    const on = opt(d, 'on');
    ctx.s.admin.setLogGuests(on);
    return done(ctx, 'logguests', on ? 'on' : 'off', on ? 'New guests are logged.' : 'New guests are not logged any more.');
  },
  backup(ctx) {
    return ctx.slow(async () => {
      const file = ctx.s.db.backup();
      ctx.s.admin.audit(ctx.who, 'backup', file);
      return `Backup made: \`${esc(file)}\`. The last 7 days are kept.`;
    });
  },
  audit(ctx, d) {
    return ctx.reply(clip(ctx.s.admin.auditLog(opt(d, 'count') || 15).map((x) => `${when(x.at)} ${esc(x.who)} /${esc(x.cmd)}: ${esc(x.detail)}`), 'Nothing yet.'));
  },
  setrole(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const text = String(opt(d, 'role')).trim().toLowerCase(), r = text === 'none' ? null : roleFrom(ctx, text);
    if (text !== 'none' && !r) return undefined;
    const role = r ? r.key : '', was = u.role || '', st = ctx.s.staff;
    if (role === was) return ctx.reply(`${line(u)} already has ${role ? `the ${esc(r.tag)} role` : 'no role'}.`, { color: 'warn' });
    if (r && !belowMe(ctx, r.rank)) return ctx.reply(`You can only give roles below your own rank (${st.rankOf(ctx.actor)}). ${esc(r.tag)} is ${r.rank}.`, { color: 'bad' });
    ctx.s.admin.setRole(u.id, role);
    ctx.s.friends.staffChanged(u.id);
    tell(ctx, u, r ? `You now have the ${r.tag} role in the game.` : 'Your role in the game was taken away.');
    return done(ctx, 'setrole', `${playerLine(u)}: ${roleTag(ctx, was) || 'none'} to ${r ? r.tag : 'none'}`, r ? `${line(u)} now has the **${esc(r.tag)}** role. It reaches their game within about 30 seconds.` : `${line(u)} has no role now.`);
  },
  roles(ctx) {
    const st = ctx.s.staff;
    const rows = st.list().map((r) => {
      const h = st.holders(r.key, 8), who = h.total ? `${h.rows.map(line).join(', ')}${h.total > h.rows.length ? ` and ${h.total - h.rows.length} more` : ''}` : 'nobody';
      return `**${esc(r.tag)}** \`${r.key}\`, rank ${r.rank}, ${r.color}\nMay use: ${r.key === 'owner' ? 'everything' : r.perms.length ? r.perms.join(', ') : 'nothing, it is only a flag'}\nHas it: ${who}`;
    });
    return ctx.reply(`Roles, highest rank first\n\n${rows.join('\n\n')}\n\nChange them with /newrole, /editrole, /delrole, /roleperm, /playerperm and /setrole.`);
  },
  newrole(ctx, d) {
    const rank = opt(d, 'rank') || 10;
    if (!belowMe(ctx, rank)) return ctx.reply(`A new role needs a rank below your own (${ctx.s.staff.rankOf(ctx.actor)}).`, { color: 'bad' });
    const r = ctx.s.staff.create(opt(d, 'key'), opt(d, 'tag'), opt(d, 'color'), rank);
    if (r.err) return ctx.reply(r.err, { color: 'warn' });
    ctx.s.friends.rolesChanged();
    return done(ctx, 'newrole', `${r.role.key} (${r.role.tag}, rank ${r.role.rank})`, `Made the role **${esc(r.role.tag)}** \`${r.role.key}\`, rank ${r.role.rank}, colour ${r.role.color}. It may use nothing yet: /roleperm ${r.role.key} add ... gives it commands, /setrole gives it to players.`);
  },
  editrole(ctx, d) {
    const r = roleFrom(ctx, opt(d, 'role'));
    if (!r) return undefined;
    const rank = opt(d, 'rank');
    if (!belowMe(ctx, r.rank) || (rank !== undefined && !belowMe(ctx, rank))) return ctx.reply('You can only change roles below your own rank, and keep them there.', { color: 'bad' });
    if (opt(d, 'tag') === undefined && opt(d, 'color') === undefined && rank === undefined) return ctx.reply(`**${esc(r.tag)}** \`${r.key}\`, rank ${r.rank}, colour ${r.color}. Give a tag, color or rank to change it.`);
    const out = ctx.s.staff.edit(r.key, { tag: opt(d, 'tag'), color: opt(d, 'color'), rank });
    if (out.err) return ctx.reply(out.err, { color: 'warn' });
    ctx.s.friends.rolesChanged();
    return done(ctx, 'editrole', `${r.key}: ${out.role.tag}, ${out.role.color}, rank ${out.role.rank}`, `**${esc(out.role.tag)}** \`${out.role.key}\` is now rank ${out.role.rank}, colour ${out.role.color}.`);
  },
  delrole(ctx, d) {
    if (opt(d, 'confirm') !== true) return ctx.reply('Nothing was deleted. Say confirm: true if you mean it.', { color: 'warn' });
    const r = roleFrom(ctx, opt(d, 'role'));
    if (!r) return undefined;
    if (!belowMe(ctx, r.rank)) return ctx.reply('You can only delete roles below your own rank.', { color: 'bad' });
    const out = ctx.s.staff.remove(r.key);
    if (out.err) return ctx.reply(out.err, { color: 'warn' });
    ctx.s.friends.rolesChanged();
    return done(ctx, 'delrole', `${r.key} (${out.n} players had it)`, `Deleted the role ${esc(r.tag)}. ${out.n} player(s) had it and have no role now.`);
  },
  roleperm(ctx, d) {
    const r = roleFrom(ctx, opt(d, 'role'));
    if (!r) return undefined;
    const perm = permFrom(ctx, opt(d, 'perm')), add = opt(d, 'action') === 'add';
    if (!perm) return undefined;
    if (!belowMe(ctx, r.rank)) return ctx.reply('You can only change roles below your own rank.', { color: 'bad' });
    if (add && !mayGivePerm(ctx, perm)) return ctx.reply(`You can only hand out what you may use yourself, and ${perm} is not.`, { color: 'bad' });
    const out = ctx.s.staff.setRolePerm(r.key, perm, add);
    if (out.err) return ctx.reply(out.err, { color: 'warn' });
    if (out.same) return ctx.reply(`${esc(r.tag)} ${add ? 'already has' : 'does not have'} ${perm}.`, { color: 'warn' });
    ctx.s.friends.staffChanged(null);
    const note = !add && r.perms.some((p) => p !== perm && p.startsWith('@')) ? ' It may still come from a group the role has.' : '';
    return done(ctx, 'roleperm', `${r.key} ${add ? '+' : 'minus '}${perm}`, `${esc(r.tag)} ${add ? 'may now use' : 'may no longer use'} **${perm}**.${note}`);
  },
  playerperm(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const perm = permFrom(ctx, opt(d, 'perm')), mode = opt(d, 'action');
    if (!perm) return undefined;
    if (ctx.s.staff.isOwner(u)) return ctx.reply(`${line(u)} is an owner and may always do everything.`, { color: 'warn' });
    if (mode === 'allow' && !mayGivePerm(ctx, perm)) return ctx.reply(`You can only hand out what you may use yourself, and ${perm} is not.`, { color: 'bad' });
    const changed = ctx.s.staff.setUserPerm(u.id, perm, mode);
    if (mode === 'reset' && !changed) return ctx.reply(`${line(u)} had nothing of their own for ${perm}: it comes from their role.`, { color: 'warn' });
    ctx.s.friends.staffChanged(u.id);
    const said = mode === 'allow' ? `may now use **${perm}**, whatever their role says` : mode === 'deny' ? `may not use **${perm}**, whatever their role says` : `goes by their role again for **${perm}**`;
    return done(ctx, 'playerperm', `${playerLine(u)} ${mode} ${perm}`, `${line(u)} ${said}.`);
  },
  perms(ctx, d) {
    const st = ctx.s.staff, who = opt(d, 'who');
    if (who === undefined && !ctx.game) return ctx.reply(`Permissions are command names, groups of them or * for all. A role has a list of them, and one player can be allowed or denied single ones on top (/playerperm).\n${Object.entries(GROUPS).map(([g, l]) => `**@${g}**: ${l.join(', ')}`).join('\n')}`);
    const r = who !== undefined ? st.findRole(who) : null;
    if (r) return ctx.reply(`**${esc(r.tag)}** \`${r.key}\`, rank ${r.rank}\nGiven: ${r.key === 'owner' ? 'everything' : r.perms.join(', ') || 'nothing'}`);
    let u = ctx.actor;
    if (who !== undefined) {
      if (ctx.game && !ctx.can('perms')) return ctx.reply('You may only see your own.', { color: 'bad' });
      u = target(ctx, { options: [{ name: 'player', value: who }] });
    }
    if (!u) return undefined;
    const own = st.userPerms(u.id), tag = roleTag(ctx, u.role);
    return ctx.reply(`${line(u)}: ${tag ? `role **${esc(tag)}**, rank ${st.rankOf(u)}` : 'no role'}${own.length ? `\nTheir own: ${own.map((x) => (x.allow ? '+' : 'not ') + x.perm).join(', ')}` : ''}${st.vanished(u.id) ? '\nVanished.' : ''}\n${st.isOwner(u) ? 'May use everything.' : permsText(ctx, u)}`);
  },
  // ---------------------------------------------------------------- live, in the game
  vanish(ctx, d) {
    const u = opt(d, 'player') !== undefined ? target(ctx, d) : self(ctx);
    if (!u) return undefined;
    const st = ctx.s.staff, was = st.vanished(u.id), on = opt(d, 'on') === undefined ? !was : opt(d, 'on');
    if (on === was) return ctx.reply(`${line(u)} is ${on ? 'already vanished' : 'not vanished'}.`, { color: 'warn' });
    st.setVanish(u.id, on);
    ctx.s.friends.vanishChanged(u.id);
    return done(ctx, 'vanish', `${playerLine(u)} ${on ? 'on' : 'off'}`, on ? `${line(u)} is vanished: their friends see them as offline. On a climb their stickman is gone for everyone and they fly: that climb stops earning, and /vanish off drops them where they are. /watch a player or /join a room to fly around it unseen as well: nobody there is told.` : `${line(u)} can be seen again.`);
  },
  watch(ctx, d) {
    if (!ctx.game) return ctx.reply(IN_GAME, { color: 'warn' });
    const u = target(ctx, d);
    if (!u) return undefined;
    if (u.id === ctx.actor.id) return ctx.reply('That is you.', { color: 'warn' });
    const p = ctx.s.friends.presence(u.id);
    if (p.st !== 'climb') return ctx.reply(`${line(u)} is not climbing right now: ${doing(ctx, p)}.`, { color: 'warn' });
    ctx.act({ watch: u.num, name: u.game_name || u.name });
    return ctx.reply(`Watching ${line(u)}.${ctx.s.staff.vanished(ctx.actor.id) ? ' You are vanished, so they are not told.' : ' They see that you are watching: /vanish first to stay hidden.'}`);
  },
  join(ctx, d) {
    if (!ctx.game) return ctx.reply(IN_GAME, { color: 'warn' });
    const text = String(opt(d, 'player') || '').trim(), rooms = ctx.s.rooms;
    const codeLike = /^[A-Za-z0-9]{5}$/.test(text);
    let room = codeLike ? rooms.room(text.toUpperCase()) : null;
    if (!room && codeLike && ctx.s.admin.find(text).none) return ctx.reply(`No room has the code ${esc(text.toUpperCase())} right now, and no player is called that. /rooms lists the open rooms.`, { color: 'warn' });
    if (!room) {
      const u = target(ctx, d);
      if (!u) return undefined;
      if (u.id === ctx.actor.id) return ctx.reply('That is you.', { color: 'warn' });
      const at = rooms.roomOf(u.id), p = ctx.s.friends.presence(u.id);
      room = at ? rooms.room(at.code) : null;
      if (!room && p.room && p.room.kind === 'online') return ctx.reply(`${line(u)} is in an Online room (${p.room.code}). Those don't go through this server, so only its own password lets anyone in: try Join a game, Online. /watch shows their climb.`, { color: 'warn' });
      if (!room && p.st === 'climb') return ctx.reply(`${line(u)} is climbing alone, so there is no room to join. /watch ${u.num} shows the climb.`, { color: 'warn' });
      if (!room) return ctx.reply(`${line(u)} is not in a room: ${doing(ctx, p)}.`, { color: 'warn' });
    }
    if (ctx.s.staff.vanished(ctx.actor.id)) {
      // Climbing in a room shows you to everyone there, so a vanished join watches it through its host instead.
      const host = room.host.userId ? ctx.s.admin.info(room.host.userId) : null;
      if (!host || ctx.s.friends.presence(host.id).st !== 'climb') return ctx.reply(`You are vanished, and climbing in room ${room.code} would show you to everyone in it. ${room.started ? 'Its host can not be watched right now either.' : 'They have not started climbing yet, so there is nothing to watch.'} /vanish off, then /join, to climb with them.`, { color: 'warn' });
      ctx.act({ watch: host.num, name: host.game_name || host.name });
      return ctx.reply(`You are vanished, so you watch room ${room.code} through its host ${line(host)} instead of climbing in it. Nobody is told. /vanish off, then /join, to climb with them.`);
    }
    if (room.peers.size >= 3) return ctx.reply(`Room ${room.code} is full (4 climbers).`, { color: 'warn' });
    ctx.act({ join: room.code });
    return ctx.reply(`Joining room ${room.code}${room.hash ? ' past its password' : ''}. Everyone in it sees you join and climb.`);
  },
  tell(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const text = opt(d, 'text');
    ctx.s.admin.tell(u.id, `Message from ${ctx.game ? ctx.whoShort : 'the team'}: ${text}`);
    return done(ctx, 'tell', `${playerLine(u)}: ${text}`, `Sent to ${line(u)}. It shows in their game within about 30 seconds, or the next time they open it.`);
  },
  // The game knows where everyone is, the server does not: a height, the start and the top are worked out by the climber's
  // game, and for a player the server asks that player's game first.
  tp(ctx, d) {
    const u = /^me$/i.test(String(opt(d, 'player')).trim()) ? self(ctx) : target(ctx, d);
    if (!u) return undefined;
    const f = ctx.s.friends, to = String(opt(d, 'to')).trim(), low = to.toLowerCase(), said = opt(d, 'reason');
    const at = f ? f.presence(u.id) : { st: 'off' };
    if (at.st !== 'climb') return ctx.reply(`${line(u)} is not climbing right now, so there is nothing to move.`, { color: 'warn' });
    const note = `${playerLine(u)} to ${to}: ${said || 'no reason given'}`, after = ' That climb stops earning from here.';
    const place = low === 'start' ? { h: 0 } : low === 'top' ? { top: true } : /^\d{1,5}\s*m$/.test(low) ? { h: parseInt(low, 10) } : null;
    if (place) {
      f.tell(u.id, Object.assign({ t: 'tp' }, place));
      tell(ctx, u, 'The team moved you.', said);
      return done(ctx, 'tp', note, `Moved ${line(u)} ${place.top ? 'to the top' : place.h ? `to the checkpoint at or below ${place.h} m` : 'to the start'}.${after}`);
    }
    let o;
    if (low === 'me') { o = self(ctx); if (!o) return undefined; } else {
      const r = ctx.s.admin.find(to);
      if (r.many) return ctx.reply(`More than one player is called that. Use a number:\n${r.many.map(line).join('\n')}`, { color: 'warn' });
      o = r.id ? ctx.s.admin.info(r.id) : null;
      if (!o) return ctx.reply(`"${esc(to)}" is not a player. Use a player, a height like 300m, start or top.`, { color: 'warn' });
    }
    if (o.id === u.id) return ctx.reply('That is the same player.', { color: 'warn' });
    if (f.presence(o.id).st !== 'climb') return ctx.reply(`${line(o)} is not climbing right now.`, { color: 'warn' });
    return safely(ctx, async () => {
      const p = await f.askWhere(o.id);
      if (!p) return `${line(o)} did not say where they are. Try again in a moment.`;
      if (p.map !== at.map || p.diff !== at.diff) return `${line(u)} and ${line(o)} are not on the same map and difficulty.`;
      f.tell(u.id, { t: 'tp', pos: p.pos, map: p.map, diff: p.diff });
      tell(ctx, u, 'The team moved you.', said);
      ctx.s.admin.audit(ctx.who, 'tp', note);
      ctx.bot.log('Admin', `**${esc(ctx.whoShort)}** used /tp\n${esc(note)}`);
      return `Moved ${line(u)} to ${line(o)}.${after}`;
    });
  },
  resetcheckpoint(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const said = opt(d, 'reason'), at = ctx.s.db.resetCheckpoint(u.id);
    if (ctx.s.friends) ctx.s.friends.tell(u.id, { t: 'cpreset', at });
    tell(ctx, u, 'The team reset your checkpoint: your climb starts again from the start of the map.', said);
    return done(ctx, 'resetcheckpoint', `${playerLine(u)}: ${said || 'no reason given'}`, `Reset the checkpoint of ${line(u)}. If they are climbing they go back to the start of the map right away, or within about 30 seconds. If not, their saved climb is gone the next time they open the game. In a room with the cord they climb on their own until they reach the team again; if they are the host, the whole team goes back.${withWhy(said)}`);
  },
  giverelic(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const f = ctx.s.wallet.findRelics(opt(d, 'relic'));
    if (f.err) return ctx.reply(`${esc(f.err)}${didYouMean(closest(opt(d, 'relic'), ctx.s.wallet.relicList().map((x) => x[0])))}`, { color: 'warn' });
    const said = opt(d, 'reason'), why = said || 'no reason given', got = ctx.s.wallet.giveRelics(u.id, f.list, `${ctx.whoShort}: ${why}`);
    if (!got.length) return ctx.reply(`${line(u)} already has ${f.list.length > 1 ? 'all of those' : 'that one'}.`, { color: 'warn' });
    const names = got.map((x) => ctx.s.wallet.relicName(x));
    tell(ctx, u, got.length === 1 ? `You got a relic: ${names[0]}. What it opens can be bought in the shop now.` : `You got ${got.length} relics. What they open can be bought in the shop now.`, said);
    return done(ctx, 'giverelic', `${got.join(', ')} to ${playerLine(u)}: ${why}`, `Gave ${line(u)} ${got.length === 1 ? 'the relic' : `${got.length} relics:`} ${esc(names.join(', '))}.${withWhy(said)}`);
  },
  takerelic(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const f = ctx.s.wallet.findRelics(opt(d, 'relic'));
    if (f.err) return ctx.reply(`${esc(f.err)}${didYouMean(closest(opt(d, 'relic'), ctx.s.wallet.relicList().map((x) => x[0])))}`, { color: 'warn' });
    const said = opt(d, 'reason'), why = said || 'no reason given', gone = ctx.s.wallet.takeRelics(u.id, f.list, `${ctx.whoShort}: ${why}`);
    if (!gone.length) return ctx.reply(`${line(u)} does not have ${f.list.length > 1 ? 'any of those' : 'that one'}.`, { color: 'warn' });
    tell(ctx, u, gone.length === 1 ? `A relic was taken from you: ${ctx.s.wallet.relicName(gone[0])}.` : `${gone.length} relics were taken from you.`, said);
    return done(ctx, 'takerelic', `${gone.join(', ')} from ${playerLine(u)}: ${why}`, `Took ${gone.length} relic(s) from ${line(u)}: ${esc(gone.map((x) => ctx.s.wallet.relicName(x)).join(', '))}. What they bought with them stays theirs.${withWhy(said)}`);
  },
  welcome(ctx, d) {
    const c = ctx.bot.community, cfg = c.config('welcome'), ch = opt(d, 'channel'), leave = opt(d, 'leavechannel'), msg = opt(d, 'message');
    if (opt(d, 'test') === true) {
      if (!cfg.channel) return ctx.reply('Pick a channel first: /welcome channel', { color: 'warn' });
      c.onJoin({ user: ctx.whoUser });
      c.onLeave({ user: ctx.whoUser });
      return ctx.reply(`Sent the examples to <#${cfg.channel}>${cfg.leave ? ` and <#${cfg.leave}>` : ''}.`);
    }
    if (opt(d, 'off') === true) {
      c.setConfig('welcome', Object.assign(cfg, { channel: '', leave: '' }));
      return done(ctx, 'welcome', 'off', 'Join and leave messages are off.');
    }
    if (ch === undefined && leave === undefined && msg === undefined) {
      if (!cfg.channel) return ctx.reply('Join and leave messages are not set up. Use /welcome with a channel.');
      return ctx.reply(`Joins go to <#${cfg.channel}>, leaves to <#${cfg.leave || cfg.channel}>.\nThe welcome says: ${esc(cfg.text || DEFAULT_WELCOME)}${ctx.bot.noMembers ? '\n**Nothing will be sent yet: turn on Server Members Intent in the Discord developer portal, then restart the server.**' : ''}`);
    }
    if (ch !== undefined) cfg.channel = ch;
    if (leave !== undefined) cfg.leave = leave;
    if (msg !== undefined) cfg.text = msg;
    c.setConfig('welcome', cfg);
    if (!cfg.channel) return ctx.reply('Saved, but it also needs a channel: /welcome with a channel.', { color: 'warn' });
    return done(ctx, 'welcome', `joins <#${cfg.channel}>, leaves <#${cfg.leave || cfg.channel}>`, `Joins go to <#${cfg.channel}>, leaves to <#${cfg.leave || cfg.channel}>. Try it with the test option.${ctx.bot.noMembers ? '\n**Nothing will be sent yet: turn on Server Members Intent in the Discord developer portal, then restart the server.**' : ''}`);
  },
  ticketsetup(ctx, d) {
    const c = ctx.bot.community, cfg = c.config('tickets'), cat = opt(d, 'category'), log = opt(d, 'logchannel'), role = opt(d, 'staffrole');
    if (cat !== undefined) cfg.category = cat;
    if (log !== undefined) cfg.log = log;
    if (role !== undefined) cfg.staff = role;
    const how = `New tickets go ${cfg.category ? `in <#${cfg.category}>` : 'outside any category'}.\nFinished tickets are posted in <#${cfg.log || ctx.bot.logChannel}>.\n${cfg.staff ? `<@&${cfg.staff}>` : 'Only people on the bot\'s admin list and Discord admins'} can see and answer them.`;
    if (cat === undefined && log === undefined && role === undefined) return ctx.reply(how);
    c.setConfig('tickets', cfg);
    return done(ctx, 'ticketsetup', how.split('\n').join(' '), how);
  },
  ticketpanel(ctx, d) {
    const ch = opt(d, 'channel'), text = opt(d, 'text');
    return safely(ctx, async () => {
      if (!(await ctx.bot.community.postPanel(ch, text))) return `Could not write in <#${ch}>. Can the bot see that channel and write in it?`;
      ctx.s.admin.audit(ctx.who, 'ticketpanel', ch);
      return `The ticket button is now in <#${ch}>.`;
    });
  },
  tickets(ctx, d) {
    const user = opt(d, 'user'), status = opt(d, 'status') || 'open';
    const rows = ctx.bot.community.list({ user, status, count: opt(d, 'count') });
    const text = rows.map((t) => `**${t.num}** ${t.closed_at ? 'closed' : t.channel_id ? `<#${t.channel_id}>` : 'being made'} ${esc(t.user_name)}, ${when(t.opened_at)}: ${esc(t.topic.slice(0, 60))}`);
    return ctx.reply(`${user ? `Tickets of <@${user}>` : status === 'all' ? 'All tickets' : status === 'closed' ? 'Closed tickets' : 'Open tickets'}\n${clip(text, 'None.')}`);
  },
  transcript(ctx, d) {
    const num = opt(d, 'number'), c = ctx.bot.community;
    if (!c.ticket(num)) return ctx.reply(`There is no ticket ${num}.`, { color: 'warn' });
    return safely(ctx, async () => {
      if (!(await c.postTranscript(num))) return 'Could not post the file. The bot needs Attach Files in that channel.';
      ctx.s.admin.audit(ctx.who, 'transcript', String(num));
      return `Ticket ${num} is posted in <#${c.config('tickets').log || ctx.bot.logChannel}>.`;
    });
  },
  closeticket(ctx, d) {
    const num = opt(d, 'number'), c = ctx.bot.community, t = num !== undefined ? c.ticket(num) : c.ticketIn(ctx.channel);
    if (!t) return ctx.reply(num !== undefined ? `There is no ticket ${num}.` : 'This channel is not a ticket. Give a number.', { color: 'warn' });
    if (t.closed_at) return ctx.reply(`Ticket ${t.num} is already closed.`, { color: 'warn' });
    const why = opt(d, 'reason') || '';
    return safely(ctx, async () => {
      if (!(await c.close(t, ctx.whoShort, why))) return `Ticket ${t.num} is already closed.`;
      ctx.s.admin.audit(ctx.who, 'closeticket', `${t.num}: ${why}`);
      return `Ticket ${t.num} is closed and saved.`;
    });
  },
  admins(ctx) {
    return ctx.reply(`These Discord accounts may use the bot:\n${clip([...ctx.bot.admins].map((id) => `<@${id}> \`${id}\``), 'Nobody.')}\nChange the list with: install.sh --bot`);
  },
};

function guardText(g) {
  if (!g) return 'No checks reported.';
  const out = [];
  if (g.attest) out.push(`Hardware check: ${g.attest}`);
  if (g.root) out.push('Rooted');
  if (g.sig === false) out.push('**Not the official app**');
  if (g.assets === false) out.push('**Game files changed**');
  if (g.dbg) out.push('**Debugger attached**');
  if (g.frida) out.push('**Frida found**');
  if (g.hook) out.push('**Xposed or similar found**');
  if (g.apps && g.apps.length) out.push(`**Cheat apps installed**: ${g.apps.map(esc).join(', ')}`);
  if (g.emu) out.push('Emulator');
  if (g.model) out.push(`Phone: ${esc(g.model)}, Android ${esc(g.sdk)}`);
  return out.join('\n') || 'Nothing unusual.';
}

// ---------------------------------------------------------------- how a command gets run
// ---------------------------------------------------------------- the same commands, typed with a !
// Discord checks numbers, lengths and lists before a slash command gets here, and the commands count on that. So it all gets
// checked here too: this is what stops a "!givecoins Ana -5".
const usage = (f, mark = '!') => `${mark}${f.name} ${f.options.map((o) => (o.required ? o.name : `[${o.name}]`)).join(' ')}`.trim();
// These take all the words that are left.
const MANY_WORDS = new Set(['reason', 'text', 'message', 'name', 'search']);
const YES = new Set(['true', 'yes', 'y', 'on', '1']), NO = new Set(['false', 'no', 'n', 'off', '0']);

function splitWords(line) {
  const out = [], re = /(?:([a-z]+)[=:])?"([^"]*)"|(\S+)/gi;
  // Phones like to turn quotes into curly ones.
  const text = String(line).replace(/[\u201c\u201d\u201e]/g, '"');
  for (let m; (m = re.exec(text));) {
    if (m[2] !== undefined) out.push({ key: m[1] ? m[1].toLowerCase() : '', value: m[2], whole: m[1] ? `${m[1]}:${m[2]}` : m[2] });
    else {
      const k = /^([a-z]+)[=:](.+)$/i.exec(m[3]);
      out.push({ key: k ? k[1].toLowerCase() : '', value: k ? k[2] : m[3], whole: m[3] });
    }
  }
  return out;
}
function checkValue(o, text) {
  // A person, a channel or a role: as a mention or as a plain ID.
  if (o.type === 6 || o.type === 7 || o.type === 8) {
    const id = /^(?:<[@#]?[!&]?)?(\d{15,22})>?$/.exec(text);
    return id ? { value: id[1] } : { err: `\`${o.name}\` has to be a mention or an ID.` };
  }
  if (o.type === 5) {
    const v = text.toLowerCase();
    if (YES.has(v)) return { value: true };
    if (NO.has(v)) return { value: false };
    return { err: `\`${o.name}\` has to be yes or no.` };
  }
  if (o.type === 4) {
    const v = /^-?\d{1,16}$/.test(text) ? Number(text) : NaN;
    if (!Number.isSafeInteger(v)) return { err: `\`${o.name}\` has to be a whole number.` };
    if (o.min_value !== undefined && v < o.min_value) return { err: `\`${o.name}\` can't be below ${o.min_value}.` };
    if (o.max_value !== undefined && v > o.max_value) return { err: `\`${o.name}\` can't be above ${o.max_value}.` };
    return { value: v };
  }
  if (o.choices) {
    const low = text.toLowerCase(), c = o.choices.find((x) => String(x.value).toLowerCase() === low || x.name.toLowerCase() === low);
    if (!c) return { err: `\`${o.name}\` has to be one of: ${o.choices.map((x) => x.value).join(', ')}.` };
    return { value: c.value };
  }
  if (o.max_length !== undefined && text.length > o.max_length) return { err: `\`${o.name}\` can be ${o.max_length} letters at most.` };
  if (o.min_length !== undefined && text.length < o.min_length) return { err: `\`${o.name}\` needs ${o.min_length} letters at least.` };
  return { value: text };
}
// Answers null when this isn't a command at all, { unknown } for a name we don't have, { err, usage } when it can't run, and otherwise { data } just as a slash command would give it.
function parseBang(content) {
  const m = /^!([a-z]+)(?:\s+([\s\S]*))?$/i.exec(String(content).trim());
  if (!m) return null;
  const f = COMMANDS.find((c) => c.name === m[1].toLowerCase());
  if (!f) return { unknown: m[1], near: closest(m[1], COMMANDS.map((c) => c.name)) };
  const got = new Map(), free = [];
  for (const w of splitWords(m[2] || '')) {
    const o = w.key ? f.options.find((x) => x.name === w.key) : null;
    if (o && !got.has(o.name)) got.set(o.name, w.value);
    else free.push(w.whole);
  }
  const open = f.options.filter((o) => !got.has(o.name));
  for (let k = 0; k < open.length && free.length; k++) {
    const o = open[k];
    if (o.type === 3 && MANY_WORDS.has(o.name)) {
      // What is needed after this comes off the end: "!giveall 5 a nice gift yes".
      const later = open.slice(k + 1).filter((x) => x.required).length;
      got.set(o.name, free.splice(0, Math.max(1, free.length - later)).join(' '));
    } else got.set(o.name, free.shift());
  }
  const use = usage(f);
  if (free.length) return { name: f.name, err: `Too many words: "${free.join(' ').slice(0, 100)}". A name with spaces goes in quotes.`, usage: use };
  const missing = f.options.filter((o) => o.required && !got.has(o.name));
  if (missing.length) return { name: f.name, err: `Missing: ${missing.map((o) => o.name).join(', ')}.`, usage: use };
  const options = [];
  for (const o of f.options) {
    if (!got.has(o.name)) continue;
    const r = checkValue(o, got.get(o.name));
    if (r.err) return { name: f.name, err: r.err, usage: use };
    options.push({ name: o.name, type: o.type, value: r.value });
  }
  return { data: { name: f.name, options } };
}

function runCommand(ctx, data) {
  const f = Object.hasOwn(RUN, data.name) ? RUN[data.name] : null;
  if (!f) return ctx.reply('This server does not know that command.', { color: 'warn' });
  if (ctx.game) {
    if (DISCORD_ONLY.has(data.name)) return ctx.reply('That one only works on Discord.', { color: 'warn' });
    if (!ctx.can(data.name)) return ctx.reply(`You may not use /${data.name}. /perms shows what you may.`, { color: 'bad' });
  }
  ctx.cmd = data.name;
  try {
    return f(ctx, data);
  } catch (e) {
    console.error(`bot: /${data.name} failed:`, e.message);
    return ctx.reply('That went wrong on the server. Nothing was changed, as far as can be told. The server log has the details.', { color: 'bad' });
  }
}

// The buttons under a cheater warning.
function runButton(ctx, id) {
  const m = /^ac:(ban|info|clear):(.+)$/.exec(String(id));
  if (!m) return ctx.reply('That button is too old.', { color: 'warn' });
  const u = ctx.s.admin.info(m[2]);
  if (!u) return ctx.reply('That player is gone.', { color: 'warn' });
  if (m[1] === 'info') return ctx.reply(playerText(ctx, u));
  if (m[1] === 'clear') {
    const n = ctx.s.admin.clearFlags(u.id);
    return done(ctx, 'clearflags', playerLine(u), `Forgot ${n} flags on ${line(u)}.`);
  }
  const last = ctx.s.admin.flags(u.id, 1)[0];
  return ctx.modal({ custom_id: `ac:banreason:${u.id}`, title: `Ban ${String(u.name).slice(0, 30)}`, components: [{ type: 1, components: [{ type: 4, custom_id: 'reason', label: 'Reason, shown to the player', style: 2, required: true, max_length: 300, value: last ? String(last.detail).slice(0, 300) : 'Cheating' }] }] });
}
function runModal(ctx, data) {
  const m = /^ac:banreason:(.+)$/.exec(String(data.custom_id));
  if (!m) return ctx.reply('That form is too old.', { color: 'warn' });
  const u = ctx.s.admin.info(m[1]);
  if (!u) return ctx.reply('That player is gone.', { color: 'warn' });
  const reason = (((data.components || [])[0] || {}).components || [])[0]?.value || 'Cheating';
  ctx.s.admin.ban({ userId: u.id, reason, by: ctx.whoShort, ip: u.last_ip, device: u.device });
  return done(ctx, 'ban', `${playerLine(u)}: ${reason}`, `Banned ${line(u)}. Reason: ${esc(reason)}`);
}

// What Discord shows while a name is being typed.
function suggest(s, data) {
  const focus = (data.options || []).find((o) => o.focused);
  if (!focus) return [];
  const text = String(focus.value || '');
  if (focus.name === 'player') {
    return s.admin.search(text, 25).map((u) => ({ name: String(`${nameOf(u)} #${u.num}`).slice(0, 100), value: String(u.id) }));
  }
  if (focus.name === 'item') {
    const q = text.toLowerCase();
    return s.wallet.catalogList().filter(([k, name]) => k.toLowerCase().includes(q) || name.toLowerCase().includes(q)).slice(0, 25).map(([k, name]) => ({ name: `${name} (${k})`.slice(0, 100), value: k }));
  }
  if (focus.name === 'role') {
    const q = text.toLowerCase();
    return [{ name: 'none (take it away)', value: 'none' }, ...s.staff.list().map((r) => ({ name: `${r.tag} (${r.key}, rank ${r.rank})`, value: r.key }))].filter((c) => c.name.toLowerCase().includes(q)).slice(0, 25);
  }
  if (focus.name === 'perm') {
    const q = text.toLowerCase();
    return s.staff.permNames().filter((n) => n.includes(q)).slice(0, 25).map((n) => ({ name: n, value: n }));
  }
  if (focus.name === 'relic') {
    const q = text.toLowerCase();
    return [['all', 'Every relic'], ...s.wallet.mapNames.map((m) => [m, `Every relic on ${m}`]), ...s.wallet.relicList()].filter(([k, n]) => k.includes(q) || n.toLowerCase().includes(q)).slice(0, 25).map(([k, n]) => ({ name: `${n} (${k})`.slice(0, 100), value: k }));
  }
  if (focus.name === 'who') {
    const q = text.toLowerCase();
    return [...s.staff.list().filter((r) => r.key.includes(q) || r.tag.toLowerCase().includes(q)).map((r) => ({ name: `Role ${r.tag}`, value: r.key })), ...s.admin.search(text, 20).map((u) => ({ name: String(`${nameOf(u)} #${u.num}`).slice(0, 100), value: String(u.id) }))].slice(0, 25);
  }
  if (focus.name === 'command') {
    const q = text.toLowerCase();
    return COMMANDS.filter((c) => c.name.includes(q)).slice(0, 25).map((c) => ({ name: c.name, value: c.name }));
  }
  return [];
}

module.exports = { COMMANDS, RUN, GROUPS, DISCORD_ONLY, GAME_ONLY, runCommand, runButton, runModal, suggest, playerLine, guardText, parseBang, usage, closest, didYouMean };
