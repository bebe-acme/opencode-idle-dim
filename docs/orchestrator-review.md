# Orchestrator / active-idle indicator review

_Last updated: 2026-06-19._

## Why this doc

`opencode-idle-dim` gives you a **manual** at-a-glance signal: you run `/idle` to grey a parked
tab, `/active` to bring it back, and `/tabs-color` to repaint the bar. That works, but it is
hand-driven, and the ask was explicitly: _"me da fiaca seguir customizando iTerm2 a mano"_ — you
want an **automatic** at-a-glance view of which OpenCode sessions are **working vs idle vs waiting
for input**, and a way to **jump to** the one that needs you, without hand-tuning iTerm2.

This surveys what exists (2026-06) so we can pick a direction instead of building blind. It is a
research note, not a commitment.

### What "fits" means here

Your setup: many OpenCode sessions in **iTerm2 tabs/splits** (often two projects per tab), terminal-first.
So the axes that matter:

- **OpenCode support** — does it understand OpenCode (not just Claude Code)?
- **Observe vs host** — does it *watch your existing iTerm2 sessions*, or does it *spawn/host* the
  agents in its own UI (a workflow change)?
- **Status detection** — how does it know working/idle/waiting? (events vs OTEL vs DB vs file mtime)
- **Jump-to-session**, **macOS**, **resource cost**, **setup effort**, **mobile**, **maturity**.

## TL;DR recommendation

1. **Lowest effort, purpose-built:** try **`@actualyze/opencode-monitor`** (`npx @actualyze/opencode-monitor`).
   A terminal dashboard built *for* OpenCode: live status (idle / busy / retry / waiting-for-permission /
   completed / error), desktop notifications when a session finishes or needs approval, token/cost, and
   **press a key to attach** to any session. Cost: it needs OpenCode's **HTTP server** enabled (now off by
   default) for attach/browser.
2. **Best fit for your exact setup (and reuses what we built):** a tiny **OpenCode event-hook plugin** that
   listens to `session.idle` / `session.status` / `permission.asked` and writes the per-TTY flag we already
   have — so **tabs auto-tint by real activity** (teal=working, grey=idle, a third color=waiting) with
   **zero manual `/idle`**. This is the natural evolution of this repo and keeps your iTerm2-tab workflow
   untouched. Small build; foundation already exists.
3. **Most polished / mobile, if you'll change workflow:** **clideck** — one window for all agents
   (OpenCode/Claude/Codex/Gemini), live status via OpenTelemetry, session resume, autopilot, **E2E mobile
   relay**. Caveat: it *hosts* the agents in its own UI rather than watching your iTerm2 tabs.

If you just want a number/heat read without changing anything: the OpenCode **OTEL** plugins +
Grafana give you dashboards (overkill for "who needs me", great for usage analytics).

## How OpenCode status can be observed (the foundation)

Every tool below picks one of three mechanisms. Knowing them tells you the trade-offs:

| Mechanism | How | Latency | Server needed? | Notes |
|---|---|---|---|---|
| **Native plugin events** | A plugin `event` hook receives `session.idle`, `session.status`, `session.created`, `permission.asked`, `permission.replied`, `tool.execute.before/after` | Real-time | No | Lightest, exact. Plugins live in `~/.config/opencode/plugins/` (disabled if `OPENCODE_PURE=1`). |
| **OpenTelemetry (OTLP)** | `experimental.openTelemetry: true` + `OTEL_EXPORTER_OTLP_ENDPOINT`; emits session/tool/token/cost/retry signals (incl. `session.status`, session-duration-to-idle) | Seconds (export interval) | A collector | Standard, rich metrics; good for dashboards. Community plugins add Claude-Code-shaped metrics. |
| **SQLite DB / HTTP server** | Read `~/.local/share/opencode/opencode.db`, or talk to `opencode serve`'s HTTP API / SDK `session.list` | Poll / WebSocket | DB: no · attach: yes | Jump-to-session needs the HTTP server (now **off by default**). |
| **File mtime (crude)** | Watch `~/.local/state/opencode/` modification times | ~minutes | No | Zero-dep but approximate (working/waiting/idle by age). |

