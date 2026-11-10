#!/usr/bin/env bash
# StickManUp server installer. Run it as root on a Linux server with systemd:
#
#   curl -fsSL https://raw.githubusercontent.com/TheOCP/stickmanup/main/server/install.sh | sudo bash
#
# It installs what is missing, picks a free port, gets a free HTTPS certificate, asks for your sign in keys and starts
# the server. It keeps to itself: its own copy of Node in /opt/stickmanup, its own user, its own port. Run it again at
# any time: it keeps your settings and your players' data.
#
#   --update            get the newest server files and restart, ask nothing
#   --logins            change the Discord, Google and Steam sign in keys
#   --bot               set up the Discord bot, or change who may use it
#   --status            show how the server is doing
#   --uninstall         remove the server (add --purge to delete players' data too)
#   --domain NAME       your domain name
#   --email ADDRESS     where Let's Encrypt may warn you about your certificate (optional)
#   --port N            use this port (1024 or higher)
#   --proxy             no certificate here: you already run an HTTPS proxy that will forward to this server
#   --yes               ask nothing, use the defaults
set -euo pipefail

REPO_TARBALL="${STICKMANUP_TARBALL:-https://codeload.github.com/TheOCP/stickmanup/tar.gz/refs/heads/main}"
NODE_BASE="https://nodejs.org/dist/latest-v22.x"
SERVICE=stickmanup
APP_USER=stickmanup
PREFIX="${STICKMANUP_PREFIX:-/opt/stickmanup}"
DATA_DIR="${STICKMANUP_DATA:-/var/lib/stickmanup}"
ETC_DIR="${STICKMANUP_ETC:-/etc/stickmanup}"
ENV_FILE="$ETC_DIR/server.env"
LE_DIR="${STICKMANUP_LE:-/etc/letsencrypt}"
UNIT_DIR="${STICKMANUP_UNITS:-/etc/systemd/system}"
HOOK="$LE_DIR/renewal-hooks/deploy/stickmanup.sh"
PORT_FIRST=47810
PORT_LAST=47899

MODE=install YES=0 PURGE=0 PROXY=0 NO_SERVICE=0 SKIP_PACKAGES=0
OPT_DOMAIN="" OPT_EMAIL="" OPT_PORT=""

say() { printf '\n\033[1;36m%s\033[0m\n' "$*" >&2; }
note() { printf '%s\n' "$*" >&2; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*" >&2; }
die() { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --update) MODE=update ;;
    --logins) MODE=logins ;;
    --bot) MODE=bot ;;
    --status) MODE=status ;;
    --uninstall) MODE=uninstall ;;
    --purge) PURGE=1 ;;
    --proxy) PROXY=1 ;;
    --yes|-y) YES=1 ;;
    --no-service) NO_SERVICE=1 ;;
    --skip-packages) SKIP_PACKAGES=1 ;;
    --domain) OPT_DOMAIN="${2:-}"; shift ;;
    --email) OPT_EMAIL="${2:-}"; shift ;;
    --port) OPT_PORT="${2:-}"; shift ;;
    -h|--help) sed -n '2,19p' "${BASH_SOURCE[0]:-/dev/null}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ---------------------------------------------------------------- asking
HAS_TTY=0
if ( : < /dev/tty ) 2>/dev/null; then HAS_TTY=1; fi

