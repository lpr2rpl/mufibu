#!/bin/sh
# Builds dist/netwatch_<version>_<arch>.deb for Devuan (SysVinit).
# Usage: scripts/build-deb.sh [rust-target-triple]
set -eu
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
TARGET=${1:-}
if [ -n "$TARGET" ]; then
    cargo build --release --locked --target "$TARGET"
    BIN=target/$TARGET/release/netwatch
else
    cargo build --release --locked
    BIN=target/release/netwatch
fi
case "${TARGET:-$(uname -m)}" in
    x86_64*|amd64*) ARCH=amd64 ;;
    aarch64*|arm64*) ARCH=arm64 ;;
    armv7*|arm*) ARCH=armhf ;;
    *) ARCH=$(dpkg --print-architecture) ;;
esac
PKG=target/pkg
rm -rf "$PKG"
install -d "$PKG/DEBIAN" "$PKG/usr/bin" "$PKG/etc/netwatch" "$PKG/etc/init.d" \
    "$PKG/etc/logrotate.d" "$PKG/usr/share/doc/netwatch"
install -m 0755 "$BIN" "$PKG/usr/bin/netwatch"
install -m 0640 packaging/etc/netwatch.toml "$PKG/etc/netwatch/netwatch.toml"
install -m 0755 packaging/init.d/netwatch "$PKG/etc/init.d/netwatch"
install -m 0644 packaging/logrotate "$PKG/etc/logrotate.d/netwatch"
install -m 0644 README.md "$PKG/usr/share/doc/netwatch/README"
for s in postinst prerm postrm; do
    install -m 0755 "packaging/debian/$s" "$PKG/DEBIAN/$s"
done
printf '/etc/netwatch/netwatch.toml\n/etc/init.d/netwatch\n/etc/logrotate.d/netwatch\n' > "$PKG/DEBIAN/conffiles"
SIZE=$(du -sk "$PKG/usr" "$PKG/etc" | awk '{s+=$1} END{print s}')
cat > "$PKG/DEBIAN/control" <<CTL
Package: netwatch
Version: $VERSION
Section: net
Priority: optional
Architecture: $ARCH
Installed-Size: $SIZE
Depends: sysvinit-utils, adduser, ca-certificates
Recommends: logrotate
Maintainer: netwatch maintainers <root@localhost>
Description: DNS and SMTP availability monitor with SMS alerting
 Checks a DNS resolver and an SMTP server periodically. If a check fails
 continuously for two minutes, an SMS is sent through a REST API.
CTL
mkdir -p dist
dpkg-deb --root-owner-group --build "$PKG" "dist/netwatch_${VERSION}_${ARCH}.deb"
echo "built dist/netwatch_${VERSION}_${ARCH}.deb"
