# opencode-idle-dim

Visually park OpenCode sessions in iTerm2 without closing them — a **cheap, ~0% CPU** dim + tab tint.

Run `/idle` inside any OpenCode session and the whole TUI instantly switches to the dark `beib-dim` theme (~15% brightness, uniform) and the iTerm2 **tab is tinted grey**. The sidebar title turns orange and a `💤` sits next to the prompt, so a parked session is obvious at a glance. Run **`/active`** (or **⌘K → Wake Up**) to restore your theme and a teal tab. The dim is persistent (independent of window focus) and survives until you explicitly wake it — and while parked it runs **no timers and no animation**, so it costs essentially nothing.

Built for the workflow of running many OpenCode sessions in parallel in iTerm2 tabs/splits and needing an at-a-glance signal of which ones are parked — without those parked sessions heating up the machine.

> **History:** earlier versions drew a full-screen animated screensaver (a bouncing ACME alien / 8-bit loading bar) on each `/idle`. With ~a dozen parked sessions that animation kept every OpenCode instance — plus iTerm2 and WindowServer — busy redrawing and contributed real heat, so it was removed in favor of this static, zero-cost dim. See `handoff.md` for the full story.

## How it looks

- **Active session:** your normal theme + a teal iTerm2 tab. The plugin has zero visual footprint.
- **Idle session (after `/idle`):**
  - the whole TUI is dimmed to the `beib-dim` theme (one instant switch, no fade),
  - the iTerm2 tab background goes muted grey,
  - the sidebar session title turns orange,
  - a `💤` appears next to the prompt.
- **Waking up (`/active` or ⌘K → Wake Up):** the saved theme is restored instantly and the tab goes back to teal. The prompt is alive the whole time, so you can also just keep typing in a dimmed session.

## Architecture

No daemons, no signals, no animation. Two cooperating pieces talking through a flag file:

```
/idle (opencode command)
  └─ bin/opencode-iterm-state idle        (bash)
       ├─ finds the parent opencode TTY by walking the process tree
       │  (never targets the frontmost iTerm2 window: that is unsafe)
       ├─ creates a flag file  ~/.local/state/opencode-idle/<tty>.flag
       └─ clears the iTerm2 tab badge (tab *color* is owned by the plugin)

plugin/idle-dim.js (OpenCode TUI plugin, runs inside each instance)
  ├─ detects its own TTY (ps -o tty= -p $$)
  ├─ watches the flag dir (fs.watch + a slow 5s poll fallback)
  ├─ flag appears  -> save current theme, set "beib-dim", tint tab grey
  ├─ flag removed  -> restore the saved theme, tint tab teal
  ├─ self-heals: if it starts on beib-dim with no flag, returns to "system"
  ├─ keeps the sidebar_title readable (orange while dimmed) + a 💤 by the prompt
  └─ registers a ⌘K "Wake Up" command (runs /active). Never touches api.route.

themes/beib-dim.json
  └─ every theme role multiplied to ~15% brightness; background roles set to "none"
```

Why a theme switch instead of remapping terminal colors? OpenCode renders most of its UI in truecolor generated from the terminal background, so ANSI-palette tricks leave panels and whites bright. Switching the OpenCode theme dims **everything** uniformly.

### Key design decisions

- **Static dim, not a screensaver.** Entering/leaving idle is a single `api.theme.set(...)` plus one OSC tab write. No `setInterval`, no per-frame re-render, no overlay — a parked session has no running work, which is the whole point (see history above).
- **Never touch `api.route`.** Plugin routes render *without* the prompt, so navigating to a full-screen idle route locks you out of typing `/active` — the session looks dead (this bricked 8 TTYs once; see `REPORTE-2026-06-12-incidente-idle.md`). The dim indicator lives in sidebar/prompt slots only. The test enforces a hard **zero-`api.route`** invariant.
- **Tab color owned by the plugin, not the bash helper.** The plugin runs in every session and knows the live state, so it paints the tab (OSC 6 to the TTY) on every transition — active sessions get the teal accent, parked ones go grey. The bash helper no longer sets tab background (only clears the badge), which avoids two writers fighting and means even never-idled sessions get the active color automatically.
- **TTY targeting, not frontmost window.** OpenCode's tool shell has no `/dev/tty`; the script walks up the process tree to find the first ancestor with a real TTY, so `/idle` always hits the session that ran it.
- **Flag files as IPC.** No SIGUSR2 (it aborts in-flight tool calls), no AppleScript color rewriting (iTerm2 blocks `SetProfile` restores and 3-component color lists break round-trips).
- **Never return null from `sidebar_title`.** It is `single_winner` and decides its fallback at initial render; the plugin always renders content and only changes color reactively via a Solid signal.
- **Idempotent + self-healing.** `/idle` twice prints `IDLE_ALREADY`; `/active` is safe without a prior `/idle`; the plugin heals a kv-persisted dim theme on startup.