# The answer goes into the caller's variable by name. These local names must never match one of the caller's, or the
# answer lands in our own copy and is lost, which is why they look the way they do.
trim() { local t=$1; t=${t#"${t%%[![:space:]]*}"}; t=${t%"${t##*[![:space:]]}"}; printf '%s' "$t"; }
ask() { # ask VAR "question" "default"
  local __ask_var=$1 __ask_q=$2 __ask_def=${3:-} __ask_in=""
  if [ "$YES" = 1 ] || [ "$HAS_TTY" = 0 ]; then printf -v "$__ask_var" '%s' "$__ask_def"; return 0; fi
  if [ -n "$__ask_def" ]; then printf '%s [%s]: ' "$__ask_q" "$__ask_def" >&2; else printf '%s: ' "$__ask_q" >&2; fi
  IFS= read -r __ask_in < /dev/tty || __ask_in=""
  __ask_in=$(trim "$__ask_in")
  printf -v "$__ask_var" '%s' "${__ask_in:-$__ask_def}"
}
ask_secret() { # ask_secret VAR "question" "current value, kept on Enter"
  local __ask_var=$1 __ask_q=$2 __ask_def=${3:-} __ask_in=""
  if [ "$YES" = 1 ] || [ "$HAS_TTY" = 0 ]; then printf -v "$__ask_var" '%s' "$__ask_def"; return 0; fi
  if [ -n "$__ask_def" ]; then printf '%s [Enter keeps the current one]: ' "$__ask_q" >&2; else printf '%s (hidden while you type): ' "$__ask_q" >&2; fi
  IFS= read -rs __ask_in < /dev/tty || __ask_in=""
  printf '\n' >&2
  __ask_in=$(trim "$__ask_in")
  printf -v "$__ask_var" '%s' "${__ask_in:-$__ask_def}"
}
yes_no() { # yes_no "question" y|n
  local __yn=""
  ask __yn "$1 (y/n)" "$2"
  case "$__yn" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------- settings file
# Read without running it, written whole each time. Values are checked before they get here.
declare -A ENVV=()
load_env() {
  [ -f "$ENV_FILE" ] || return 0
  local k v
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue ;; esac
    ENVV["$k"]="$v"
  done < "$ENV_FILE"
}
get_env() { printf '%s' "${ENVV[$1]:-}"; }
write_env() {
  local tmp k
  mkdir -p "$ETC_DIR"
  tmp=$(mktemp "$ETC_DIR/.server.env.XXXXXX")
  {
    echo "# StickManUp server settings. Keep this file private: it holds your sign in secrets."
    for k in PORT HOST PUBLIC_URL DATA_DIR TERMS_FILE TLS_CERT TLS_KEY TRUST_PROXY DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET STEAM_LOGIN STEAM_API_KEY DISCORD_BOT_TOKEN DISCORD_BOT_GUILD DISCORD_BOT_LOG_CHANNEL DISCORD_BOT_WARN_CHANNEL DISCORD_BOT_ADMINS ANTICHEAT_WORKERS ANTICHEAT_BAN_SCORE ANTICHEAT_SPEED_SLACK ATTEST_SIGNATURE GUEST_LIMIT_BURST GUEST_LIMIT_PER_HOUR WALLET_DAILY_CAP WALLET_MIN_WIN_SECONDS WALLET_COINS_PER_SECOND WALLET_COIN_BURST; do
      [ -n "${ENVV[$k]:-}" ] && printf '%s=%s\n' "$k" "${ENVV[$k]}"
    done
    # Quiet the note about the built in database: it works, and the server only uses the plain parts of it.
    echo "NODE_NO_WARNINGS=1"
  } > "$tmp"
  if id "$APP_USER" >/dev/null 2>&1; then chown "root:$APP_USER" "$tmp" && chmod 640 "$tmp"; else chmod 600 "$tmp"; fi
  mv -f "$tmp" "$ENV_FILE"
}
# Keys go into a settings file, so only plain characters get in.
clean_key() { [[ "$1" =~ ^[A-Za-z0-9._~+/=:-]*$ ]]; }

# ---------------------------------------------------------------- the system
need_root() { [ "$(id -u)" = 0 ] || die "Please run this as root (with sudo)."; }

PKG=""
detect_pkg() {
  for p in apt-get dnf yum zypper pacman; do
    if command -v "$p" >/dev/null 2>&1; then PKG=$p; return 0; fi
  done
}
APT_UPDATED=0
# The package lists, fetched again only when an install needs it. A server often has other programs' package sources too
# (a web panel's, say), and one of those being down or gone is no reason to stop: apt still gets ours from the others.
apt_refresh() {
  [ "$APT_UPDATED" = 1 ] && return 0
  APT_UPDATED=1
  local out
  out=$(apt-get update -qq 2>&1) || true
  if printf '%s\n' "$out" | grep -qiE '^(E|W|Err):|failed to fetch'; then
    note "Some of this server's own package sources could not be reached (not StickManUp's). Going on without them."
  fi
}
pkg_install() {
  [ "$SKIP_PACKAGES" = 1 ] && return 0
  case "$PKG" in
    apt-get)
      # From what apt knows already, and only if that is not enough, with fresh lists.
      if ! DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null 2>&1; then
        apt_refresh
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
      fi ;;
    dnf|yum) "$PKG" install -y -q "$@" >/dev/null ;;
    zypper) zypper --non-interactive --quiet install "$@" >/dev/null ;;
    pacman) pacman -Sy --noconfirm --needed "$@" >/dev/null ;;
    *) return 1 ;;
  esac
}
install_basics() {
  [ "$SKIP_PACKAGES" = 1 ] && return 0
  say "Installing what is missing"
  detect_pkg
  [ -n "$PKG" ] || warn "No known package manager found. Make sure curl, tar, xz, openssl and ss are installed."
  local want=()
  command -v curl >/dev/null 2>&1 || want+=(curl)
  command -v tar >/dev/null 2>&1 || want+=(tar)
  command -v xz >/dev/null 2>&1 || { [ "$PKG" = apt-get ] && want+=(xz-utils) || want+=(xz); }
  command -v openssl >/dev/null 2>&1 || want+=(openssl)
  command -v ss >/dev/null 2>&1 || { case "$PKG" in dnf|yum) want+=(iproute) ;; zypper|pacman) want+=(iproute2) ;; *) want+=(iproute2) ;; esac; }
  if [ "$PKG" = apt-get ] && ! dpkg-query -W -f='${Status}' ca-certificates 2>/dev/null | grep -q 'ok installed'; then want+=(ca-certificates); fi
  [ ${#want[@]} -gt 0 ] || return 0
  pkg_install "${want[@]}" || die "Could not install: ${want[*]}"
}

port_free() {
  if command -v ss >/dev/null 2>&1; then
    [ -z "$(ss -ltnH "sport = :$1" 2>/dev/null)" ]
  elif (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then
    return 1
  else
    return 0
  fi
}
port_owner() { ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1; }

choose_port() {
  local cur p
  cur=$(get_env PORT)
  if [ -n "$OPT_PORT" ]; then
    [[ "$OPT_PORT" =~ ^[0-9]+$ ]] && [ "$OPT_PORT" -ge 1024 ] && [ "$OPT_PORT" -le 65535 ] || die "The port has to be a number from 1024 to 65535."
    if [ "$OPT_PORT" != "$cur" ] && ! port_free "$OPT_PORT"; then die "Port $OPT_PORT is already in use by $(port_owner "$OPT_PORT")."; fi
    ENVV[PORT]=$OPT_PORT
    return 0
  fi
  # Ours from last time: it may well be in use, by us.
  [ -n "$cur" ] && return 0
  for ((p = PORT_FIRST; p <= PORT_LAST; p++)); do
    if port_free "$p"; then ENVV[PORT]=$p; note "Using port $p (it was free)."; return 0; fi
  done
  die "No free port from $PORT_FIRST to $PORT_LAST. Pick one with --port."
}

public_ip() {
  local u ip
  for u in https://api.ipify.org https://ipv4.icanhazip.com https://ifconfig.me/ip; do
    ip=$(curl -4 -fsS --max-time 8 "$u" 2>/dev/null | tr -d ' \r\n') || continue
    if [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then printf '%s' "$ip"; return 0; fi
  done
  return 1
}

valid_domain() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]]; }

