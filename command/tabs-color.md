---
description: Recolor all iTerm2 tabs by state (teal if any pane is active, grey only when every pane is idle)
---

# Sync iTerm2 tab colors to session state

Run this exact command with Bash:

```bash
~/.local/bin/opencode-iterm-state tabs-color
```

How it works:
- Looks at every iTerm2 tab across all windows. A tab is painted **teal** (`#529e99`) if **any** opencode pane in it is active; a tab only goes **grey** (`#2b2b2b`) when **every** pane in it is idle/parked.
- This fixes split tabs (two projects in one tab): parking one of the two panes no longer turns the whole tab grey while the other is still working.
- It writes the color to every pane of each tab via OSC escape codes, so the tab color is unambiguous regardless of which pane is focused.
- Non-opencode panes (plain shells, `ssh`, `btop`, ...) are left untouched. No session is ever moved.
- Safe to run anytime; re-run after you `/idle` or `/active` a pane to resync the bar.

Report the command output concisely (one line per painted tab: `TEAL`/`GREY` + the ttys).