## Requirements

- macOS with iTerm2 (tab tinting + AppleScript helpers; the theme dim itself works in any terminal).
- OpenCode >= 1.17 with TUI plugin support (`tui.json` `plugin` array).
- `bash`, `node` available (the plugin runs inside OpenCode's runtime; no node_modules needed: `@opentui/solid` and `solid-js` imports are remapped by OpenCode).

## Install

```bash
git clone https://github.com/bebe-acme/opencode-idle-dim.git
cd opencode-idle-dim
./install.sh
```

Then **restart every running OpenCode instance once** so the TUI plugin loads (the plugin is read at startup; an old instance keeps the old plugin in memory). Instances started before the plugin existed will not dim.

What `install.sh` does:

| Source | Destination |
| --- | --- |
| `bin/opencode-iterm-state` | `~/.local/bin/opencode-iterm-state` |
| `plugin/idle-dim.js` | `~/.config/opencode/plugin/idle-dim.js` |
| `themes/beib-dim.json` | `~/.config/opencode/themes/beib-dim.json` |
| `themes/beib-dim-03/05/07.json` | `~/.config/opencode/themes/` (currently unused — see note) |
| `command/idle.md` | `~/.config/opencode/command/idle.md` |
| `command/active.md` | `~/.config/opencode/command/active.md` |
| `command/tabs-color.md` | `~/.config/opencode/command/tabs-color.md` |
| `command/tabs-name.md` | `~/.config/opencode/command/tabs-name.md` |
| `tab-aliases.conf.example` | `~/.config/opencode/tab-aliases.conf` (only if absent) |
| plugin registration | merged into `~/.config/opencode/tui.json` |

> The `beib-dim-03/05/07.json` themes were the intermediate steps of the old wake/enter fade. The fade was removed, so they are currently unused — kept only for manual experiments or a future opt-in fade.

To apply a repo edit later: re-run `./install.sh` (or `cp -f plugin/idle-dim.js ~/.config/opencode/plugin/idle-dim.js`) and **restart OpenCode**.

## Usage

Inside any OpenCode session:

- `/idle` — dim this session instantly + grey tab. Output: `IDLE_SET tty=/dev/ttysNNN ...`
- `/active` — restore the theme + teal tab. Output: `ACTIVE_RESTORED tty=/dev/ttysNNN ...`
- **Wake** while idle: run `/active` or hit `⌘K → Wake Up (exit idle)` (the prompt also stays usable while dimmed).

Tab-bar coordination (operate on **all** iTerm2 tabs at once, not just the current one — handy when you run two projects per tab as splits):

- `/tabs-color` — recolor every tab by state: teal if **any** pane is active, grey only when **every** pane is idle. Fixes split tabs where parking one of two panes shouldn't grey the whole tab.
- `/tabs-name` — name every tab after its project folder(s), e.g. `DIMM:FINANCES` (both panes of a split get the combined name). Short labels come from `~/.config/opencode/tab-aliases.conf` (otherwise the folder basename). Applied via AppleScript, so it updates manually-named (locked) sessions too.

From a plain shell (targets the TTY of the parent process, or set `OPENCODE_ITERM_TTY=/dev/ttysNNN` to override):

```bash
opencode-iterm-state idle      # create flag (plugin then dims + tints tab grey)
opencode-iterm-state active    # remove flag (plugin then restores + tints tab teal)
opencode-iterm-state locate    # find which iTerm2 window/tab/session owns the TTY
opencode-iterm-state list      # list all iTerm2 sessions with TTYs
opencode-iterm-state tabs-color # recolor every tab by idle/active state (teal/grey)
opencode-iterm-state tabs-name  # name every tab after its project folder(s)
opencode-iterm-state pid       # PID of the opencode TUI on this TTY
opencode-iterm-state dump      # dump the session's 23 iTerm2 colors (legacy)
opencode-iterm-state apply     # apply color lines from stdin (legacy)
```

`dump`/`apply` and the in-script color blending helpers are kept from the earlier AppleScript-based dimming approach; they are useful for backing up/repairing iTerm2 session colors but are not part of the dim path anymore.

## Customization

- **Dim strength:** regenerate `themes/beib-dim.json` with a different multiplier (current ~0.15 of each role) and reinstall.
- **Tab tint:** `TAB_ACTIVE` / `TAB_IDLE` RGB constants in `plugin/idle-dim.js` (defaults: teal `#529e99` active, grey `#2b2b2b` idle). The plugin writes OSC 6 to the session's TTY on each state change.
- **Dimmed title color:** the `BRIGHT` constant (`#ff9a00`) — the orange sidebar title + the `💤` prompt indicator while parked.
- **Dim theme name:** `DIM_THEME` in the plugin must match the theme filename.
- **Poll interval:** the plugin reacts to flag changes immediately via `fs.watch`; the `setInterval(apply, 5000)` is only a slow self-heal fallback.
- **Overrides:** `OPENCODE_IDLE_DIR` (flag/log dir) and `OPENCODE_IDLE_TTY` / `OPENCODE_ITERM_TTY` (force a TTY).

## Troubleshooting

- **`/idle` prints IDLE_SET but nothing dims:** that OpenCode instance started before the plugin was installed (or before your last edit). Restart it once.
- **Check what happened:** `tail ~/.local/state/opencode-idle/debug.log` shows per-instance lines like `tui() pid=… tty=…`, `slot sidebar_title registered`, `tab: painted idle (43,43,43)`, `apply: dim on saved=…`, `apply: restored to …`, and any errors.
- **Session stuck dimmed after a crash:** `rm ~/.local/state/opencode-idle/ttysNNN.flag` or run `/active`; the plugin also self-heals to `system` on next start.
- **`ERROR: could not detect opencode parent TTY`:** you ran the script from a context with no TTY ancestor; set `OPENCODE_ITERM_TTY=/dev/ttysNNN` explicitly.
- **Theme got persisted as `beib-dim`:** OpenCode persists theme selection in `~/.local/state/opencode/kv.json`; the plugin heals this automatically, or set `"theme": "system"` there manually.

## Repo layout

```
bin/opencode-iterm-state   bash helper: TTY detection, flag files, iTerm2 badge clear,
                           per-tab color + name coordination (tabs-color/tabs-name),
                           AppleScript session locate/list/dump/apply utilities
plugin/idle-dim.js         OpenCode TUI plugin: flag watcher, instant theme dim/restore,
                           iTerm tab tint, orange title + 💤 prompt indicator, ⌘K wake
themes/beib-dim.json       the dim theme (~15% brightness, transparent backgrounds)
themes/beib-dim-03/05/07   old fade steps (currently unused; kept for manual use)
command/idle.md            /idle command for OpenCode
command/active.md          /active command for OpenCode
command/tabs-color.md      /tabs-color command (recolor all tabs by state)
command/tabs-name.md       /tabs-name command (name all tabs after their projects)
tab-aliases.conf.example   sample alias map for /tabs-name short labels
acme-alien-logo.png        ACME logo (historical screensaver sprite source; unused now)
tui.json.example           minimal TUI config registering the plugin
install.sh                 copies everything into place and registers the plugin
test/                      node:test suite with stubs for OpenCode's runtime imports
handoff.md                 maintainer handoff notes (current state, traps, history)
```

## Tests

```bash
node --import ./test/register.mjs --test test/idle-dim.test.mjs
```

No dependencies needed: a loader hook resolves `@opentui/solid` and `solid-js` to local stubs. The suite drives the full flag lifecycle against a mocked OpenCode API — asserting an instant dim to `beib-dim` and an instant restore (no fade steps), the orange dimmed title and `💤` prompt indicator — and enforces the invariant that the plugin never touches `api.route` (plugin routes render without the prompt, so navigating to one locks you out of `/active`).

## License

MIT
