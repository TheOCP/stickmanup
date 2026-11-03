# StickManUp server

One program that does all of this for the game:

* **Game server**: rooms, the server browser, passwords, and passing game messages between phones
* **Accounts**: sign in with Discord, Steam or Google, plus accepting the terms
* **Friends**: requests, search by name or player ID, who is doing what, and watching a friend's climb live
* **Coins**: everyone's balance and what they own are held here and can't be changed from a phone (see below)
* **Anticheat**: every climb that earns coins is played again here, with the game's own physics (see below)
* **Discord bot**: logs sign ins and cheaters to your channels, and welcomes people, runs support tickets, and gives you over 60 commands (see below)
* **Database**: everyone's coins, items, records and saved climb, in one SQLite file

It needs almost nothing: any Linux server with systemd, about 300 MB of memory, and Node 22, which the installer brings
along in its own folder. It does not touch anything else on the server and uses its own port.

## Install

Log in to your server and run this one line:

```
curl -fsSL https://raw.githubusercontent.com/TheOCP/stickmanup/main/server/install.sh | sudo bash
```

It installs what is missing, picks a free port (47810 or the next free one up to 47899), gets a free HTTPS certificate,
creates its own user, opens the firewall on the server, asks for your sign in keys, starts the server and keeps it
running after reboots. At the end it prints your **server address**, for example
`https://203-0-113-7.sslip.io:47810`.

The game has one address built in: `SERVER` in `assets/js/cloud.js`, and players can't change it. To use another server,
change it there and build the game again. To get a set address, run the installer with `--domain NAME --port N`.

It asks for:

* A domain name. Press Enter if you have none and it uses a free name made from your server's IP address. That is
  enough for Discord and Steam, but not for Google.
* An email address for certificate warnings. Optional.
* Your Discord, Google and Steam keys. Press Enter to skip any of them and add them later.

### Ports

Open these in your hosting company's firewall, if it has one (Hetzner and Vultr have one in their control panel). The
installer can only open the firewall on the server itself.

* **The game port** it picked, TCP. Always.
* **Port 80**, TCP, for the certificate. Only used for a moment, at install and at each renewal. If nginx or Apache
  already uses port 80, the installer works through it.

## Sign in keys

Guests can always play, so none of this is needed to get started. Add or change keys at any time:

```
curl -fsSL https://raw.githubusercontent.com/TheOCP/stickmanup/main/server/install.sh | sudo bash -s -- --logins
```

Below, `ADDRESS` is your server address, for example `https://203-0-113-7.sslip.io:47810`.

**Discord**: go to https://discord.com/developers/applications, then New Application, then OAuth2. Copy the Client ID
and Client Secret. Under Redirects add exactly `ADDRESS/auth/discord/callback`.

**Steam**: needs nothing. It just works, without a store page. Without a key players show up as "Steam player 1234".
For their real Steam name, get a free Web API key at https://steamcommunity.com/dev/apikey.

**Google**: needs a real domain name, because Google refuses raw IP addresses and may refuse free names like sslip.io.
A free name from https://www.duckdns.org works. Go to https://console.cloud.google.com/apis/credentials, create a
project, set up the consent screen, then Create credentials, OAuth client ID, Web application. Under Authorized redirect
URIs add exactly `ADDRESS/auth/google/callback`. While your consent screen is in testing, only test users you add can
sign in, so publish it when you are ready.

Each of these is a separate account: signing in with Discord and later with Steam gives two accounts, not one.

## Looking after it

Add the option after `sudo bash -s --`, like in the line above:

* `--status`: is it running, and does its address answer
* `--update`: get the newest server files and restart. Your settings and data stay
* `--logins`: change the sign in keys
* `--bot`: set up the Discord bot, or change who may use it
* `--uninstall`: remove the server, but keep the players' data. Add `--purge` to delete that too

Logs: `journalctl -u stickmanup -f`

Where things are:

* `/opt/stickmanup`: the program and its own Node
* `/etc/stickmanup/server.env`: settings and secret keys, readable only by the server
* `/etc/stickmanup/terms.txt`: your terms, if you write your own
* `/var/lib/stickmanup/stickmanup.db`: the database
* `/var/lib/stickmanup/backups`: a copy of the database from each day, the last 7 days. These are on the same server,
  so also copy them somewhere else now and then

## Coins

Everyone's coins and what they own live only in the database, for guests too. The app shows a copy. Buying asks the
server, so it needs a connection. A save sent by a phone is stripped of any coins or items in it.

A guest is an account like any other, with a number, that only their phone has the key to. Signing in moves what the guest
has to the real account, if that account has nothing yet. Coins are only earned alone or in a room on this server, never
offline or in Online games, because nothing can check those.

The limits, on top of the anticheat:

* Each coin counts once per climb, and only if the map really has it, at the value of the difficulty
* The first win bonus once per difficulty per account, never with custom rules
* Relics only on real Hardcore or Insane, and only ones on that map
* At most 20000 coins a day, not counting first win bonuses

Everything that changes a balance is written to a log table called `ledger`, kept for 180 days. You can change the limit in
`/etc/stickmanup/server.env`, then restart the server: `WALLET_DAILY_CAP`, or with the bot's `/dailycap`.

Prices and coin counts come from `lib/catalog.json`. If the game's prices change, update the server too with `--update`.

## The anticheat

The phone runs the climb, and writes down every press of a button as it goes. A piece of that comes here every 20 seconds,
and the server plays it again with the very same physics code, which it keeps a copy of in `lib/sim`. Every second, the
phone also says exactly where it is. If that isn't where the server's copy of the climb is, something was changed. A jump
that goes too high, running too fast, flying, teleporting, an edited save, coins it never reached: all of them show up
as a difference, and the warning says which and by how much.

The rerun takes about a thousandth of the time the climb took. One worker can keep up with several hundred people climbing.
With a lot of people, set `ANTICHEAT_WORKERS` higher, one per spare processor.

Also checked:

* **The clock**: playing faster than real time (game speed hacks) shows up in how long the server has known about the climb
* **Rooms**: what a partner does is part of your climb, so in enforce mode coins in a room need every other person there to
  be signed in, climbing and clean. Moving impossibly fast in a room and wearing what you don't own are caught by the relay
* **The phone itself**: whether the app is the official one, whether its game files were changed, Frida, debuggers, Xposed
  and cheat tools. Android's key attestation asks the phone's secure hardware to vouch for the app, on a certificate back to
  Google. Being rooted is only noted, never held against anyone
* **Old versions**: a phone on another version can't be compared, so it is told to update

It has two modes, switched with the bot's `/anticheat`. It starts in **watch**: everything is checked and reported, coins are
paid by the old rules, nobody is banned. Play real climbs on real phones for a while first. Anything flagged that shouldn't
be is something to fix before switching. In **enforce**, only what the server's own rerun found gets paid, a climb that
fails stops earning, and a score of 100 within 30 days bans automatically (`ANTICHEAT_BAN_SCORE`). `/trust` exempts testers.

What it can't catch: someone who plays perfectly by machine. A program that presses the buttons a person could press plays a
real climb, and the physics can't tell. It can't earn more than the daily limit that way, and it still takes as long as
climbing does. In rooms it is weaker than alone: partners on a cord are the other phone's word, checked for being possible,
so two cheaters working together are harder to spot than one. The checks on the phone itself can be fooled by someone
determined, which is why none of the real checks depend on them.

## The Discord bot

It writes sign ins (with name, player number and IP address) to one channel, and cheater warnings to another or the same one,
with the reason and buttons to ban, look at the player or clear the warning. It also gives you the commands below. Without
a token it stays off, and everything else works the same.

Setting it up:

1. Go to https://discord.com/developers/applications, press New Application, then Bot, then Reset Token, and copy the token.
   On the same page turn on Message Content Intent (for the `!` commands and saving tickets) and Server Members Intent (for join
   and leave messages). What needs a switch that is off stays off, and the bot says so in the log channel. Everything else works.
