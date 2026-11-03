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
const cmd = (name, description, ...options) => ({ name, description, options, type: 1, dm_permission: false });

const COMMANDS = [
  cmd('help', 'What the bot can do', { type: 3, name: 'command', description: 'One command, for its details', required: false, autocomplete: true }),
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
  cmd('catalog', 'What is on sale, and the names to use for items', { type: 3, name: 'search', description: 'Part of a name', required: false, max_length: 40 }),
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
  // The server
  cmd('status', 'How the server is doing'),
  cmd('announce', 'Show a message to everyone in the game', { type: 3, name: 'text', description: 'The message. "off" removes it', required: true, max_length: 400 }, { type: 4, name: 'minutes', description: 'For how long (empty for until removed)', required: false, min_value: 1, max_value: 100000 }),
  cmd('maintenance', 'Stop sign ins, new climbs and rooms for a while', { type: 5, name: 'on', description: 'On or off', required: true }, { type: 3, name: 'message', description: 'What players are told', required: false, max_length: 300 }),
  cmd('logguests', 'Log new guests in the channel, or not', { type: 5, name: 'on', description: 'On or off', required: true }),
  cmd('backup', 'Make a backup of everything now'),
  cmd('audit', 'What the admins did lately', COUNT),
  cmd('admins', 'Who may use the bot'),
  cmd('setrole', 'Give a player a flag in the game, or take it away', PLAYER, { type: 3, name: 'role', description: 'The flag, or none to take it away', required: true, choices: [{ name: 'owner', value: 'owner' }, { name: 'admin', value: 'admin' }, { name: 'mod', value: 'mod' }, { name: 'none', value: 'none' }] }),
  cmd('roles', 'Everyone with a flag in the game'),
  cmd('welcome', 'Where to say who joined and who left, or see how it is set', { type: 7, name: 'channel', description: 'The channel for joins, and for leaves unless given below', required: false, channel_types: [0, 5] }, { type: 7, name: 'leavechannel', description: 'Another channel for who left (optional)', required: false, channel_types: [0, 5] }, { type: 3, name: 'message', description: 'The welcome. {user} pings them, {name} is their name', required: false, max_length: 500 }, { type: 5, name: 'off', description: 'Turn these messages off', required: false }, { type: 5, name: 'test', description: 'Show both messages using you as the example', required: false }),
  cmd('ticketsetup', 'Where tickets go and who answers them, or see how it is set', { type: 7, name: 'category', description: 'The category new ticket channels go in', required: false, channel_types: [4] }, { type: 7, name: 'logchannel', description: 'A private channel for finished tickets (otherwise the log channel)', required: false, channel_types: [0] }, { type: 8, name: 'staffrole', description: 'The role that sees and answers tickets', required: false }),
  cmd('ticketpanel', 'Put the Open a ticket button in a channel', { type: 7, name: 'channel', description: 'The channel for the button', required: true, channel_types: [0, 5] }, { type: 3, name: 'text', description: 'What it says above the button', required: false, max_length: 1500 }),
  cmd('tickets', 'List tickets: open ones, or for one person', { type: 3, name: 'status', description: 'Which tickets', required: false, choices: [{ name: 'open', value: 'open' }, { name: 'closed', value: 'closed' }, { name: 'all', value: 'all' }] }, { type: 6, name: 'user', description: 'All tickets of this person', required: false }, COUNT),
  cmd('transcript', 'Post what was said in a ticket, as a file in the private channel', { type: 4, name: 'number', description: 'The ticket number', required: true, min_value: 1, max_value: 100000000 }),
  cmd('closeticket', 'Close a ticket. Without a number, the one in this channel', { type: 4, name: 'number', description: 'The ticket number', required: false, min_value: 1, max_value: 100000000 }, REASON(false)),
];

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s == null ? '' : s).replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/([\\`*_~|>#@:[\]()-])/g, '\\$1').slice(0, 300);
const code = (s) => String(s == null ? '' : s).replace(/[`\s]/g, '').slice(0, 80);
const when = (t) => (t ? `<t:${Math.floor(t / 1000)}:R>` : 'never');
const n0 = (v) => Number(v || 0).toLocaleString('en-US');
const opt = (data, name) => { const o = (data.options || []).find((x) => x.name === name); return o ? o.value : undefined; };
const nameOf = (u) => (u.game_name && u.game_name !== u.name ? `${u.name} (plays as ${u.game_name})` : u.name);
const playerLine = (u) => `${nameOf(u)} #${u.num}`;
const line = (u) => `\`#${u.num}\` ${esc(nameOf(u))}`;
const ROLE_NAME = { owner: 'Owner', admin: 'Admin', mod: 'Mod' };
const PROVIDER = { discord: 'Discord', google: 'Google', steam: 'Steam', guest: 'Guest' };
const DIFF = ['Easy', 'Normal', 'Hardcore', 'Insane'];
const fmtH = (ms) => { const m = Math.floor(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const clip = (rows, none) => (rows.length ? rows.join('\n') : none);

// Finds the player the command is about, or explains why it can't. Several people called the same? Then it lists them.
function target(ctx, data, name = 'player') {
  const text = opt(data, name), r = ctx.s.admin.find(text);
  if (r.id) return ctx.s.admin.info(r.id);
  if (r.many) ctx.reply(`More than one player is called that. Use a number:\n${r.many.map(line).join('\n')}`, { color: 'warn' });
  else ctx.reply(`No player found for "${esc(text)}".`, { color: 'warn' });
  return null;
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
  if (ROLE_NAME[u.role]) out.push(`Flag in the game: **${ROLE_NAME[u.role]}**`);
  out.push(`Last address: \`${code(u.last_ip || 'unknown')}\``);
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
    const c = opt(d, 'command');
    if (c) {
      const f = COMMANDS.find((x) => x.name === String(c).replace(/^\//, ''));
      if (!f) return ctx.reply('No such command.', { color: 'warn' });
      return ctx.reply(`**${ctx.bang ? '!' : '/'}${f.name}**: ${f.description}\n${ctx.bang ? `\`${usage(f)}\`\n` : ''}${f.options.map((o) => `\`${o.name}\`${o.required ? '' : ' (optional)'}: ${o.description}`).join('\n')}`);
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
    const a = ctx.s.admin, list = a.online(), r = ctx.s.rooms.stats();
    const rows = list.slice(0, 40).map((p) => {
      const u = a.info(p.id);
      if (!u) return null;
      const doing = p.climbing && Date.now() - p.climbing < 60000 ? `climbing ${esc(mapName(ctx, p.map))}, ${p.h} m` : 'in the menus';
      return `${line(u)} ${doing}`;
    }).filter(Boolean);
    return ctx.reply(`${list.length} around in the last few minutes, ${r.players} in ${r.rooms} rooms.\n${clip(rows, 'Nobody right now.')}`);
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
    const item = opt(d, 'item'), said = opt(d, 'reason'), why = said || 'no reason given';
    if (!Object.hasOwn(ctx.s.wallet.catalogItems(), item)) return ctx.reply('That item is not in the catalog. Try /catalog.', { color: 'warn' });
    if (!ctx.s.wallet.giveItem(u.id, item, `${ctx.whoShort}: ${why}`)) return ctx.reply(`${line(u)} already has that.`, { color: 'warn' });
    tell(ctx, u, `You got a new item: ${item}.`, said);
    return done(ctx, 'giveitem', `${item} to ${playerLine(u)}: ${why}`, `Gave ${esc(item)} to ${line(u)}.${withWhy(said)}`);
  },
  takeitem(ctx, d) {
    const u = target(ctx, d);
    if (!u) return undefined;
    const item = opt(d, 'item'), said = opt(d, 'reason'), why = said || 'no reason given';
    if (!ctx.s.wallet.takeItem(u.id, item, `${ctx.whoShort}: ${why}`)) return ctx.reply(`${line(u)} does not have that.`, { color: 'warn' });
    tell(ctx, u, `An item was taken from you: ${item}.`, said);
    return done(ctx, 'takeitem', `${item} from ${playerLine(u)}: ${why}`, `Took ${esc(item)} from ${line(u)}.${withWhy(said)}`);
  },
  catalog(ctx, d) {
    const q = String(opt(d, 'search') || '').toLowerCase(), all = Object.entries(ctx.s.wallet.catalogItems()).filter(([k]) => k.toLowerCase().includes(q));
    return ctx.reply(`${all.length} items\n${all.slice(0, 80).map(([k, v]) => `\`${esc(k)}\` ${n0(v)}`).join(', ')}${all.length > 80 ? '\nAnd more: search for part of a name.' : ''}`);
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
    return ctx.reply(`Server ${esc(s.version)}, up ${fmtH(process.uptime() * 1000)}\nMemory: ${Math.round(m.rss / 1048576)} MB\nAnticheat: **${a.mode}**, ${n0(v.chunks)} chunks checked since starting (${v.chunks ? Math.round(v.ms / v.chunks) : 0} ms each), ${v.flags} flags, ${s.verifier.queueLength()} waiting\nBot: ${b.commands} commands, ${b.admins} admins, ${b.queue} messages waiting, ! commands ${b.bang ? 'on' : 'off'}, join and leave messages ${b.members ? 'on' : 'off'}${b.error ? `\nLast trouble: ${esc(b.error)}` : ''}\nMaintenance: ${a.maintenance ? esc(a.maintenance) : 'off'}\nAnnouncement: ${a.liveAnnouncement() ? esc(a.liveAnnouncement().text) : 'none'}`);
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
    const role = opt(d, 'role') === 'none' ? '' : opt(d, 'role'), was = u.role || '';
    if (role === was) return ctx.reply(`${line(u)} already has ${role ? `the ${ROLE_NAME[role]} flag` : 'no flag'}.`, { color: 'warn' });
    ctx.s.admin.setRole(u.id, role);
    tell(ctx, u, role ? `You now have the ${ROLE_NAME[role]} flag in the game.` : 'Your flag in the game was taken away.');
    return done(ctx, 'setrole', `${playerLine(u)}: ${ROLE_NAME[was] || 'none'} to ${ROLE_NAME[role] || 'none'}`, role ? `${line(u)} now has the **${ROLE_NAME[role]}** flag. It reaches their game within about 30 seconds.` : `${line(u)} has no flag now.`);
  },
  roles(ctx) {
    const rows = ctx.s.admin.withRoles().map((u) => `**${ROLE_NAME[u.role] || esc(u.role)}** ${line(u)}`);
    return ctx.reply(`Flags in the game\n${clip(rows, 'Nobody has one yet. Use /setrole.')}`);
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
  if (!f) return { unknown: m[1] };
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
    return Object.keys(s.wallet.catalogItems()).filter((k) => k.toLowerCase().includes(q)).slice(0, 25).map((k) => ({ name: k.slice(0, 100), value: k }));
  }
  if (focus.name === 'command') {
    const q = text.toLowerCase();
    return COMMANDS.filter((c) => c.name.includes(q)).slice(0, 25).map((c) => ({ name: c.name, value: c.name }));
  }
  return [];
}

module.exports = { COMMANDS, RUN, runCommand, runButton, runModal, suggest, playerLine, guardText, parseBang, usage };
