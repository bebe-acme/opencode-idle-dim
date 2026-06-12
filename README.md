# opencode-idle-dim

Visually park OpenCode sessions in iTerm2 without closing them.

Run `/idle` inside any OpenCode session and the whole TUI fades to ~15% brightness, exactly like iTerm2's native dimming, while the session title in the sidebar stays readable in bright orange so you always know which project is parked. The iTerm2 tab gets a light color marker too. Run `/active` and everything is restored. The dim is persistent (independent of window focus) and survives until you explicitly restore it.

Built for the workflow of running many OpenCode sessions in parallel in iTerm2 tabs/splits and needing an at-a-glance signal of which ones are idle.

## How it looks

- **Active session:** your normal theme.
- **Idle session:** every UI element dimmed uniformly (including OpenCode's generated whites/grays), session title in the sidebar rendered in `#ff9a00`, iTerm2 tab tinted light.

## Architecture

Three cooperating pieces, no daemons, no signals:

```
/idle (opencode command)
  └─ bin/opencode-iterm-state idle        (bash)
       ├─ finds the parent opencode TTY by walking the process tree
       │  (never targets the frontmost iTerm2 window: that is unsafe)
       ├─ creates a flag file  ~/.local/state/opencode-idle/<tty>.flag
       └─ sends iTerm2 escape codes to tint the tab

plugin/idle-dim.js (OpenCode TUI plugin, runs inside each instance)
  ├─ detects its own TTY (ps -o tty= -p $$)
  ├─ watches the flag dir (fs.watch + 1.5s poll)
  ├─ flag appears  -> saves current theme, switches to "beib-dim"
  ├─ flag removed  -> restores the saved theme
  ├─ self-heals: if it starts already on beib-dim with no flag, goes back to "system"
  └─ registers the sidebar_title slot to keep the session title readable
     (orange while dimmed, normal theme color otherwise)

themes/beib-dim.json (OpenCode theme)
  └─ every theme role multiplied to ~15% brightness;
     background roles set to "none" so the terminal background shows through
```

Why a theme switch instead of remapping terminal colors? OpenCode renders most of its UI in truecolor generated from the terminal background, so ANSI-palette tricks leave panels and whites bright. Switching the OpenCode theme dims **everything** uniformly.

### Key design decisions

- **TTY targeting, not frontmost window.** OpenCode's tool shell has no `/dev/tty`; the script walks up the process tree to find the first ancestor with a real TTY, so `/idle` always hits the session that ran it, even if you are looking at another window.
- **Flag files as IPC.** The bash script and the TUI plugin communicate only through `~/.local/state/opencode-idle/<tty>.flag`. No SIGUSR2 (it aborts in-flight tool calls), no AppleScript color rewriting (iTerm2 blocks `SetProfile` restores and 3-component color lists break round-trips).
- **Never return null from the slot.** OpenCode's `sidebar_title` slot is `single_winner` and decides the fallback at initial render, so the plugin always renders content and only changes the color reactively via a Solid signal.
- **Idempotent + self-healing.** `/idle` twice prints `IDLE_ALREADY`; `/active` is safe without a prior `/idle`; the plugin heals a kv-persisted dim theme on startup.

## Requirements

- macOS with iTerm2 (tab tinting + AppleScript helpers; the dim itself works in any terminal).
- OpenCode >= 1.17 with TUI plugin support (`tui.json` `plugin` array).
- `bash`, `node` available (the plugin runs inside OpenCode's runtime; no node_modules needed: `@opentui/solid` and `solid-js` imports are runtime-remapped by OpenCode).

## Install

```bash
git clone https://github.com/bebe-acme/opencode-idle-dim.git
cd opencode-idle-dim
./install.sh
```

Then **restart every running OpenCode instance once** so the TUI plugin loads. Instances started before the plugin existed will not dim.

What `install.sh` does:

| Source | Destination |
| --- | --- |
| `bin/opencode-iterm-state` | `~/.local/bin/opencode-iterm-state` |
| `plugin/idle-dim.js` | `~/.config/opencode/plugin/idle-dim.js` |
| `themes/beib-dim.json` | `~/.config/opencode/themes/beib-dim.json` |
| `command/idle.md` | `~/.config/opencode/command/idle.md` |
| `command/active.md` | `~/.config/opencode/command/active.md` |
| plugin registration | merged into `~/.config/opencode/tui.json` |

## Usage

Inside any OpenCode session:

- `/idle` — dim this session until restored. Output: `IDLE_SET tty=/dev/ttysNNN ...`
- `/active` — restore. Output: `ACTIVE_RESTORED tty=/dev/ttysNNN ...`

From a plain shell (targets the TTY of the parent process, or set `OPENCODE_ITERM_TTY=/dev/ttysNNN` to override):

```bash
opencode-iterm-state idle      # create flag + tint tab
opencode-iterm-state active    # remove flag + reset tab
opencode-iterm-state locate    # find which iTerm2 window/tab/session owns the TTY
opencode-iterm-state list      # list all iTerm2 sessions with TTYs
opencode-iterm-state pid       # PID of the opencode TUI on this TTY
opencode-iterm-state dump      # dump the session's 23 iTerm2 colors (legacy)
opencode-iterm-state apply     # apply color lines from stdin (legacy)
```

`dump`/`apply` and the in-script color blending helpers are kept from the earlier AppleScript-based dimming approach; they are useful for backing up and repairing iTerm2 session colors but are not part of the dim path anymore.

## Customization

- **Dim strength:** regenerate `themes/beib-dim.json` with a different multiplier (current: 0.15 of each role) and reinstall, or edit roles directly.
- **Title color while dimmed:** `BRIGHT` constant in `plugin/idle-dim.js` (default `#ff9a00`).
- **Tab tint:** brightness values in `send_idle_escape_codes` in `bin/opencode-iterm-state` (default 245, near-white).
- **Dim theme name:** `DIM_THEME` in the plugin + the theme filename must match.

## Troubleshooting

- **`/idle` prints IDLE_SET but nothing dims:** that OpenCode instance started before the plugin was installed. Restart it once.
- **Check the plugin loaded:** `tail ~/.local/state/opencode-idle/debug.log` should show `tui() pid=... tty=...` and `slot sidebar_title registered` lines for each instance.
- **Session stuck dimmed after a crash:** remove the flag manually, `rm ~/.local/state/opencode-idle/ttysNNN.flag`, or run `/active`; the plugin also self-heals to the `system` theme on next start.
- **`ERROR: could not detect opencode parent TTY`:** you ran the script from a context with no TTY ancestor; set `OPENCODE_ITERM_TTY=/dev/ttysNNN` explicitly.
- **Theme got persisted as `beib-dim`:** OpenCode persists theme selection in `~/.local/state/opencode/kv.json`; the plugin heals this automatically, or set `"theme": "system"` there manually.

## Repo layout

```
bin/opencode-iterm-state   bash helper: TTY detection, flag files, iTerm2 tab marker,
                           AppleScript session locate/list/dump/apply utilities
plugin/idle-dim.js         OpenCode TUI plugin: flag watcher, theme switch, sidebar slot
themes/beib-dim.json       the dim theme (~15% brightness, transparent backgrounds)
command/idle.md            /idle command for OpenCode
command/active.md          /active command for OpenCode
tui.json.example           minimal TUI config registering the plugin
install.sh                 copies everything into place and registers the plugin
```

## License

MIT
