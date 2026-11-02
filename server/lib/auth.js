'use strict';
// Signing in with Discord, Google and Steam from a phone.
//
// The game can't sign in inside itself: Google refuses web views, and nobody should type a password into a game. So it
// opens the phone's browser here, the person signs in with the real site, and the browser comes back to the app with a
// one time code. The game then trades the code for a session, proving with a secret only it has (PKCE, RFC 7636) that it
// is the same game that started. Another app grabbing the link, or someone sending you a sign in link, gets nothing.
const crypto = require('node:crypto');
const { cleanText } = require('./rooms');

const STATE_TTL = 10 * 60000;
const CODE_TTL = 5 * 60000;
const MAX_PENDING = 20000;
const APP_RETURN = 'stickmanup://auth';

const URLS = {
  discordAuth: 'https://discord.com/oauth2/authorize',
  discordToken: 'https://discord.com/api/oauth2/token',
  discordUser: 'https://discord.com/api/users/@me',
  googleAuth: 'https://accounts.google.com/o/oauth2/v2/auth',
  googleToken: 'https://oauth2.googleapis.com/token',
  googleUser: 'https://openidconnect.googleapis.com/v1/userinfo',
  steamLogin: 'https://steamcommunity.com/openid/login',
  steamPlayers: 'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/',
};

const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256url = (s) => crypto.createHash('sha256').update(s).digest('base64url');
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;
const STEAM_ID = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

class Auth {
  constructor(cfg, db, termsVersion) {
    this.cfg = cfg;
    this.db = db;
    this.termsVersion = termsVersion;
    this.urls = Object.assign({}, URLS, cfg.devUrls || {});
    this.states = new Map();
    this.codes = new Map();
    this.sweep = setInterval(() => this.clean(), 60000);
    this.sweep.unref();
  }

  providers() {
    const out = [];
    if (this.cfg.discord.id && this.cfg.discord.secret) out.push('discord');
    if (this.cfg.steam.on) out.push('steam');
    if (this.cfg.google.id && this.cfg.google.secret) out.push('google');
    return out;
  }

