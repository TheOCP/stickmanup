'use strict';
// What the bot does for the Discord server itself: says who joined and who left, and runs the support tickets.
//
// Tickets are for everyone on the Discord server, so unlike the rest of the bot they don't need anyone on the admin list.
// A ticket number is never used twice, one person can have one open ticket, and the database itself makes sure of both.
// Tickets and what was said in them are kept for good: nothing in here or in the server's cleanups deletes them.

const VIEW = 1n << 10n, SEND = 1n << 11n, EMBED = 1n << 14n, ATTACH = 1n << 15n, HISTORY = 1n << 16n;
const MEMBER_ALLOW = String(VIEW | SEND | EMBED | ATTACH | HISTORY);
const MOST_PAGES = 100;
const COOLDOWN = 60000;
const STUCK = 120000;
const DEFAULT_WELCOME = 'Welcome to OC Studios, {user}!';
const DEFAULT_PANEL = 'Need help? Press the button to open a ticket. Only you and the team can see it, and what is said in it is saved. You can have one ticket at a time.';

const nameOf = (u) => String((u && (u.global_name || u.username)) || 'someone');
const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
function avatarOf(u) {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`;
  return `https://cdn.discordapp.com/embed/avatars/${/^\d+$/.test(String(u.id)) ? (BigInt(u.id) >> 22n) % 6n : 0n}.png`;
}
// A Discord ID holds the moment it was made.
const madeAt = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);

