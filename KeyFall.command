#!/bin/zsh
# Double-click to start KeyFall and open it in Chrome.
# Always uses http://localhost:5173 — Chrome's LUMI (MIDI/SysEx) permission belongs to that exact address.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")"
URL="http://localhost:5173"

# Already running? Just open it.
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  open -a "Google Chrome" "$URL"
  exit 0
fi

[ -d node_modules ] || npm install
(sleep 3; open -a "Google Chrome" "$URL") &
echo "KeyFall is running at $URL — close this window (or press Ctrl+C) to stop it."
npm run dev -- --port 5173 --strictPort
