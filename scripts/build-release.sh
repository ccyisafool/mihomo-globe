#!/bin/sh

set -eu

# Prevent macOS Finder/provenance metadata from becoming pax headers that
# produce warnings on OpenWrt's BusyBox tar.
export COPYFILE_DISABLE=1

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
RELEASE_DIR="$PROJECT_ROOT/release"
WORK_DIR="$(mktemp -d /tmp/mihomo-globe-release.XXXXXX)"
PAYLOAD="$WORK_DIR/mihomo-globe"
ARCHIVE="$RELEASE_DIR/mihomo-globe.tar.gz"

cleanup() {
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

cd "$PROJECT_ROOT"
npm run build

mkdir -p "$PAYLOAD/www/cgi-bin" "$RELEASE_DIR"
cp -R dist/. "$PAYLOAD/www/"
# The Sites development plugin emits local metadata; it is intentionally not
# part of the router-only release.
rm -rf "$PAYLOAD/www/.openai"
cp router/mihomo-globe-api "$PAYLOAD/www/cgi-bin/mihomo-globe-api"
cp router/mihomo-globe.init "$PAYLOAD/mihomo-globe.init"
cp router/mihomo-globe.config "$PAYLOAD/mihomo-globe.config"
cp router/mihomo-globe-status "$PAYLOAD/mihomo-globe-status"
cp router/mihomo-globe-update "$PAYLOAD/mihomo-globe-update"
cp router/mihomo-globe-uninstall "$PAYLOAD/mihomo-globe-uninstall"
cp router/install.sh "$PAYLOAD/install.sh"
cp README.md THIRD_PARTY_NOTICES.md "$PAYLOAD/"

chmod 0755 "$PAYLOAD/install.sh" "$PAYLOAD/mihomo-globe.init" \
    "$PAYLOAD/mihomo-globe-status" "$PAYLOAD/mihomo-globe-update" \
    "$PAYLOAD/mihomo-globe-uninstall" "$PAYLOAD/www/cgi-bin/mihomo-globe-api"

rm -f "$ARCHIVE" "$ARCHIVE.sha256"
tar --no-xattrs -czf "$ARCHIVE" -C "$WORK_DIR" mihomo-globe

if command -v sha256sum >/dev/null 2>&1; then
    (cd "$RELEASE_DIR" && sha256sum mihomo-globe.tar.gz > mihomo-globe.tar.gz.sha256)
else
    (cd "$RELEASE_DIR" && shasum -a 256 mihomo-globe.tar.gz > mihomo-globe.tar.gz.sha256)
fi

cp router/install.sh "$RELEASE_DIR/install.sh"
chmod 0755 "$RELEASE_DIR/install.sh"

printf 'Release created: %s\n' "$ARCHIVE"
