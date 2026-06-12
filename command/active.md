---
description: Restore this opencode iTerm2 session from idle dim
---

# Restore this OpenCode session (active)

Run this exact command with Bash:

```bash
~/.local/bin/opencode-iterm-state active
```

How it works:
- The script finds the TTY of the parent `opencode` process and removes the idle flag file for it.
- The `idle-dim` TUI plugin detects the flag removal within ~2s and restores the previous theme.
- It also resets the iTerm2 tab color marker.
- Safe to run even if the session was never idled.

Report the command output concisely.
