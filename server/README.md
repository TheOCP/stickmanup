# StickManUp server

One program that does three jobs for the game:

* **Game server**: rooms, the server browser, passwords, and passing game messages between phones
* **Accounts**: sign in with Discord, Steam or Google, plus accepting the terms
* **Database**: everyone's coins, items, records and saved climb, in one SQLite file

It needs almost nothing: any Linux server with systemd, about 100 MB of memory, and Node 22, which the installer brings
along in its own folder. It does not touch anything else on the server and uses its own port.

## Install

Log in to your server and run this one line:

```
curl -fsSL https://raw.githubusercontent.com/TheOCP/stickmanup/main/server/install.sh | sudo bash
```

It installs what is missing, picks a free port (47810 or the next free one up to 47899), gets a free HTTPS certificate,
creates its own user, opens the firewall on the server, asks for your sign in keys, starts the server and keeps it
running after reboots. At the end it prints your **server address**, for example
`https://203-0-113-7.sslip.io:47810`. That address goes into the game.

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
* `--uninstall`: remove the server, but keep the players' data. Add `--purge` to delete that too

Logs: `journalctl -u stickmanup -f`

Where things are:

* `/opt/stickmanup`: the program and its own Node
* `/etc/stickmanup/server.env`: settings and secret keys, readable only by the server
* `/etc/stickmanup/terms.txt`: your terms, if you write your own
* `/var/lib/stickmanup/stickmanup.db`: the database
* `/var/lib/stickmanup/backups`: a copy of the database from each day, the last 7 days. These are on the same server,
  so also copy them somewhere else now and then

## The terms

`terms.txt` here is a simple draft, not legal advice. To use your own, put them in `/etc/stickmanup/terms.txt` and run
`sudo systemctl restart stickmanup`. Any change to the text makes everyone accept again the next time they play signed
in. Someone who says no is signed out, and keeps what is on their phone.

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
* **Coins and saves come from the phone.** The server stores them but can't know if they were earned fairly, so
  someone determined can cheat their own account. It doesn't affect anyone else's.
* **No word filter** on room names and player names. Names are shown as plain text and nothing more.
* **Limits**: 4 climbers in a room, 4 rooms per IP address, 1000 rooms and 5000 connections on the server, and 512 KB
  for one save. Password guesses, new rooms, joins and saves are all rate limited.

## For developers

Settings, in `server.env` or the environment: `PORT`, `HOST`, `PUBLIC_URL`, `DATA_DIR`, `TERMS_FILE`, `TLS_CERT`,
`TLS_KEY`, `TRUST_PROXY`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`STEAM_LOGIN`, `STEAM_API_KEY`. The server refuses plain HTTP on a public address. `SIGHUP` reloads the certificate.

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
