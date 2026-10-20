#!/usr/bin/env bash
# Empacota o app de Mac a partir do Linux: monta o .app, assina ad-hoc (rcodesign) e gera um .zip que preserva links simbólicos.
# Uso: build/pack-mac-on-linux.sh arm64|x64   (precisa de rcodesign no PATH ou em RCODESIGN=...)
set -euo pipefail
ARCH="${1:-arm64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RC="${RCODESIGN:-rcodesign}"
VER="$(node -p "require('$ROOT/package.json').version")"
node "$ROOT/build/stage.js" darwin "$ARCH"
node "$ROOT/build/build.js" darwin "$ARCH"
SRC="$ROOT/build/stage-darwin-$ARCH/dist/mac-$ARCH/Minuta.app"; [ -d "$SRC" ] || SRC="$ROOT/build/stage-darwin-$ARCH/dist/mac/Minuta.app"
OUT="$ROOT/dist"; WORK="$ROOT/build/macpkg-$ARCH"
rm -rf "$WORK" && mkdir -p "$WORK" "$OUT"
cp -a "$SRC" "$WORK/"
"$RC" sign "$WORK/Minuta.app" >/dev/null
( cd "$WORK" && rm -f "$OUT/Minuta-$VER-mac-$ARCH.zip" && zip -qry -9 "$OUT/Minuta-$VER-mac-$ARCH.zip" Minuta.app )
echo "Gerado: $OUT/Minuta-$VER-mac-$ARCH.zip ($(du -h "$OUT/Minuta-$VER-mac-$ARCH.zip" | cut -f1))"
