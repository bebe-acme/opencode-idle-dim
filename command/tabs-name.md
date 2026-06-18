---
description: Auto-name each iTerm2 tab after its opencode project folder(s), e.g. proj1:proj2
---

# Name iTerm2 tabs after their project folders

Run this exact command with Bash:

```bash
~/.local/bin/opencode-iterm-state tabs-name
```

How it works:
- For each iTerm2 tab, it finds the opencode panes and uses each pane's **project folder name** (the basename of its working directory), unless an alias is defined (see below).
- It sets the tab name to the panes joined with `:` (e.g. `DIMM:FINANCES`). A single-pane tab just gets its one label.
- Both panes of a split tab get the same combined name, so the tab reads correctly no matter which pane is focused.
- The working directory is detected from the running opencode process (`lsof`), so it works on sessions that are already open.
- Names are applied via AppleScript, so even manually-named (locked) sessions are updated — OSC escape codes are silently ignored by those.
- Non-opencode panes (plain shells, `ssh`, `btop`, ...) are left untouched.
- Safe to run anytime; re-run after opening or moving projects.

Short labels via alias file (`~/.config/opencode/tab-aliases.conf`):
- Lines `<full-path-or-basename>=<label>` map a project folder to a short tab label, so this command reproduces your own names instead of raw basenames.
- Example: `opencode-idle-dim=DIMM` makes that folder show as `DIMM`. A full-path key wins over a basename key.
- Folders with no alias fall back to their basename.

Note: iTerm appends the foreground job (e.g. ` (node)`) to the name automatically — that is expected.

Report the command output concisely (one line per tab: ttys -> name).
