---
description: Dim this opencode iTerm2 session until /active restores it
---

# Dim this OpenCode session (persistent idle)

Run this exact command with Bash:

```bash
~/.local/bin/opencode-iterm-state idle
```

How it works:
- The script finds the TTY of the parent `opencode` process (never the frontmost iTerm2 window) and creates a flag file in `~/.local/state/opencode-idle/<tty>.flag`.
- The `idle-dim` TUI plugin in this opencode instance detects the flag within ~2s, fades the theme down to `beib-dim` (everything ~85% darker, uniform dim), and shows a full-screen screensaver (a bouncing ACME alien or an 8-bit loading bar) with the project name/folder on top. The dim persists regardless of focus until woken.
- Wake with any key, `⌘K → Wake Up`, or `/active` (fades back to your theme).
- It also marks the iTerm2 tab with a light color so it is identifiable in the tab bar.
- Running it twice is safe (prints IDLE_ALREADY).
- If the dim does not appear, this opencode instance probably started before the plugin was installed; a restart of opencode is needed once.

Report the command output concisely.