2. In Discord: User Settings, Advanced, turn on Developer Mode. Now a right click gives you Copy ID on servers, channels and people.
3. Make a **private** channel for the logs, because they contain players' IP addresses.
4. Run the installer with `--bot`. It asks for the token, the server, the channels, and the Discord user IDs of the people
   who may use the commands, with commas between them. It gives you the link to invite the bot if it isn't there yet.

Everyone not on that list is refused, whatever their role on your Discord server, and the attempt is logged. Change the list by
running `--bot` again. Answers are only visible to the person asking, and everything that changes something is written down
in `/audit` and the log channel.

A player can be given by name, by number (`#12`) or by ID, and Discord suggests them as you type.

`/ban` and `/tempban` ban the account, its phone and its address, stored on the server, so a new account on the same phone or
network is refused too. Say `ip:false` or `phone:false` to leave one out, because everyone on a banned address is locked out.
`/unban` lifts all of it. A banned player is thrown out of what they are doing within half a minute, and every game mode is
grayed out with the reason on the screen. A given or taken coin or item is told to the player in the game, with the reason.

Every command also works with a `!` in the log and warning channels, like `!ban #12 flying around` or `!givecoins Ana 100 a gift`.
A name with spaces goes in quotes, and optional parts go by name: `!ban "Cool Guy" flying around days=3`. `!help ban` shows how
to use one. They work only in those channels because everyone there can read the answers, which can show IP addresses, so keep
those channels private. The bot gets every message in the channels it can see, but it only looks at the ones starting with `!`,
and it stores none of them.

* **Players**: `/help` `/player` `/players` `/search` `/recent` `/lastplayed` `/new` `/online` `/top` `/stats` `/alts` `/ip` `/ips` `/rename` `/note` `/notes` `/signout` `/deleteplayer`
* **Coins and items**: `/coins` `/givecoins` `/takecoins` `/setcoins` `/giveall` `/resetwallet` `/history` `/items` `/giveitem` `/takeitem` `/catalog` `/dailycap` `/giveitem` gives anything in the game by name or ID, even what can't be bought, like legendary suits. Only The Hacker and GG Girl are left out: those go with a flag from `/setrole`.
* **Bans, always with a reason**: `/ban` `/unban` `/tempban` `/banip` `/unbanip` `/banphone` `/unbanphone` `/bans` `/baninfo` `/kick`
* **Anticheat**: `/flags` `/suspects` `/clearflags` `/trust` `/untrust` `/anticheat` `/phone` `/climbs` `/climb`
* **The server**: `/rooms` `/closeroom` `/status` `/announce` `/maintenance` `/logguests` `/backup` `/audit` `/admins`

### Flags in the game

`/setrole player:Name role:owner` gives a player a flag next to their name: `owner`, `admin` or `mod`. `role:none` takes it
away, and `/roles` lists everyone who has one. They are kept on this server and it writes them into every room itself, so a
changed app or a chosen name gets nobody a flag. Owners can wear The Hacker and GG Girl, admins GG Girl.

A flag only shows in rooms on this server. Online games don't go through it, so nobody can check
them, and nobody has a flag or a team suit there. A flag gives no power: who may use the bot is still the list of Discord IDs.

### Join and leave messages

`/welcome channel:#join-leave` says who joined and who left in that channel. Add `leavechannel` to split them, and
`message` to change the welcome, where `{user}` pings them and `{name}` is their name. `test:true` shows both messages using you.

### Tickets

1. `/ticketsetup` with a `category` for the channels, a `staffrole` that answers them, and a private `logchannel` for finished tickets.
2. `/ticketpanel channel:#support` puts the button there. Anyone on your Discord server can press it.

Each ticket gets the next number, which is never used again, and its own private channel called `ticket-12`. One person can
have one open ticket, and has to wait a minute after opening one before opening the next. Closing it posts the whole
conversation as a file in the private channel and removes the ticket channel.

Tickets and what was said in them stay in the server's database for good, and the people using them are told so. `/tickets`
lists them, `/tickets user:@someone` shows all of one person's, and `/transcript number:12` posts one again. Attached
files are kept as a name and a link, and Discord's links stop working after a while.