class Community {
  constructor(bot, db, tools) {
    this.bot = bot;
    this.db = db;
    this.esc = tools.esc;
    this.COLOR = tools.COLOR;
    const d = db.db;
    d.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        num INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL, user_name TEXT NOT NULL, channel_id TEXT, topic TEXT NOT NULL,
        opened_at INTEGER NOT NULL, closed_at INTEGER, closed_by TEXT, close_reason TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_open ON tickets(user_id) WHERE closed_at IS NULL;
      CREATE INDEX IF NOT EXISTS tickets_user ON tickets(user_id, num);
      CREATE INDEX IF NOT EXISTS tickets_channel ON tickets(channel_id);
      CREATE TABLE IF NOT EXISTS ticket_messages (
        id TEXT PRIMARY KEY, num INTEGER NOT NULL, at INTEGER NOT NULL,
        author_id TEXT NOT NULL, author TEXT NOT NULL, content TEXT NOT NULL, files TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ticket_messages_num ON ticket_messages(num, at);
    `);
    const q = (s) => d.prepare(s);
    this.q = {
      add: q('INSERT INTO tickets (user_id, user_name, topic, opened_at) VALUES (?, ?, ?, ?)'),
      drop: q('DELETE FROM tickets WHERE num = ?'),
      setChannel: q('UPDATE tickets SET channel_id = ? WHERE num = ?'),
      openOf: q('SELECT * FROM tickets WHERE user_id = ? AND closed_at IS NULL'),
      lastOf: q('SELECT * FROM tickets WHERE user_id = ? ORDER BY num DESC LIMIT 1'),
      byNum: q('SELECT * FROM tickets WHERE num = ?'),
      openByChannel: q('SELECT * FROM tickets WHERE channel_id = ? AND closed_at IS NULL'),
      markClosed: q('UPDATE tickets SET closed_at = ?, closed_by = ?, close_reason = ? WHERE num = ? AND closed_at IS NULL'),
      saveMsg: q('INSERT INTO ticket_messages (id, num, at, author_id, author, content, files) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, files = excluded.files'),
      msgsOf: q('SELECT * FROM ticket_messages WHERE num = ? ORDER BY at, id'),
      countMsgs: q('SELECT COUNT(*) AS n FROM ticket_messages WHERE num = ?'),
      listOpen: q('SELECT * FROM tickets WHERE closed_at IS NULL ORDER BY num DESC LIMIT ?'),
      listClosed: q('SELECT * FROM tickets WHERE closed_at IS NOT NULL ORDER BY num DESC LIMIT ?'),
      listAll: q('SELECT * FROM tickets ORDER BY num DESC LIMIT ?'),
      listUser: q('SELECT * FROM tickets WHERE user_id = ? ORDER BY num DESC LIMIT ?'),
    };
  }

  config(key) {
    try { return JSON.parse(this.db.setting(key) || '{}') || {}; } catch (e) { return {}; }
  }
  setConfig(key, o) { this.db.setSetting(key, JSON.stringify(o)); }

  // ---------------------------------------------------------------- who joined and who left
  onJoin(m) {
    const u = m && m.user, c = this.config('welcome');
    if (!u || u.bot || !c.channel) return;
    const text = String(c.text || DEFAULT_WELCOME).split('{user}').join(`<@${u.id}>`).split('{name}').join(this.esc(nameOf(u)));
    this.bot.post(c.channel, {
      content: text.slice(0, 1900),
      // Only the person who joined gets pinged, whatever the message says.
      allowed_mentions: { parse: [], users: [String(u.id)] },
      embeds: [{ color: this.COLOR.good, description: `**${this.esc(nameOf(u))}** joined.\nAccount made <t:${Math.floor(madeAt(u.id) / 1000)}:R>`, thumbnail: { url: avatarOf(u) } }],
    });
  }
  onLeave(m) {
    const u = m && m.user, c = this.config('welcome'), channel = c.leave || c.channel;
    if (!u || u.bot || !channel) return;
    this.bot.post(channel, { embeds: [{ color: this.COLOR.warn, description: `**${this.esc(nameOf(u))}** left the server.`, thumbnail: { url: avatarOf(u) } }] });
  }

  // ---------------------------------------------------------------- the button everyone presses
  async postPanel(channel, text) {
    const r = await this.bot.rest('POST', `/channels/${channel}/messages`, {
      allowed_mentions: { parse: [] },
      embeds: [{ title: 'Support', description: String(text || DEFAULT_PANEL).slice(0, 2000), color: this.COLOR.info }],
      components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Open a ticket', custom_id: 'tk:open' }] }],
    });
    return !!(r && r.ok);
  }

  async onInteraction(i, who) {
    const id = String(i.data && i.data.custom_id);
    if (id === 'tk:open') return this.pressOpen(i, who);
    if (id === 'tk:new') return this.submitNew(i, who);
    if (id === 'tk:close') return this.pressClose(i, who);
    const m = /^tk:closeyes:(\d+)$/.exec(id);
    if (m) return this.confirmClose(i, who, +m[1]);
    return this.bot.say(i, 'That button is too old.', { color: 'warn' });
  }

  // Their open ticket, if it is really still there. A channel someone deleted by hand must not lock them out for good.
  async stillOpen(userId) {
    const t = this.q.openOf.get(String(userId));
    if (!t) return null;
    if (t.channel_id) {
      const r = await this.bot.rest('GET', `/channels/${t.channel_id}`);
      if (!r || r.status !== 404) return t;
      this.q.markClosed.run(Date.now(), 'nobody', 'Its channel was deleted', t.num);
      return null;
    }
    if (Date.now() - t.opened_at < STUCK) return t;
    this.q.markClosed.run(Date.now(), 'nobody', 'Its channel was never made', t.num);
    return null;
  }
  alreadyText(t) {
    return `You already have a ticket${t.channel_id ? `: <#${t.channel_id}>` : ''} (ticket ${t.num}). You can have one at a time.`;
  }

  async pressOpen(i, who) {
    const open = await this.stillOpen(who.id);
    if (open) return this.bot.say(i, this.alreadyText(open), { color: 'warn' });
    const last = this.q.lastOf.get(String(who.id));
    if (last && Date.now() - last.opened_at < COOLDOWN) return this.bot.say(i, 'You only just opened a ticket. Try again in a minute.', { color: 'warn' });
    return this.bot.answer(i, 9, {
      custom_id: 'tk:new',
      title: 'Open a ticket',
      components: [{ type: 1, components: [{ type: 4, custom_id: 'topic', style: 2, label: 'How can we help?', min_length: 3, max_length: 1000, required: true }] }],
    });
  }

  async submitNew(i, who) {
    const b = this.bot;
    await b.answer(i, 5, { flags: 64 });
    const finish = (text, color = 'info') => b.rest('PATCH', `/webhooks/${b.appId}/${i.token}/messages/@original`, { allowed_mentions: { parse: [] }, embeds: [{ description: text, color: this.COLOR[color] }] });
    const open = await this.stillOpen(who.id);
    if (open) return finish(this.alreadyText(open), 'warn');
    const topic = String(((i.data.components || [])[0]?.components || [])[0]?.value || '').trim().slice(0, 1000) || 'No topic given';
    let num;
    try {
      num = Number(this.q.add.run(String(who.id), nameOf(who).slice(0, 100), topic, Date.now()).lastInsertRowid);
    } catch (e) {
      // Two forms sent at the same moment: the database lets only one of them through.
      return finish('You already have a ticket. You can have one at a time.', 'warn');
    }
    const channel = await this.makeChannel(num, who.id);
    if (!channel) {
      this.q.drop.run(num);
      console.error(`bot: could not make a channel for ticket ${num}: ${b.lastError}`);
      b.log('Ticket trouble', `Could not make a ticket channel for ${this.esc(nameOf(who))}. The bot needs Manage Channels, and must be able to see the ticket category.`, this.COLOR.bad);
      return finish('Could not open a ticket right now. The team has been told.', 'bad');
    }
    this.q.setChannel.run(channel, num);
    const c = this.config('tickets');
    b.post(channel, {
      content: `<@${who.id}>${c.staff ? ` <@&${c.staff}>` : ''}`,
      allowed_mentions: { parse: [], users: [String(who.id)], roles: c.staff ? [String(c.staff)] : [] },
      embeds: [{ title: `Ticket ${num}`, description: `${this.esc(topic)}\n\nSomeone will answer here. What is said in this ticket is saved.`, color: this.COLOR.info }],
      components: [{ type: 1, components: [{ type: 2, style: 4, label: 'Close ticket', custom_id: 'tk:close' }] }],
    });
    b.post(c.log || b.logChannel, { embeds: [{ title: `Ticket ${num} opened`, description: `By **${this.esc(nameOf(who))}** in <#${channel}>\n${this.esc(topic.slice(0, 500))}`, color: this.COLOR.info }] });
    return finish(`Your ticket is ready: <#${channel}>`, 'good');
  }

  async makeChannel(num, userId) {
    const b = this.bot, c = this.config('tickets');
    const overwrites = [
      { id: String(b.guild), type: 0, deny: String(VIEW) },
      { id: String(b.botId), type: 1, allow: MEMBER_ALLOW },
      { id: String(userId), type: 1, allow: MEMBER_ALLOW },
    ];
    if (c.staff) overwrites.push({ id: String(c.staff), type: 0, allow: MEMBER_ALLOW });
    const admins = [...b.admins].filter((id) => id !== String(userId) && id !== String(b.botId)).map((id) => ({ id, type: 1, allow: MEMBER_ALLOW }));
    const body = (extra) => {
      const o = { name: `ticket-${num}`, type: 0, topic: `Support ticket ${num}`, permission_overwrites: [...overwrites, ...extra] };
      if (c.category) o.parent_id = String(c.category);
      return o;
    };
    let r = await b.rest('POST', `/guilds/${b.guild}/channels`, body(admins));
    // Someone on the admin list may not be on this Discord server, and then Discord refuses all of it.
    if (r && !r.ok && admins.length) r = await b.rest('POST', `/guilds/${b.guild}/channels`, body([]));
    if (!r || !r.ok) {
      b.lastError = `Discord answered ${r ? r.status : 'nothing'} when making a ticket channel.`;
      return null;
    }
    return String((await r.json()).id);
  }

  // ---------------------------------------------------------------- closing
  mayClose(i, who, t) {
    if (String(who.id) === t.user_id || this.bot.admins.has(String(who.id))) return true;
    const staff = this.config('tickets').staff;
    return !!(staff && i.member && Array.isArray(i.member.roles) && i.member.roles.includes(String(staff)));
  }
  pressClose(i, who) {
    const t = this.q.openByChannel.get(String(i.channel_id));
    if (!t) return this.bot.say(i, 'This ticket is already closed.', { color: 'warn' });
    if (!this.mayClose(i, who, t)) return this.bot.say(i, 'You can not close this ticket.', { color: 'bad' });
    return this.bot.say(i, `Close ticket ${t.num}?`, { components: [{ type: 1, components: [{ type: 2, style: 4, label: 'Yes, close it', custom_id: `tk:closeyes:${t.num}` }] }] });
  }
  async confirmClose(i, who, num) {
    const t = this.q.byNum.get(num);
    if (!t || t.closed_at) return this.bot.say(i, 'This ticket is already closed.', { color: 'warn' });
    if (!this.mayClose(i, who, t)) return this.bot.say(i, 'You can not close this ticket.', { color: 'bad' });
    await this.bot.answer(i, 7, { components: [], embeds: [{ description: 'Closing...', color: this.COLOR.info }] });
    return this.close(t, nameOf(who), '');
  }
  // Only the first of several closes at the same moment gets past the update.
  async close(t, by, reason) {
    const b = this.bot, channel = t.channel_id;
    if (!this.q.markClosed.run(Date.now(), String(by).slice(0, 100), String(reason || '').slice(0, 300), t.num).changes) return false;
    if (channel) await this.saveAll(t.num, channel);
    const done = await this.postTranscript(t.num);
    if (!done) b.log('Ticket trouble', `Ticket ${t.num} is saved, but could not be posted as a file. The bot needs Attach Files in that channel. Try /transcript ${t.num} later.`, this.COLOR.warn);
    if (channel) {
      b.post(channel, { embeds: [{ description: 'This ticket is closed and saved. This channel goes away in a few seconds.', color: this.COLOR.info }] });
      const later = setTimeout(async () => {
        const r = await b.rest('DELETE', `/channels/${channel}`);
        if (!r || (!r.ok && r.status !== 404)) b.log('Ticket trouble', `Could not delete <#${channel}> for ticket ${t.num}. Please delete it by hand.`, this.COLOR.warn);
      }, 6000);
      if (later.unref) later.unref();
    }
    return true;
  }

  // ---------------------------------------------------------------- remembering what was said
  store(num, m) {
    const a = m.author || {};
    const files = (Array.isArray(m.attachments) ? m.attachments : []).map((f) => ({ name: String(f.filename || 'file').slice(0, 200), url: String(f.url || '').slice(0, 1000) }));
    this.q.saveMsg.run(String(m.id), num, Date.parse(m.timestamp) || Date.now(), String(a.id || ''), nameOf(a).slice(0, 100), String(m.content || '').slice(0, 4000), JSON.stringify(files));
  }
  // Every message as it is written, so a channel someone deletes by hand loses nothing.
  capture(m) {
    if (!m || !m.channel_id || !m.id) return;
    const t = this.q.openByChannel.get(String(m.channel_id));
    if (t) this.store(t.num, m);
  }
  // And the whole channel when closing, for anything written while the bot was away, and for edits.
  async saveAll(num, channel) {
    let before = '';
    for (let page = 0; page < MOST_PAGES; page++) {
      const r = await this.bot.rest('GET', `/channels/${channel}/messages?limit=100${before ? `&before=${before}` : ''}`);
      if (!r || !r.ok) return;
      const list = await r.json();
      if (!Array.isArray(list) || !list.length) return;
      for (const m of list) this.store(num, m);
      before = list[list.length - 1].id;
      if (list.length < 100) return;
    }
  }
  transcript(t) {
    const out = [`Ticket ${t.num}`, `Opened by ${t.user_name} (${t.user_id}), ${stamp(t.opened_at)} UTC`, `Topic: ${t.topic}`];
    if (t.closed_at) out.push(`Closed by ${t.closed_by}, ${stamp(t.closed_at)} UTC${t.close_reason ? `. Reason: ${t.close_reason}` : ''}`);
    else out.push('Still open');
    out.push('');
    for (const m of this.q.msgsOf.all(t.num)) {
      let files = [];
      try { files = JSON.parse(m.files); } catch (e) {}
      out.push(`[${stamp(m.at)}] ${m.author}: ${m.content}${files.map((f) => ` [file: ${f.name} ${f.url}]`).join('')}`);
    }
    return out.join('\n') + '\n';
  }
  // Discord can only show one file at a time here, so the file goes to the private channel and not to whoever asked.
  postTranscript(num) {
    const t = this.q.byNum.get(num);
    if (!t) return Promise.resolve(false);
    const c = this.config('tickets'), n = this.q.countMsgs.get(num).n;
    return this.bot.upload(c.log || this.bot.logChannel, {
      embeds: [{ title: `Ticket ${num}${t.closed_at ? ' closed' : ''}`, description: `Opened by **${this.esc(t.user_name)}** (<@${t.user_id}>)\n${t.closed_at ? `Closed by ${this.esc(t.closed_by)}${t.close_reason ? `: ${this.esc(t.close_reason)}` : ''}\n` : ''}${n} messages`, color: this.COLOR.info }],
    }, `ticket-${num}.txt`, this.transcript(t));
  }

  // ---------------------------------------------------------------- for the commands
  ticket(num) { return this.q.byNum.get(num); }
  ticketIn(channel) { return this.q.openByChannel.get(String(channel)); }
  list(o) {
    const n = o.count || 20;
    if (o.user) return this.q.listUser.all(String(o.user), n);
    if (o.status === 'closed') return this.q.listClosed.all(n);
    if (o.status === 'all') return this.q.listAll.all(n);
    return this.q.listOpen.all(n);
  }
}

module.exports = { Community, DEFAULT_WELCOME, DEFAULT_PANEL };
