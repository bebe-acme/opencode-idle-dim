#!/usr/bin/env bash
set -euo pipefail

# Installs opencode-idle-dim into the standard locations:
#   bin/opencode-iterm-state -> ~/.local/bin/opencode-iterm-state
#   plugin/idle-dim.js       -> ~/.config/opencode/plugin/idle-dim.js
#   themes/beib-dim.json     -> ~/.config/opencode/themes/beib-dim.json
#   command/idle.md          -> ~/.config/opencode/command/idle.md
#   command/active.md        -> ~/.config/opencode/command/active.md
# and registers the plugin in ~/.config/opencode/tui.json (created if missing,
# merged if it already exists and python3 is available).

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OC_DIR="${HOME}/.config/opencode"
TUI_JSON="${OC_DIR}/tui.json"

mkdir -p "${HOME}/.local/bin" "${OC_DIR}/plugin" "${OC_DIR}/themes" "${OC_DIR}/command"

install -m 0755 "${REPO_DIR}/bin/opencode-iterm-state" "${HOME}/.local/bin/opencode-iterm-state"
install -m 0644 "${REPO_DIR}/plugin/idle-dim.js" "${OC_DIR}/plugin/idle-dim.js"
install -m 0644 "${REPO_DIR}/themes/beib-dim.json" "${OC_DIR}/themes/beib-dim.json"
install -m 0644 "${REPO_DIR}/command/idle.md" "${OC_DIR}/command/idle.md"
install -m 0644 "${REPO_DIR}/command/active.md" "${OC_DIR}/command/active.md"

if [[ ! -f "$TUI_JSON" ]]; then
  printf '%s\n' '{' '  "plugin": ["./plugin/idle-dim.js"]' '}' > "$TUI_JSON"
  echo "created $TUI_JSON"
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$TUI_JSON" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    cfg = json.load(f)
plugins = cfg.setdefault("plugin", [])
entry = "./plugin/idle-dim.js"
if entry not in plugins:
    plugins.append(entry)
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    print(f"registered plugin in {path}")
else:
    print(f"plugin already registered in {path}")
PY
else
  echo "NOTE: add \"./plugin/idle-dim.js\" to the \"plugin\" array of $TUI_JSON manually."
fi

echo
echo "Installed. Restart every running opencode instance once so the TUI plugin loads."
echo "Then use /idle and /active inside opencode."