The bot needs Manage Channels, Attach Files and Read Message History for this. Invite it with this link, using your Application
ID: `https://discord.com/oauth2/authorize?client_id=YOUR_ID&scope=bot+applications.commands&permissions=117776`

## The terms

`terms.txt` here is a simple draft, not legal advice. To use your own, put them in `/etc/stickmanup/terms.txt` and run
`sudo systemctl restart stickmanup`. Any change to the text makes everyone accept again. Someone who says no is signed out,
and plays without coins. The draft says plainly that IP addresses and phone checks are kept and shown to you on Discord. If you
write your own, keep that in, and check what the law asks of you where you and your players are.

## If you already run a web server

Use `--proxy` to skip the certificate. The server then listens only on `127.0.0.1`, and your web server does the HTTPS.
It has to pass WebSocket upgrades on and tell the server who is really connecting. For nginx:

```
location / {
    proxy_pass http://127.0.0.1:47810;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 120s;
}
```

`$connection_upgrade` needs this next to your `server` block:

```
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

## What it does not do

* **The host's phone still runs the climb.** The server passes messages along. If the host leaves, the room ends.
* **Messages go over TCP**, so a bad connection stutters a little more than a direct one. The Online, WiFi and Bluetooth
  ways of playing are all still in the game.
* **No word filter** on room names and player names. Names are shown as plain text and nothing more.
* **Limits**: 4 climbers in a room, 4 rooms per IP address, 1000 rooms and 5000 connections on the server, and 512 KB
  for one save. Password guesses, new rooms, joins and saves are all rate limited.

## For developers

Settings, in `server.env` or the environment: `PORT`, `HOST`, `PUBLIC_URL`, `DATA_DIR`, `TERMS_FILE`, `TLS_CERT`,
`TLS_KEY`, `TRUST_PROXY`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`STEAM_LOGIN`, `STEAM_API_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_BOT_GUILD`, `DISCORD_BOT_LOG_CHANNEL`, `DISCORD_BOT_WARN_CHANNEL`,
`DISCORD_BOT_ADMINS`, `ANTICHEAT_WORKERS`, `ANTICHEAT_BAN_SCORE`, `ANTICHEAT_SPEED_SLACK`, `GUEST_LIMIT_BURST`,
`GUEST_LIMIT_PER_HOUR`. The server refuses plain HTTP on a public address. `SIGHUP` reloads the certificate.

Everything is on one port. The socket is `/ws`, text only:

* `!{json}`: a message for or from the server
* `id|payload`: host and server, a message to or from player `id`
* `payload`: player and server, a message to or from the host

The host sends `!{"t":"host","proto":N,"name":"","host":"","pub":true,"pass":"","map":0,"diff":0}` and gets
`!{"t":"hosted","code":"","name":"","pub":true,"locked":false}`, then `peer+` and `peer-` as people come and go. It can
send `info` and `kick`. A player sends `!{"t":"join","code":"","pass":"","proto":N}` and gets `joined`, `err` or later
`closed`.

Web requests:

* `GET /api/health`, `GET /api/info`, `GET /api/rooms?proto=N`
* In the browser: `GET /auth/{discord,steam,google}/start?challenge=C&tos=V`
* `POST /auth/exchange` with `{code, verifier}` gives `{token, user}`
* With `Authorization: Bearer TOKEN`: `GET` and `DELETE /api/me`, `POST /api/logout`, `POST /api/tos`, `GET /api/save`,
  and `PUT /api/save` with `{rev, data}`, which answers 409 with the current save if another phone got there first

Signing in happens in the phone's browser, never in the game. The browser comes back through a `stickmanup://` link with
a one time code, which is useless without a secret only the game that started has (PKCE). Session tokens are stored only
as a hash, room passwords only as a scrypt hash.

Tests: `node dev/servertest.js` (real sockets, fake sign in sites), `dev/servergame.py` (the real game against the real
server, with hostile hosts and joiners).
