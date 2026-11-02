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
#   --status            show how the server is doing
#   --uninstall         remove the server (add --purge to delete players' data too)
#   --domain NAME       your domain name
#   --email ADDRESS     where Let's Encrypt may warn you about your certificate (optional)
#   --port N            use this port (1024 or higher)
#   --proxy             no certificate here: you already run an HTTPS proxy that will forward to this server
#   --yes               ask nothing, use the defaults
set -euo pipefail

REPO_TARBALL="https://codeload.github.com/TheOCP/stickmanup/tar.gz/refs/heads/main"
NODE_BASE="https://nodejs.org/dist/latest-v22.x"
SERVICE=stickmanup
APP_USER=stickmanup
PREFIX="${STICKMANUP_PREFIX:-/opt/stickmanup}"
DATA_DIR="${STICKMANUP_DATA:-/var/lib/stickmanup}"
ETC_DIR="${STICKMANUP_ETC:-/etc/stickmanup}"
ENV_FILE="$ETC_DIR/server.env"
HOOK="/etc/letsencrypt/renewal-hooks/deploy/stickmanup.sh"
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

ask() { # ask VAR "question" "default"
  local __var=$1 q=$2 d=${3:-} a=""
  if [ "$YES" = 1 ] || [ "$HAS_TTY" = 0 ]; then printf -v "$__var" '%s' "$d"; return 0; fi
  if [ -n "$d" ]; then printf '%s [%s]: ' "$q" "$d" >&2; else printf '%s: ' "$q" >&2; fi
  IFS= read -r a < /dev/tty || a=""
  printf -v "$__var" '%s' "${a:-$d}"
}
ask_secret() { # ask_secret VAR "question" "current value, kept on Enter"
  local __var=$1 q=$2 d=${3:-} a=""
  if [ "$YES" = 1 ] || [ "$HAS_TTY" = 0 ]; then printf -v "$__var" '%s' "$d"; return 0; fi
  if [ -n "$d" ]; then printf '%s [Enter keeps the current one]: ' "$q" >&2; else printf '%s (hidden while you type): ' "$q" >&2; fi
  IFS= read -rs a < /dev/tty || a=""
  printf '\n' >&2
  printf -v "$__var" '%s' "${a:-$d}"
}
yes_no() { # yes_no "question" y|n
  local a=""
  ask a "$1 (y/n)" "$2"
  case "$a" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
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
    for k in PORT HOST PUBLIC_URL DATA_DIR TERMS_FILE TLS_CERT TLS_KEY TRUST_PROXY DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET STEAM_LOGIN STEAM_API_KEY; do
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
pkg_install() {
  [ "$SKIP_PACKAGES" = 1 ] && return 0
  case "$PKG" in
    apt-get)
      if [ "$APT_UPDATED" = 0 ]; then apt-get update -qq; APT_UPDATED=1; fi
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null ;;
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
  [ "$PKG" = apt-get ] && want+=(ca-certificates)
  if [ ${#want[@]} -gt 0 ]; then pkg_install "${want[@]}" || die "Could not install: ${want[*]}"; fi
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
  install -o "$APP_USER" -g "$APP_USER" -m 600 "/etc/letsencrypt/live/$d/fullchain.pem" "$DATA_DIR/tls/fullchain.pem"
  install -o "$APP_USER" -g "$APP_USER" -m 600 "/etc/letsencrypt/live/$d/privkey.pem" "$DATA_DIR/tls/privkey.pem"
}
install_hook() {
  local d=$1
  mkdir -p "$(dirname "$HOOK")"
  cat > "$HOOK" <<EOF
#!/bin/sh
# Hands a renewed certificate to the StickManUp server, which picks it up without dropping any games.
[ "\$RENEWED_LINEAGE" = "/etc/letsencrypt/live/$d" ] || exit 0
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
  * Open TCP port 80 in your hosting company's firewall (their control panel), then run this again.
  * If the free address hit Let's Encrypt's weekly limit, use your own domain. A free one comes from duckdns.org:
    run this again with --domain yourname.duckdns.org
  * If another program must keep port 80, run your own HTTPS proxy and use --proxy. See README.md.
Nothing you entered is lost. Just run this again.
EOF
  exit 1
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
  d=$(printf '%s' "$d" | tr '[:upper:]' '[:lower:]')
  valid_domain "$d" || die "\"$d\" doesn't look like a domain name."

  if [ "$PROXY" = 1 ] || [ "$(get_env TRUST_PROXY)" = 1 ]; then
    ENVV[TRUST_PROXY]=1
    ENVV[HOST]=127.0.0.1
    ENVV[PUBLIC_URL]="https://$d"
    unset 'ENVV[TLS_CERT]' 'ENVV[TLS_KEY]'
    return 0
  fi

  ENVV[HOST]=0.0.0.0
  if [ ! -f "/etc/letsencrypt/live/$d/fullchain.pem" ]; then
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
install_service() {
  [ "$NO_SERVICE" = 1 ] && return 0
  command -v systemctl >/dev/null 2>&1 || die "This needs a server with systemd."
  cat > "/etc/systemd/system/$SERVICE.service" <<EOF
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

 In the game: Settings, then Server address, and paste it.
 Or send it to whoever builds the game, so it is built in.

 Settings:        $ENV_FILE
 Players' data:   $DATA_DIR (a backup is made every day)
 Your own terms:  copy $PREFIX/app/terms.txt to $ETC_DIR/terms.txt and edit it

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
case "$MODE" in
  status)
    systemctl --no-pager status "$SERVICE" || true
    load_env
    u=$(get_env PUBLIC_URL)
    [ -n "$u" ] && { note ""; note "Address: $u"; curl -fsS --max-time 6 "$u/api/health" || warn "No answer from there."; note ""; }
    exit 0 ;;
  uninstall)
    need_root
    yes_no "Remove the StickManUp server?" n || exit 0
    systemctl disable --now "$SERVICE" 2>/dev/null || true
    rm -f "/etc/systemd/system/$SERVICE.service" "$HOOK"
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
write_env
if [ "$(get_env TRUST_PROXY)" != 1 ]; then open_firewall "$(get_env PORT)"; fi
install_service
check_running
summary
