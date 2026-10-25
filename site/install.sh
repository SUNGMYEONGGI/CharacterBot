#!/bin/sh
# Installs the latest PixelBot into /Applications.
# curl downloads carry no quarantine flag, so Gatekeeper doesn't block the unsigned build.
set -eu
[ "$(uname -s)" = Darwin ] || { echo "PixelBot runs on macOS only." >&2; exit 1; }
[ "$(uname -m)" = arm64 ] || { echo "PixelBot needs a Mac with Apple silicon." >&2; exit 1; }

URL=https://github.com/SUNGMYEONGGI/CharacterBot/releases/latest/download/PixelBot-arm64.dmg
TMP=$(mktemp -d)
MNT="$TMP/mnt"
trap 'hdiutil detach -quiet "$MNT" 2>/dev/null || true; rm -rf "$TMP"' EXIT

echo "Downloading PixelBot..."
curl -fL --progress-bar "$URL" -o "$TMP/PixelBot.dmg"
hdiutil attach -quiet -nobrowse -mountpoint "$MNT" "$TMP/PixelBot.dmg"

osascript -e 'quit app "PixelBot"' 2>/dev/null || true
# PixelBot was called CharacterBot before v0.2.0; it moves the old data over on first launch.
osascript -e 'quit app "CharacterBot"' 2>/dev/null || true
rm -rf /Applications/PixelBot.app /Applications/CharacterBot.app
ditto "$MNT/PixelBot.app" /Applications/PixelBot.app
xattr -dr com.apple.quarantine /Applications/PixelBot.app 2>/dev/null || true

echo "Installed to /Applications/PixelBot.app"
open /Applications/PixelBot.app