# ---------------------------------------------------------------- Node, in its own folder
node_ok() {
  local v
  v=$("$PREFIX/node/bin/node" -p 'const [a, b] = process.versions.node.split(".").map(Number); a > 22 || (a === 22 && b >= 13) ? "yes" : "no"' 2>/dev/null) || return 1
  [ "$v" = yes ]
}
install_node() {
  if [ -x "$PREFIX/node/bin/node" ] && node_ok; then note "Node is ready: $("$PREFIX/node/bin/node" --version)"; return 0; fi
  local arch tmp sums file want got
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "This server's processor ($(uname -m)) is not supported. It needs x86_64 or arm64." ;;
  esac
  say "Getting Node 22"
  tmp=$(mktemp -d)
  sums=$(curl -fsSL --retry 3 "$NODE_BASE/SHASUMS256.txt") || die "Could not reach nodejs.org."
  file=$(printf '%s\n' "$sums" | awk -v w="linux-$arch.tar.xz" 'index($2, w) { print $2; exit }')
  want=$(printf '%s\n' "$sums" | awk -v w="linux-$arch.tar.xz" 'index($2, w) { print $1; exit }')
  [ -n "$file" ] && [ -n "$want" ] || die "Could not find Node for this processor."
  curl -fsSL --retry 3 -o "$tmp/node.tar.xz" "$NODE_BASE/$file" || die "Could not download Node."
  got=$(sha256sum "$tmp/node.tar.xz" | awk '{print $1}')
  [ "$got" = "$want" ] || die "The Node download did not match its checksum, so it was not used."
  mkdir -p "$tmp/node"
  tar -xJf "$tmp/node.tar.xz" -C "$tmp/node" --strip-components=1 --no-same-owner
  "$tmp/node/bin/node" --version >/dev/null 2>&1 || die "Node does not run on this system (it needs a newer Linux, glibc 2.28 or later)."
  mkdir -p "$PREFIX"
  rm -rf "$PREFIX/node"
  mv "$tmp/node" "$PREFIX/node"
  chown -R root:root "$PREFIX/node" 2>/dev/null || true
  chmod -R go-w "$PREFIX/node"
  rm -rf "$tmp"
  note "Node is ready: $("$PREFIX/node/bin/node" --version)"
}

