# opencode-idle-dim

Visually park OpenCode sessions in iTerm2 without closing them — with a full-screen retro **screensaver**.

Run `/idle` inside any OpenCode session and the whole TUI fades down to ~15% brightness, then a randomly-picked screensaver takes over the screen (a bouncing **ACME alien** DVD-style, or an 8-bit **loading bar**). A persistent identity header (project name + folder) stays on top so you always know which parked session you are looking at. The iTerm2 tab also gets a light color marker. Press **any key**, hit **⌘K → Wake Up**, or run **`/active`** and the screen fades back to your original theme. The dim is persistent (independent of window focus) and survives until you explicitly wake it.

Built for the workflow of running many OpenCode sessions in parallel in iTerm2 tabs/splits and needing an at-a-glance signal of which ones are parked.

## How it looks

- **Active session:** your normal theme. The plugin has zero visual footprint.
- **Entering idle:** a ~1.6s **fade-in** darkens the whole TUI step by step (`system → beib-dim-07 → -05 → -03 → beib-dim`); only once fully dim does the screensaver appear.
- **Idle session:** a full-screen overlay (drawn on top of the app, the prompt stays alive underneath) showing the active screensaver in a single color (your theme's accent), plus:
  - an identity header top-left: `▶ <project name>` + the folder path (grey),
  - a dismiss hint bottom-center: `💤  idle  ·  press any key or ⌘K → Wake Up`.
  - The sidebar also shows a small ACME alien as a guaranteed-visible fallback, and a `💤` sits next to the prompt.
- **Waking up:** any key / ⌘K / `/active` triggers a 4-step brightness **fade-out** (~1.6s) back to your original theme.

## Screensavers

The screensaver system is pluggable. `pickSaver()` chooses one at random on each `/idle`. Two ship today:

- **`alien`** — the **ACME logo** bouncing around the screen DVD-style. The sprite is rasterized directly from the source SVG (`acme-alien-logo.png`) into a 10×7 pixel grid (`ACME_PIXELS`), scaled 2× and drawn with half-block characters so pixels stay square (exact 10:7 aspect, never stretched).
- **`progress`** — a chunky 8-bit loading bar: a bordered frame with 12 segments that fill, hold at 100%, and loop.

Both render in a **single color** captured from the live theme accent *before* dimming (`api.theme.current.primary`), so the screensaver matches your terminal's vibe. The top 3 rows are reserved for the identity header.

### Adding a saver

A saver is an object with this contract:

```js
{ name, stepMs, reset(w, h), tick(w, h), render(w, h, color) -> nodes[] }
```

- `render` returns absolutely-positioned opentui nodes; use the passed `color` (the accent) and keep `y ∈ [3, h)` clear of the header.
- `startSaver()` runs a `setInterval(stepMs)` that calls `tick()` and bumps an animation signal to re-render.
- For sprites, define a pixel grid (`"#"` = filled) and convert with `toHalfBlocks(...)` (square pixels); use `scalePixels(grid, sx, sy)` to enlarge without distorting the aspect ratio. Preview with a small node script before embedding.

Then add it to the `SAVERS` array in `plugin/idle-dim.js`.

## Architecture

No daemons, no signals. Three cooperating pieces talking through a flag file:

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
  ├─ flag appears  -> capture accent, FADE IN to "beib-dim", then show saver
  ├─ flag removed  -> hide overlay, FADE OUT to the saved theme
  ├─ self-heals: if it starts on beib-dim with no flag, returns to "system"
  ├─ renders the screensaver in the `app` slot overlay (NOT a route)
  ├─ keeps the sidebar_title readable (orange while dimmed)
  └─ binds any-key wake on api.renderer.keyInput + a ⌘K "Wake Up" command

themes/beib-dim.json (+ beib-dim-03/05/07.json for the fades)
  └─ every theme role multiplied to ~15% brightness (03/05/07 are the
     intermediate fade steps); background roles set to "none"
```

Why a theme switch instead of remapping terminal colors? OpenCode renders most of its UI in truecolor generated from the terminal background, so ANSI-palette tricks leave panels and whites bright. Switching the OpenCode theme dims **everything** uniformly.

### Key design decisions

- **Overlay via the `app` slot, never `api.route`.** Plugin routes render *without* the prompt, so navigating to a full-screen idle route locks you out of typing `/active` — the session looks dead (this bricked 8 TTYs once; see `REPORTE-2026-06-12-incidente-idle.md`). The `app` slot draws on top while the prompt stays alive underneath. The overlay is footprint-zero (size 0, no background) whenever not dimmed. The test enforces a hard **zero-`api.route`** invariant.
- **Any-key wake via `api.renderer.keyInput`.** `@opentui/solid`'s `useKeyboard()` needs the Solid `RendererContext` and silently no-ops from a slot getter, so it's bound directly on `api.renderer.keyInput.on("keypress", …)` (`api.renderer` is the `CliRenderer`). The listener only wakes while dimmed and never consumes the event, so typing is unaffected.
- **Square pixels via half-blocks.** Terminal cells are ~2:1 (taller than wide), so full-block sprites look stretched. `toHalfBlocks` packs two vertical pixels per character; `scalePixels` enlarges by integer factors. The ACME alien keeps its exact 10:7 aspect.
- **One color, from the theme accent.** `api.theme.current.*` are `RGBA` objects (they only stringify as `rgba(0.32,…)` when logged); the accent is captured before dimming and passed to every saver.
- **TTY targeting, not frontmost window.** OpenCode's tool shell has no `/dev/tty`; the script walks up the process tree to find the first ancestor with a real TTY, so `/idle` always hits the session that ran it.
- **Flag files as IPC.** No SIGUSR2 (it aborts in-flight tool calls), no AppleScript color rewriting (iTerm2 blocks `SetProfile` restores and 3-component color lists break round-trips).
- **Never return null from `sidebar_title`.** It is `single_winner` and decides its fallback at initial render; the plugin always renders content and only changes color reactively via a Solid signal.
- **Idempotent + self-healing.** `/idle` twice prints `IDLE_ALREADY`; `/active` is safe without a prior `/idle`; the plugin heals a kv-persisted dim theme on startup.

## Requirements

- macOS with iTerm2 (tab tinting + AppleScript helpers; the dim + screensaver themselves work in any terminal).
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
| `themes/beib-dim-03/05/07.json` | `~/.config/opencode/themes/` (fade steps) |
| `command/idle.md` | `~/.config/opencode/command/idle.md` |
| `command/active.md` | `~/.config/opencode/command/active.md` |
| plugin registration | merged into `~/.config/opencode/tui.json` |

To apply a repo edit later: re-run `./install.sh` (or `cp -f plugin/idle-dim.js ~/.config/opencode/plugin/idle-dim.js`) and **restart OpenCode**.

## Usage

Inside any OpenCode session:

- `/idle` — dim this session and start a screensaver. Output: `IDLE_SET tty=/dev/ttysNNN ...`
- `/active` — restore. Output: `ACTIVE_RESTORED tty=/dev/ttysNNN ...`
- **Wake** while idle: press any key, hit `⌘K → Wake Up (exit idle)`, or run `/active`.

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

`dump`/`apply` and the in-script color blending helpers are kept from the earlier AppleScript-based dimming approach; they are useful for backing up/repairing iTerm2 session colors but are not part of the dim path anymore.

## Customization

- **Savers:** edit the `SAVERS` array in `plugin/idle-dim.js` (add/remove savers, or pin a single one).
- **Sprite:** `ACME_PIXELS` is the source pixel grid; the scale factor is `scalePixels(ACME_PIXELS, 2, 2)`.
- **Accent color:** captured from the theme; the `BRIGHT` constant (`#ff9a00`) is the fallback and the dimmed sidebar title color.
- **Fade:** `FADE_IN_THEMES` / `FADE_THEMES` (order) and `FADE_STEP_MS` (default 400ms per step).
- **Dim strength:** regenerate `themes/beib-dim.json` with a different multiplier (current ~0.15 of each role) and reinstall.
- **Tab tint:** brightness values in `send_idle_escape_codes` in `bin/opencode-iterm-state` (default 245, near-white).
- **Dim theme name:** `DIM_THEME` in the plugin must match the theme filename.
- **Overrides:** `OPENCODE_IDLE_DIR` (flag/log dir) and `OPENCODE_IDLE_TTY` / `OPENCODE_ITERM_TTY` (force a TTY).

## Troubleshooting

- **`/idle` prints IDLE_SET but nothing dims:** that OpenCode instance started before the plugin was installed (or before your last edit). Restart it once.
- **Check what happened:** `tail ~/.local/state/opencode-idle/debug.log` shows per-instance lines like `tui() pid=… tty=…`, `slot app (screensaver) registered`, `keypress handler bound (api.renderer.keyInput)`, `fade-in: step …`, `saver: picked <name>`, and any errors.
- **Any-key wake doesn't work:** confirm `keypress handler bound` is in the log; if missing, the renderer wasn't ready — it rebinds on the next render. `/active` and ⌘K always work.
- **Session stuck dimmed after a crash:** `rm ~/.local/state/opencode-idle/ttysNNN.flag` or run `/active`; the plugin also self-heals to `system` on next start.
- **`ERROR: could not detect opencode parent TTY`:** you ran the script from a context with no TTY ancestor; set `OPENCODE_ITERM_TTY=/dev/ttysNNN` explicitly.
- **Theme got persisted as `beib-dim`:** OpenCode persists theme selection in `~/.local/state/opencode/kv.json`; the plugin heals this automatically, or set `"theme": "system"` there manually.

## Repo layout

```
bin/opencode-iterm-state   bash helper: TTY detection, flag files, iTerm2 tab marker,
                           AppleScript session locate/list/dump/apply utilities
plugin/idle-dim.js         OpenCode TUI plugin: flag watcher, fade in/out, screensavers,
                           app-slot overlay, identity header, any-key + ⌘K wake
themes/beib-dim.json       the dim theme (~15% brightness, transparent backgrounds)
themes/beib-dim-03/05/07   intermediate fade steps
command/idle.md            /idle command for OpenCode
command/active.md          /active command for OpenCode
acme-alien-logo.png        source ACME logo the alien sprite is rasterized from
tui.json.example           minimal TUI config registering the plugin
install.sh                 copies everything into place and registers the plugin
test/                      node:test suite with stubs for OpenCode's runtime imports
handoff.md                 maintainer handoff notes (current state, traps, history)
```

## Tests

```bash
node --import ./test/register.mjs --test test/idle-dim.test.mjs
```

No dependencies needed: a loader hook resolves `@opentui/solid` and `solid-js` to local stubs. The suite drives the full flag lifecycle against a mocked OpenCode API — asserting the fade-in order (`-07 → -05 → -03 → beib-dim`), the wake fade order, dim/restore, sidebar content — and enforces the invariant that the plugin never touches `api.route` (plugin routes render without the prompt, so navigating to one locks you out of `/active`).

## License

MIT
