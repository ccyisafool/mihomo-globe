#!/bin/sh

set -eu

APP_NAME='mihomo-globe'
APP_ROOT='/usr/share/mihomo-globe'
INIT_SCRIPT='/etc/init.d/mihomo-globe'
CONFIG_FILE='/etc/config/mihomo-globe'
ARCHIVE_URL="${1:-${MIHOMO_GLOBE_ARCHIVE_URL:-}}"

fail() {
    printf 'mihomo-globe: %s\n' "$1" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

download() {
    source_url="$1"
    destination="$2"

    case "$source_url" in
        /*)
            [ -r "$source_url" ] || return 1
            cp "$source_url" "$destination"
            return
            ;;
        file://*)
            local_path="${source_url#file://}"
            [ -r "$local_path" ] || return 1
            cp "$local_path" "$destination"
            return
            ;;
    esac

    if command -v wget >/dev/null 2>&1; then
        wget -q -O "$destination" "$source_url"
    elif command -v curl >/dev/null 2>&1; then
        curl --fail --location --silent --show-error -o "$destination" "$source_url"
    else
        fail 'install wget or curl first'
    fi
}

if [ "$(id -u)" -ne 0 ]; then
    fail 'run this installer as root on the OpenWrt router'
fi

[ -r /etc/openwrt_release ] || fail 'this installer is intended for OpenWrt'
require_command tar
require_command sha256sum
require_command uci

if [ -z "$ARCHIVE_URL" ]; then
    ARCHIVE_URL="$(uci -q get mihomo-globe.main.archive_url || true)"
fi

[ -n "$ARCHIVE_URL" ] || fail 'set MIHOMO_GLOBE_ARCHIVE_URL or pass the release archive URL or local path as the first argument'
[ -x /usr/sbin/uhttpd ] || fail 'uhttpd is required (opkg update && opkg install uhttpd)'

WORK_DIR="$(mktemp -d /tmp/mihomo-globe-install.XXXXXX)"
ARCHIVE="$WORK_DIR/mihomo-globe.tar.gz"
CHECKSUM="$WORK_DIR/mihomo-globe.tar.gz.sha256"
EXTRACTED="$WORK_DIR/extracted"
STAGE="${APP_ROOT}.new.$$"
PREVIOUS="${APP_ROOT}.previous"

cleanup() {
    rm -rf "$WORK_DIR" "$STAGE"
}
trap cleanup EXIT INT TERM

printf '%s\n' 'Downloading Mihomo Globe…'
download "$ARCHIVE_URL" "$ARCHIVE" || fail 'could not download the release archive'

if download "${ARCHIVE_URL}.sha256" "$CHECKSUM" 2>/dev/null; then
    expected="$(sed -n '1{s/[[:space:]].*$//;p;}' "$CHECKSUM")"
    actual="$(sha256sum "$ARCHIVE" | sed 's/[[:space:]].*$//')"
    [ -n "$expected" ] && [ "$expected" = "$actual" ] || fail 'release checksum verification failed'
    printf '%s\n' 'Checksum verified.'
else
    printf '%s\n' 'Warning: no checksum file was available; continuing with transport security only.' >&2
fi

tar -tzf "$ARCHIVE" | while IFS= read -r entry; do
    case "$entry" in
        /*|../*|*/../*|*/..)
            fail 'release archive contains an unsafe path'
            ;;
    esac
done

mkdir -p "$EXTRACTED"
tar -xzf "$ARCHIVE" -C "$EXTRACTED"
PAYLOAD="$EXTRACTED/mihomo-globe"

[ -f "$PAYLOAD/www/index.html" ] || fail 'release archive has no web application'
[ -f "$PAYLOAD/www/cgi-bin/mihomo-globe-api" ] || fail 'release archive has no router bridge'
[ -f "$PAYLOAD/mihomo-globe.init" ] || fail 'release archive has no service definition'
[ -f "$PAYLOAD/mihomo-globe.config" ] || fail 'release archive has no default configuration'
[ -f "$PAYLOAD/install.sh" ] || fail 'release archive has no updater'

if find "$PAYLOAD" -type l | read -r _; then
    fail 'release archive must not contain symbolic links'
fi

/etc/init.d/mihomo-globe stop >/dev/null 2>&1 || true
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$PAYLOAD/www" "$STAGE/www"
cp "$PAYLOAD/install.sh" "$STAGE/install.sh"

chmod 0755 "$STAGE/install.sh" "$STAGE/www/cgi-bin/mihomo-globe-api"
find "$STAGE/www" -type d -exec chmod 0755 {} \;
find "$STAGE/www" -type f ! -path '*/cgi-bin/mihomo-globe-api' -exec chmod 0644 {} \;

rm -rf "$PREVIOUS"
if [ -d "$APP_ROOT" ]; then
    mv "$APP_ROOT" "$PREVIOUS"
fi
mv "$STAGE" "$APP_ROOT"

cp "$PAYLOAD/mihomo-globe.init" "$INIT_SCRIPT"
cp "$PAYLOAD/mihomo-globe-status" '/usr/bin/mihomo-globe-status'
cp "$PAYLOAD/mihomo-globe-update" '/usr/bin/mihomo-globe-update'
cp "$PAYLOAD/mihomo-globe-uninstall" '/usr/bin/mihomo-globe-uninstall'
chmod 0755 "$INIT_SCRIPT" /usr/bin/mihomo-globe-status /usr/bin/mihomo-globe-update /usr/bin/mihomo-globe-uninstall

if [ ! -f "$CONFIG_FILE" ]; then
    cp "$PAYLOAD/mihomo-globe.config" "$CONFIG_FILE"
    chmod 0600 "$CONFIG_FILE"
fi

mkdir -p /etc/mihomo-globe
chmod 0700 /etc/mihomo-globe

if ! uci -q get mihomo-globe.main.github_token_file >/dev/null 2>&1; then
    uci -q set mihomo-globe.main.github_token_file='/etc/mihomo-globe/github-token'
fi

case "$ARCHIVE_URL" in
    http://*|https://*)
        uci -q set mihomo-globe.main.archive_url="$ARCHIVE_URL"
        ;;
    *)
        # A directly uploaded archive is usually temporary and must not become
        # the remembered update source.
        uci -q set mihomo-globe.main.archive_url=''
        ;;
esac
uci -q commit mihomo-globe

if ! "$INIT_SCRIPT" enable; then
    fail 'could not enable the service'
fi

if ! "$INIT_SCRIPT" restart; then
    if [ -d "$PREVIOUS" ]; then
        rm -rf "$APP_ROOT"
        mv "$PREVIOUS" "$APP_ROOT"
        "$INIT_SCRIPT" restart >/dev/null 2>&1 || true
    fi
    fail 'the service did not start; the previous web application was restored when available'
fi

port="$(uci -q get mihomo-globe.main.port || printf '9091')"
address="$(ubus call network.interface.lan status 2>/dev/null \
    | jsonfilter -e '@["ipv4-address"][0].address' 2>/dev/null \
    || true)"
[ -n "$address" ] || address='<router-lan-ip>'

printf '\n%s\n' 'Mihomo Globe is installed and running.'
printf 'Open: http://%s:%s/\n' "$address" "$port"
printf '%s\n' 'Status: mihomo-globe-status'