The important takeaway: **status is observable today** — natively via events, which means the
"auto-tint tabs by real activity" idea (recommendation #2) is buildable without any server.

## Candidates

### Purpose-built OpenCode monitors (observe, terminal-first) — best fit

- **`@actualyze/opencode-monitor`** (npm). TUI fleet dashboard for OpenCode across machines. States:
  idle / busy / retry / waiting_for_permission / completed / error. Desktop notifications on finish/approval.
  Token & cost tracking, subagent tree, multi-server. **`t` to attach**, **`b` to open in browser**.
  Requires OpenCode **server mode** (attach/browser need the HTTP server, which now defaults off).
  → Closest off-the-shelf match to "see who's working/waiting and jump in."
- **`kareemaly/agentstatus`** (Go library). Subscribes to native hooks across Claude/Codex/OpenCode and
  emits a unified typed stream: `starting → working → idle`, plus `awaiting_input` / `error`. OpenCode
  support ships as a TypeScript plugin auto-installed to `~/.config/opencode/plugins/`. Tool visibility +
  subagent attribution. → The **best building block for a DIY indicator** (and it's Go, like your `cool`).
- **`janzofx/vscode-extension-opencode-claude-code-monitor`**. Read-only VS Code dashboard reading
  `opencode.db`: active / idle / completed, file-activity timeline, delegation feed. → Only if you live in
  VS Code (you mostly don't).
- **`willin/agent-status-monitor`**. Shell scripts that classify Working/Waiting/Idle by session-file mtime
  in `~/.local/state/opencode/`. → Zero-dep, crude; fine as a cron/status-line one-liner, not a fleet view.

### Multi-agent orchestrators (tend to *host* agents, not watch your tabs)

- **clideck** (`rustykuntz/clideck`). Local app, one browser window for OpenCode/Claude/Codex/Gemini/Pi.
  Live status via **OpenTelemetry** (working/idle/waiting), chat sidebar, message previews, session resume,
  projects, an autopilot that routes work between agents, and an **E2E-encrypted mobile relay**. Most
  polished + only one here with real mobile. Caveat: you'd run agents *inside clideck*, not in raw iTerm2
  tabs.
- **OpenCode OTEL plugins** (`@devtheops/opencode-plugin-otel`, `felixti/opencode-otel-plugin`) + Grafana/
  Datadog/Honeycomb. Rich metrics (tokens, cost, tool duration, retries, session-to-idle). → Analytics
  dashboards, not a "who needs me now" glance. Pair with native OTEL (`experimental.openTelemetry`).
- **Argus / code-orchestrator, VibeManager, vibe-kanban.** PTY-spawn or tmux/web-host arbitrary CLIs
  (incl. OpenCode); status by tailing ANSI output or task board. All *host/spawn* sessions → a workflow
  change from your iTerm2 tabs. Useful if you ever want a kanban/web cockpit; not aligned with "leave my
  tabs alone."

### Terminal-multiplexer indicators

- **`tmux-agent-indicator`** ships an **OpenCode plugin** (uses `session.status` / `session.idle` /
  `permission.*`) that paints per-pane/window/status-bar icons. Lightest, keeps the terminal workflow —
  **but requires tmux**. You use iTerm2 native tabs/splits, so this means adopting tmux (a real change).
- **Zellij** plugins (`zellaude`, `zellij-attention`, `claude-code-zellij-status`) are Claude-hook driven and
  don't see OpenCode. Skip.

### Claude-Code-only (won't see OpenCode — listed so we don't chase them)

`yksanjo/conductor`, `xtalax/agent-conductor`, `bjornjee/agent-dashboard` read `~/.claude` transcripts. Not
applicable.

### DIY using what you already have

- **`cool`** (your Go TUI) already reads the OpenCode session DB. Adding an active/idle column + a
  jump action would give a native fleet view with no new dependency — optionally fed by
  `kareemaly/agentstatus` for precise real-time status instead of DB polling.
- **Extend this repo** (recommendation #2): an event-hook plugin → flag file → existing
  `opencode-iterm-state` tab tint.

## Comparison

| Tool | OpenCode | Observe vs host | Status method | Jump | macOS | Cost | Setup | Mobile | Maturity |
|---|---|---|---|---|---|---|---|---|---|
| `@actualyze/opencode-monitor` | ✅ native | observe | DB + HTTP/WebSocket | ✅ `t`/`b` | ✅ | low | med (needs server) | ❌ | growing |
| event-plugin → tab tint (DIY #2) | ✅ native | observe | plugin events | via iTerm | ✅ | ~0 | low–med (build) | ❌ | n/a (ours) |
| clideck | ✅ | **host** | OpenTelemetry | in-app | ✅ | low–med | low | ✅ E2E | active |
| `kareemaly/agentstatus` (lib) | ✅ | observe | native hooks | build it | ✅ | ~0 | med (it's a lib) | ❌ | new |
| OTEL plugin + Grafana | ✅ | observe | OTLP metrics | ❌ | ✅ | med | high | via Grafana | mature stack |
| VS Code monitor ext | ✅ | observe | `opencode.db` | open in VSC | ✅ | low | low | ❌ | new |
| `tmux-agent-indicator` | ✅ plugin | observe | plugin events | tmux | ✅ | ~0 | med (needs tmux) | ❌ | niche |
| Argus / VibeManager / vibe-kanban | ✅ | **host** | PTY tail / board | in-app | ✅ | med | med–high | some web | varied |

## Recommendation, tuned to your setup

You want **automatic** active/idle/waiting at a glance + jump, **without** babysitting iTerm2, and you
**don't** want to abandon your iTerm2 tabs. So:

- **Quickest win, today:** `npx @actualyze/opencode-monitor`, turn on OpenCode server mode. If its fleet
  view + notifications + attach feel right, you're done — no building.
- **The "right" long-term fit (and it makes this repo self-driving):** build the small **event-hook plugin**
  that flips the flag on `session.idle` / `session.status` (and a distinct color on `permission.asked`).
  Tabs then reflect **real** activity automatically — `/idle` becomes optional, the manual customization
  disappears, and we reuse `opencode-iterm-state`'s tab tint untouched. Use `kareemaly/agentstatus` if you'd
  rather not hand-roll the event normalization.
- **If you'd enjoy a phone view** and don't mind running agents inside it: **clideck**.

> Implementation note for the DIY path: the idle-dim plugin is a **TUI plugin** (`tui.json`,
> `export default { id, tui(api) }`), which is a *different shape* from a standard **event-hook plugin**
> (`export const X = async (ctx) => ({ event: async ({ event }) => {…} })`, loaded from
> `~/.config/opencode/plugins/`). Before building, verify whether the TUI `api` exposes an event
> subscription, or whether the auto-tint logic should live in a separate companion event-hook plugin that
> just writes the flag files this plugin/`opencode-iterm-state` already consume.

## Sources

- clideck — github.com/rustykuntz/clideck
- `@actualyze/opencode-monitor` — npmjs.com/package/@actualyze/opencode-monitor
- `kareemaly/agentstatus` — github.com/kareemaly/agentstatus
- `willin/agent-status-monitor` — github.com/willin/agent-status-monitor
- VS Code monitor — github.com/janzofx/vscode-extension-opencode-claude-code-monitor
- OpenCode OTEL: anomalyco/opencode #5245, #14246, #14697; `@devtheops/opencode-plugin-otel`; `felixti/opencode-otel-plugin`
- OpenCode plugin events — opencode.ai/docs/plugins
