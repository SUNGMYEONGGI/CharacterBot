#!/bin/sh
# Installs the latest CharacterBot into /Applications.
# curl downloads carry no quarantine flag, so Gatekeeper doesn't block the unsigned build.
set -eu
[ "$(uname -s)" = Darwin ] || { echo "CharacterBot runs on macOS only." >&2; exit 1; }
[ "$(uname -m)" = arm64 ] || { echo "CharacterBot needs a Mac with Apple silicon." >&2; exit 1; }

URL=https://github.com/SUNGMYEONGGI/CharacterBot/releases/latest/download/CharacterBot-arm64.dmg
TMP=$(mktemp -d)
MNT="$TMP/mnt"
trap 'hdiutil detach -quiet "$MNT" 2>/dev/null || true; rm -rf "$TMP"' EXIT

echo "Downloading CharacterBot..."
curl -fL --progress-bar "$URL" -o "$TMP/CharacterBot.dmg"
hdiutil attach -quiet -nobrowse -mountpoint "$MNT" "$TMP/CharacterBot.dmg"

osascript -e 'quit app "CharacterBot"' 2>/dev/null || true
rm -rf /Applications/CharacterBot.app
ditto "$MNT/CharacterBot.app" /Applications/CharacterBot.app
xattr -dr com.apple.quarantine /Applications/CharacterBot.app 2>/dev/null || true

echo "Installed to /Applications/CharacterBot.app"
open /Applications/CharacterBot.app