# ---------------------------------------------------------------- the server files
install_app() {
  local src="" here="" tmp=""
  here=$(cd "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")" 2>/dev/null && pwd) || here=""
  if [ -n "$here" ] && [ -f "$here/server.js" ] && [ -d "$here/vendor/ws" ]; then
    src=$here
    note "Using the server files next to this script."
  else
    say "Getting the server files from GitHub"
    tmp=$(mktemp -d)
    curl -fsSL --retry 3 "$REPO_TARBALL" | tar -xz -C "$tmp" --no-same-owner --wildcards '*/server/*' || die "Could not download the server files."
    src=$(find "$tmp" -type d -name server -print -quit)
    [ -n "$src" ] && [ -f "$src/server.js" ] || die "The download did not contain the server."
  fi
  mkdir -p "$PREFIX"
  rm -rf "$PREFIX/app.new"
  mkdir "$PREFIX/app.new"
  cp -R "$src/." "$PREFIX/app.new/"
  rm -rf "$PREFIX/app.new/data"
  chown -R root:root "$PREFIX/app.new" 2>/dev/null || true
  chmod -R a+rX,go-w "$PREFIX/app.new"
  rm -rf "$PREFIX/app"
  mv "$PREFIX/app.new" "$PREFIX/app"
  [ -n "$tmp" ] && rm -rf "$tmp"
  return 0
}

make_user() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    local shell=/bin/false s
    for s in /usr/sbin/nologin /sbin/nologin; do [ -x "$s" ] && shell=$s && break; done
    useradd --system --home-dir "$DATA_DIR" --no-create-home --shell "$shell" "$APP_USER"
  fi
  mkdir -p "$DATA_DIR/tls" "$ETC_DIR"
  chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
  chmod 700 "$DATA_DIR" "$DATA_DIR/tls"
  chown "root:$APP_USER" "$ETC_DIR"
  chmod 750 "$ETC_DIR"
}