  clean() {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.exp < now) this.states.delete(k);
    for (const [k, v] of this.codes) if (v.exp < now) this.codes.delete(k);
  }

  callback(provider) { return `${this.cfg.publicUrl}/auth/${provider}/callback`; }

  // Where to send the browser. Null with a reason if it can't start.
  start(provider, challenge, tos) {
    if (!this.providers().includes(provider)) return { err: 'That sign in is not set up on this server.' };
    if (!CHALLENGE.test(challenge || '')) return { err: 'Please start signing in from the game.' };
    if (tos !== this.termsVersion) return { err: 'The terms have changed. Please accept them in the game and try again.' };
    if (this.states.size >= MAX_PENDING) this.clean();
    if (this.states.size >= MAX_PENDING) return { err: 'Too many people are signing in right now. Try again in a minute.' };
    const state = token();
    this.states.set(state, { provider, challenge, exp: Date.now() + STATE_TTL });
    if (provider === 'discord') {
      const q = new URLSearchParams({ client_id: this.cfg.discord.id, redirect_uri: this.callback('discord'), response_type: 'code', scope: 'identify', state });
      return { url: `${this.urls.discordAuth}?${q}` };
    }
    if (provider === 'google') {
      const q = new URLSearchParams({ client_id: this.cfg.google.id, redirect_uri: this.callback('google'), response_type: 'code', scope: 'openid profile', state, prompt: 'select_account' });
      return { url: `${this.urls.googleAuth}?${q}` };
    }
    const q = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': `${this.callback('steam')}?state=${state}`,
      'openid.realm': this.cfg.publicUrl,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    return { url: `${this.urls.steamLogin}?${q}` };
  }

  // The browser came back from the provider. Returns { code, name } to send on to the app, or { err }.
  async finish(provider, query) {
    const state = String(query.get('state') || ''), pending = this.states.get(state);
    // A state works once, for the provider it was made for.
    if (!pending || pending.exp < Date.now() || pending.provider !== provider) return { err: 'That sign in has expired. Please start again from the game.' };
    this.states.delete(state);
    let who;
    try {
      who = provider === 'steam' ? await this.steamUser(query, state) : await this.oauthUser(provider, query);
    } catch (e) {
      console.error(`sign in with ${provider} failed: ${e.message}`);
      return { err: `${provider[0].toUpperCase() + provider.slice(1)} did not confirm the sign in. Please try again.` };
    }
    if (!who) return { err: 'Sign in was cancelled. You can go back to the game.' };
    const name = cleanText(who.name, 32) || 'Climber';
    const userId = this.db.signIn(provider, who.subject, name, this.termsVersion);
    if (this.codes.size >= MAX_PENDING) this.clean();
    const code = token();
    this.codes.set(code, { userId, challenge: pending.challenge, exp: Date.now() + CODE_TTL });
    return { code, name, link: `${APP_RETURN}?code=${encodeURIComponent(code)}` };
  }

  async oauthUser(provider, query) {
    if (query.get('error')) return null;
    const code = String(query.get('code') || '');
    if (!code || code.length > 2048) throw new Error('no code');
    const c = this.cfg[provider];
    const res = await fetch(this.urls[provider + 'Token'], {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, grant_type: 'authorization_code', code, redirect_uri: this.callback(provider) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`token answer ${res.status}`);
    const t = await res.json();
    if (typeof t.access_token !== 'string') throw new Error('no access token');
    const me = await fetch(this.urls[provider + 'User'], { headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!me.ok) throw new Error(`user answer ${me.status}`);
    const u = await me.json();
    if (provider === 'discord') {
      if (typeof u.id !== 'string' || !u.id) throw new Error('no id');
      return { subject: u.id, name: u.global_name || u.username };
    }
    if (typeof u.sub !== 'string' || !u.sub) throw new Error('no id');
    return { subject: u.sub, name: u.given_name || u.name };
  }

  // Steam: nothing in the browser's address can be believed until Steam itself has confirmed the whole answer.
  async steamUser(query, state) {
    if (query.get('openid.mode') === 'cancel') return null;
    if (query.get('openid.mode') !== 'id_res') throw new Error('bad mode');
    if (query.get('openid.return_to') !== `${this.callback('steam')}?state=${state}`) throw new Error('bad return address');
    if (query.get('openid.op_endpoint') !== this.urls.steamLogin) throw new Error('bad endpoint');
    const claimed = String(query.get('openid.claimed_id') || ''), m = STEAM_ID.exec(claimed);
    if (!m || query.get('openid.identity') !== claimed) throw new Error('bad id');
    // Everything that matters has to be covered by Steam's signature.
    const signed = String(query.get('openid.signed') || '').split(',');
    for (const f of ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce']) if (!signed.includes(f)) throw new Error('unsigned ' + f);
    const body = new URLSearchParams();
    for (const [k, v] of query) if (k.startsWith('openid.')) body.append(k, v);
    body.set('openid.mode', 'check_authentication');
    const res = await fetch(this.urls.steamLogin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`check answer ${res.status}`);
    const text = await res.text();
    if (!/^is_valid:true$/m.test(text)) throw new Error('not confirmed');
    const steamId = m[1];
    let name = `Steam player ${steamId.slice(-4)}`;
    // The API key is optional: it only gets the display name.
    if (this.cfg.steam.key) {
      try {
        const q = new URLSearchParams({ key: this.cfg.steam.key, steamids: steamId });
        const r = await fetch(`${this.urls.steamPlayers}?${q}`, { signal: AbortSignal.timeout(8000) });
        const p = r.ok ? (await r.json())?.response?.players?.[0] : null;
        if (p && p.personaname) name = p.personaname;
      } catch (e) {
        console.error('steam name lookup failed');
      }
    }
    return { subject: steamId, name };
  }

  // The game trades the one time code, with the secret from when it started, for a session.
  exchange(code, verifier) {
    if (typeof code !== 'string' || typeof verifier !== 'string' || !VERIFIER.test(verifier)) return null;
    const c = this.codes.get(code);
    if (!c) return null;
    // One go only, right or wrong.
    this.codes.delete(code);
    if (c.exp < Date.now() || !same(sha256url(verifier), c.challenge)) return null;
    return { userId: c.userId };
  }

  stop() { clearInterval(this.sweep); }
}

module.exports = { Auth };