# ---------------------------------------------------------------- the address and certificate
copy_cert() {
  local d=$1
  install -o "$APP_USER" -g "$APP_USER" -m 600 "$LE_DIR/live/$d/fullchain.pem" "$DATA_DIR/tls/fullchain.pem"
  install -o "$APP_USER" -g "$APP_USER" -m 600 "$LE_DIR/live/$d/privkey.pem" "$DATA_DIR/tls/privkey.pem"
}
install_hook() {
  local d=$1
  mkdir -p "$(dirname "$HOOK")"
  cat > "$HOOK" <<EOF
#!/bin/sh
# Hands a renewed certificate to the StickManUp server, which picks it up without dropping any games.
[ "\$RENEWED_LINEAGE" = "$LE_DIR/live/$d" ] || exit 0
install -o $APP_USER -g $APP_USER -m 600 "\$RENEWED_LINEAGE/fullchain.pem" "$DATA_DIR/tls/fullchain.pem"
install -o $APP_USER -g $APP_USER -m 600 "\$RENEWED_LINEAGE/privkey.pem" "$DATA_DIR/tls/privkey.pem"
systemctl reload $SERVICE
EOF
  chmod 755 "$HOOK"
}
install_certbot() {
  command -v certbot >/dev/null 2>&1 && return 0
  say "Installing certbot (it gets the free HTTPS certificate)"
  case "$PKG" in
    dnf|yum) "$PKG" install -y -q epel-release >/dev/null 2>&1 || true ;;
  esac
  pkg_install certbot || die "Could not install certbot. Install it yourself and run this again."
}
# Port 80 is only needed for a moment, now and at each renewal. If a web server already has it, certbot asks that one.
try_cert() {
  local d=$1 how=() who
  if port_free 80; then
    how=(--standalone --preferred-challenges http)
  else
    who=$(port_owner 80)
    case "$who" in
      nginx*) pkg_install python3-certbot-nginx >/dev/null 2>&1 || true; how=(--nginx) ;;
      apache2*|httpd*) pkg_install python3-certbot-apache >/dev/null 2>&1 || pkg_install python3-certbot-apache2 >/dev/null 2>&1 || true; how=(--apache) ;;
      *)
        warn "Port 80 is in use by ${who:-another program}, and Let's Encrypt needs it for a moment to prove this server is yours."
        return 2 ;;
    esac
  fi
  local mail=(--register-unsafely-without-email)
  [ -n "$OPT_EMAIL" ] && mail=(-m "$OPT_EMAIL" --no-eff-email)
  certbot certonly "${how[@]}" --non-interactive --agree-tos "${mail[@]}" --keep-until-expiring -d "$d" >&2
}
explain_cert_failure() {
  cat >&2 <<EOF

The HTTPS certificate failed, so the server was not started. The game can only talk to it over HTTPS.
Most likely fixes:
  * Make sure your domain points at this server, then run this again.
  * Open TCP port 80 in your hosting company's firewall (their control panel), then run this again.
  * If the free address hit Let's Encrypt's weekly limit, use your own domain. A free one comes from duckdns.org:
    run this again with --domain yourname.duckdns.org
  * If another program must keep port 80, run your own HTTPS proxy and use --proxy. See README.md.
EOF
  exit 1
}
# Let's Encrypt and the game both have to reach this server under that name. Better to say so now, in plain words, than
# to fail later in certbot's.
check_dns() {
  local d=$1 me got
  me=$(public_ip) || return 0
  got=$(getent ahostsv4 "$d" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ') || got=""
  case " $got" in *" $me "*) return 0 ;; esac
  warn "$d does not point at this server yet."
  note "  This server is:  $me"
  note "  $d points at:  ${got:-nothing}"
  cat >&2 <<EOF
  At the company you got the domain from, add an A record for this name with the address $me.
  If this name is for a website somewhere else, use a new name instead, like game.$d.
  If you use Cloudflare, set this name to DNS only (grey cloud): Cloudflare doesn't carry the game's port.
  A new record can take a few minutes to work.
EOF
  [ "$YES" = 1 ] && return 0
  yes_no "Try anyway?" n || die "Stopped. Nothing was started. Fix that and run this again."
}
setup_address() {
  local cur ip free1="" free2="" d=""
  cur=$(get_env PUBLIC_URL); cur=${cur#https://}; cur=${cur%:*}
  if [ -n "$OPT_DOMAIN" ]; then d=$OPT_DOMAIN
  elif [ -n "$cur" ]; then d=$cur
  else
    ip=$(public_ip) || ip=""
    if [ -n "$ip" ]; then
      free1="${ip//./-}.sslip.io"; free2="${ip//./-}.nip.io"
      note "This server's public address looks like $ip."
    fi
    say "The address of your server"
    note "HTTPS needs a name, not a bare IP. If you have a domain, point it at this server and type it here."
    note "No domain? Press Enter for a free automatic name. It works for Discord and Steam sign in. Google needs a real domain."
    if [ -n "$free1" ]; then ask d "Domain" "$free1"
    else ask d "Domain" ""; fi
  fi
  # However it got typed or pasted: HTTPS://Example.com/ is example.com.
  d=$(trim "$d" | tr '[:upper:]' '[:lower:]')
  d=${d#http://}; d=${d#https://}; d=${d%/}
  valid_domain "$d" || die "\"$d\" doesn't look like a domain name."

  if [ "$PROXY" = 1 ] || [ "$(get_env TRUST_PROXY)" = 1 ]; then
    ENVV[TRUST_PROXY]=1
    ENVV[HOST]=127.0.0.1
    ENVV[PUBLIC_URL]="https://$d"
    unset 'ENVV[TLS_CERT]' 'ENVV[TLS_KEY]'
    return 0
  fi

  ENVV[HOST]=0.0.0.0
  if [ ! -f "$LE_DIR/live/$d/fullchain.pem" ]; then
    check_dns "$d"
    say "Getting a free HTTPS certificate from Let's Encrypt"
    note "By going on you accept their terms: https://letsencrypt.org/repository/"
    if [ -z "$OPT_EMAIL" ]; then ask OPT_EMAIL "Email for expiry warnings (optional, Enter to skip)" ""; fi
    yes_no "Go on?" y || die "Stopped. Nothing was started."
    install_certbot
    open_firewall 80
    local got=0
    try_cert "$d" && got=1 || true
    # The free names share one weekly limit worldwide, so the other one may still have room.
    if [ "$got" = 0 ] && [ "$d" = "$free1" ] && [ -n "$free2" ]; then
      warn "That free name didn't work. Trying the other one."
      d=$free2
      try_cert "$d" && got=1 || true
    fi
    [ "$got" = 1 ] || explain_cert_failure
  fi
  copy_cert "$d"
  install_hook "$d"
  ENVV[TLS_CERT]="$DATA_DIR/tls/fullchain.pem"
  ENVV[TLS_KEY]="$DATA_DIR/tls/privkey.pem"
  ENVV[PUBLIC_URL]="https://$d:$(get_env PORT)"
}

open_firewall() {
  local p=$1
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow "$p/tcp" >/dev/null && note "Opened port $p in ufw."
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd --quiet --permanent --add-port="$p/tcp" && firewall-cmd --quiet --reload && note "Opened port $p in firewalld."
  fi
  return 0
}

# ---------------------------------------------------------------- sign in keys
setup_logins() {
  local url v s
  url=$(get_env PUBLIC_URL)
  [ "$YES" = 1 ] || [ "$HAS_TTY" = 0 ] && {
    # Nobody to ask: Steam needs no keys, so it can be on from the start.
    [ -n "$(get_env STEAM_LOGIN)" ] || ENVV[STEAM_LOGIN]=1
    return 0
  }
  say "Sign in with Discord, Steam and Google"
  note "Guests can always play. Press Enter to skip any of these and add it later with: install.sh --logins"
  cat >&2 <<EOF

DISCORD: https://discord.com/developers/applications
  New Application, then OAuth2. Copy the Client ID and Client Secret.
  Under Redirects add exactly:  $url/auth/discord/callback
EOF
  ask v "Discord Client ID" "$(get_env DISCORD_CLIENT_ID)"
  clean_key "$v" || die "That doesn't look like a Discord Client ID."
  ENVV[DISCORD_CLIENT_ID]=$v
  if [ -n "$v" ]; then
    ask_secret s "Discord Client Secret" "$(get_env DISCORD_CLIENT_SECRET)"
    clean_key "$s" || die "That doesn't look like a Discord secret."
    ENVV[DISCORD_CLIENT_SECRET]=$s
  fi
  cat >&2 <<EOF

GOOGLE: https://console.cloud.google.com/apis/credentials
  Create a project, set up the consent screen, then Create credentials, OAuth client ID, Web application.
  Under Authorized redirect URIs add exactly:  $url/auth/google/callback
EOF
  case "$url" in *.sslip.io*|*.nip.io*) warn "  Google is unlikely to accept this free address. For Google you need your own domain." ;; esac
  ask v "Google Client ID" "$(get_env GOOGLE_CLIENT_ID)"
  clean_key "$v" || die "That doesn't look like a Google Client ID."
  ENVV[GOOGLE_CLIENT_ID]=$v
  if [ -n "$v" ]; then
    ask_secret s "Google Client Secret" "$(get_env GOOGLE_CLIENT_SECRET)"
    clean_key "$s" || die "That doesn't look like a Google secret."
    ENVV[GOOGLE_CLIENT_SECRET]=$s
  fi
  cat >&2 <<EOF

STEAM: needs no setup and no store page. It just works.
  Optional, so players see their Steam name: get a Web API key at https://steamcommunity.com/dev/apikey
EOF
  if yes_no "Turn on Sign in through Steam?" y; then ENVV[STEAM_LOGIN]=1; else ENVV[STEAM_LOGIN]=0; fi
  if [ "$(get_env STEAM_LOGIN)" = 1 ]; then
    ask_secret s "Steam Web API key (optional, Enter to skip)" "$(get_env STEAM_API_KEY)"
    clean_key "$s" || die "That doesn't look like a Steam key."
    ENVV[STEAM_API_KEY]=$s
  fi
}

# ---------------------------------------------------------------- the service
# ---------------------------------------------------------------- the Discord bot
is_id() { [[ "$1" =~ ^[0-9]{15,22}$ ]]; }
ask_id() { # ask_id VAR "question" "current value" required|optional
  local __id=""
  while :; do
    ask __id "$2" "$3"
    if [ -z "$__id" ] && [ "$4" = optional ]; then break; fi
    is_id "$__id" && break
    warn "That isn't a Discord ID. It is a long number: with Developer Mode on, right click the thing and pick Copy ID."
  done
  printf -v "$1" '%s' "$__id"
}
# Who may use the commands: IDs with commas between them. Spaces are forgiven.
ask_admins() {
  local __who=""
  while :; do
    ask __who "User IDs, separated by commas" "$(get_env DISCORD_BOT_ADMINS)"
    __who=${__who// /}
    __who=${__who%,}
    if [ -z "$__who" ]; then
      warn "With nobody on the list, nobody can use a single command."
      yes_no "Leave it empty for now?" n && break
      continue
    fi
    [[ "$__who" =~ ^[0-9]{15,22}(,[0-9]{15,22})*$ ]] && break
    warn "Those aren't all Discord user IDs. Each one is a long number, like 123456789012345678,234567890123456789"
  done
  ENVV[DISCORD_BOT_ADMINS]=$__who
}
# Asks Discord about the token. Sent through a config on standard input, so it never shows up in the list of running programs.
bot_lookup() {
  printf 'header = "Authorization: Bot %s"\n' "$1" | curl -sS --max-time 10 -K - -o "$2" -w '%{http_code}' "https://discord.com/api/v10/$3" 2>/dev/null || true
}
setup_bot() {
  local v s app="" code tmp
  [ "$YES" = 1 ] || [ "$HAS_TTY" = 0 ] && return 0
  say "The Discord bot"
  note "It writes every sign in and every cheater warning in a channel of yours, and gives you over 60 slash commands:"
  note "bans with reasons, giving and taking coins, listing players, who played last, and more."
  note "It's optional, and the game works the same without it. Press Enter at the token to skip it."
  note "Add it later at any time with: install.sh --bot"
  cat >&2 <<EOF

  1. https://discord.com/developers/applications
     New Application, then Bot. Press Reset Token and copy the token.
     On the same page turn on Message Content Intent and Server Members Intent,
     for the ! commands, saving tickets, and join and leave messages.
  2. In Discord: User Settings, Advanced, turn on Developer Mode.
     Now a right click on a server, a channel or a person gives you Copy ID.
  3. Make a PRIVATE channel for the logs. They contain players' IP addresses.

EOF
  ask_secret s "Bot token" "$(get_env DISCORD_BOT_TOKEN)"
  clean_key "$s" || die "That doesn't look like a bot token."
  ENVV[DISCORD_BOT_TOKEN]=$s
  [ -n "$s" ] || { note "No bot for now."; return 0; }
  tmp=$(mktemp)
  code=$(bot_lookup "$s" "$tmp" users/@me)
  case "$code" in
    200)
      app=$(sed -n 's/.*"id": *"\([0-9]*\)".*/\1/p' "$tmp")
      note "Discord knows this bot as: $(sed -n 's/.*"username": *"\([^"]*\)".*/\1/p' "$tmp")" ;;
    401) warn "Discord says this token is wrong. It is saved anyway: fix it with install.sh --bot" ;;
    *) warn "Could not ask Discord about this token from here, so it isn't checked." ;;
  esac
  ask_id v "Your Discord server's ID" "$(get_env DISCORD_BOT_GUILD)" required
  ENVV[DISCORD_BOT_GUILD]=$v
  if [ -n "$app" ]; then
    code=$(bot_lookup "$s" "$tmp" "guilds/$v")
    if [ "$code" != 200 ]; then
      cat >&2 <<EOF

The bot isn't on that server yet. Open this link and add it:
  https://discord.com/oauth2/authorize?client_id=$app&scope=bot+applications.commands&permissions=117776

EOF
    fi
  fi
  rm -f "$tmp"
  ask_id v "ID of the channel for the logs" "$(get_env DISCORD_BOT_LOG_CHANNEL)" required
  ENVV[DISCORD_BOT_LOG_CHANNEL]=$v
  ask_id v "ID of a channel for cheater warnings (Enter to use the same one)" "$(get_env DISCORD_BOT_WARN_CHANNEL)" optional
  ENVV[DISCORD_BOT_WARN_CHANNEL]=$v
  cat >&2 <<EOF

Who may use the bot's commands? Everyone else gets refused, whatever their role on your Discord server.
Give their Discord user IDs, with a comma between them, like: 123456789012345678,234567890123456789
EOF
  ask_admins
}
bot_state() {
  local n=""
  if [ -z "$(get_env DISCORD_BOT_TOKEN)" ]; then printf 'off (set it up with --bot)'; return 0; fi
  n=$(get_env DISCORD_BOT_ADMINS)
  if [ -z "$n" ]; then printf 'on, but nobody may use the commands'; else n=${n//[!,]/}; printf 'on, %d may use the commands' "$(( ${#n} + 1 ))"; fi
}

install_service() {
  [ "$NO_SERVICE" = 1 ] && return 0
  command -v systemctl >/dev/null 2>&1 || die "This needs a server with systemd."
  cat > "$UNIT_DIR/$SERVICE.service" <<EOF
[Unit]
Description=StickManUp game server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
EnvironmentFile=$ENV_FILE
ExecStart=$PREFIX/node/bin/node $PREFIX/app/server.js
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=3
LimitNOFILE=65536
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null 2>&1
  systemctl restart "$SERVICE"
}

check_running() {
  [ "$NO_SERVICE" = 1 ] && return 0
  local url port host i
  url=$(get_env PUBLIC_URL); port=$(get_env PORT); host=${url#https://}; host=${host%:*}
  say "Checking that it answers"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if [ "$(get_env TRUST_PROXY)" = 1 ]; then
      curl -fsS --max-time 3 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && { note "It answers on this machine."; return 0; }
    else
      curl -fsS --max-time 3 --resolve "$host:$port:127.0.0.1" "https://$host:$port/api/health" >/dev/null 2>&1 && break
    fi
    sleep 2
  done
  if [ "$i" = 10 ] && ! systemctl is-active --quiet "$SERVICE"; then
    journalctl -u "$SERVICE" -n 15 --no-pager >&2 || true
    die "The server did not start. The lines above say why."
  fi
  if curl -fsS --max-time 6 "$url/api/health" >/dev/null 2>&1; then
    note "It answers from the internet too."
  else
    warn "It runs, but this machine can't reach it through its public address. That can be normal, or the port is blocked."
    warn "If the game can't connect, open TCP port $port in your hosting company's firewall (their control panel)."
  fi
}

summary() {
  local url providers=""
  url=$(get_env PUBLIC_URL)
  [ -n "$(get_env DISCORD_CLIENT_SECRET)" ] && providers="$providers Discord"
  [ "$(get_env STEAM_LOGIN)" = 1 ] && providers="$providers Steam"
  [ -n "$(get_env GOOGLE_CLIENT_SECRET)" ] && providers="$providers Google"
  cat >&2 <<EOF

========================================================
 StickManUp server is ready

 Server address:  $url
 Sign in with:   ${providers:- nothing yet (guests can play)}
 Discord bot:    $(bot_state)

 The game has one address built in, SERVER in assets/js/cloud.js.
 If this one is different, send it to whoever builds the game.

 Settings:        $ENV_FILE
 Players' data:   $DATA_DIR (a backup is made every day)
 Your own terms:  copy $PREFIX/app/terms.txt to $ETC_DIR/terms.txt and edit it
                  (other languages next to it as terms.de.txt, terms.es.txt and so on)

 Update:   curl -fsSL https://raw.githubusercontent.com/TheOCP/stickmanup/main/server/install.sh | sudo bash -s -- --update
 Logs:     journalctl -u $SERVICE -f
========================================================
EOF
  [ "$(get_env TRUST_PROXY)" = 1 ] && cat >&2 <<EOF

 Proxy mode: point your HTTPS proxy at http://127.0.0.1:$(get_env PORT) with WebSocket upgrades on and with
 X-Forwarded-For set to the visitor's real address. See README.md.
EOF
  return 0
}

# ---------------------------------------------------------------- what to do
# Run as curl | bash, this script IS the standard input, read a line at a time. Any program started below that reads its
# input (package managers do) would swallow the rest of the script, and the install would just stop halfway. So bash reads
# all of this first, and what it starts gets no input at all. A download cut short also runs nothing this way.
main() {
  case "$MODE" in
    status)
      systemctl --no-pager status "$SERVICE" || true
      load_env
      u=$(get_env PUBLIC_URL)
      [ -n "$u" ] && { note ""; note "Address: $u"; curl -fsS --max-time 6 "$u/api/health" || warn "No answer from there."; note ""; }
      note "Discord bot: $(bot_state)"
      exit 0 ;;
    uninstall)
      need_root
      yes_no "Remove the StickManUp server?" n || exit 0
      systemctl disable --now "$SERVICE" 2>/dev/null || true
      rm -f "$UNIT_DIR/$SERVICE.service" "$HOOK"
      systemctl daemon-reload 2>/dev/null || true
      rm -rf "$PREFIX"
      if [ "$PURGE" = 1 ]; then
        yes_no "Really delete all accounts and saved progress in $DATA_DIR, and your settings?" n && {
          rm -rf "$DATA_DIR" "$ETC_DIR"
          userdel "$APP_USER" 2>/dev/null || true
          note "Deleted."
        }
      else
        note "Players' data stays in $DATA_DIR and settings in $ETC_DIR. Add --purge to delete those too."
      fi
      note "Removed. The certificate stays with certbot (certbot delete removes it)."
      exit 0 ;;
    update)
      need_root
      load_env
      [ -n "$(get_env PUBLIC_URL)" ] || die "Nothing to update here yet. Run this without --update first."
      install_basics
      install_node
      install_app
      install_service
      check_running
      note "Updated."
      exit 0 ;;
    bot)
      need_root
      load_env
      [ -n "$(get_env PUBLIC_URL)" ] || die "Install the server first: run this without --bot."
      setup_bot
      write_env
      if [ "$NO_SERVICE" = 0 ]; then systemctl restart "$SERVICE"; fi
      check_running
      summary
      exit 0 ;;
    logins)
      need_root
      load_env
      [ -n "$(get_env PUBLIC_URL)" ] || die "Install the server first: run this without --logins."
      setup_logins
      write_env
      if [ "$NO_SERVICE" = 0 ]; then systemctl restart "$SERVICE"; fi
      summary
      exit 0 ;;
  esac

  need_root
  say "StickManUp server"
  note "by TheOCProductions and ShortGG"
  load_env
  install_basics
  make_user
  choose_port
  ENVV[DATA_DIR]=$DATA_DIR
  ENVV[TERMS_FILE]=$ETC_DIR/terms.txt
  setup_address
  install_node
  install_app
  setup_logins
  setup_bot
  write_env
  if [ "$(get_env TRUST_PROXY)" != 1 ]; then open_firewall "$(get_env PORT)"; fi
  install_service
  check_running
  summary
}

main </dev/null
