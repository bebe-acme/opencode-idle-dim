// idle-dim: dims THIS opencode instance by switching to the "beib-dim" theme
// while a per-TTY flag file exists, and tints its iTerm2 tab grey. /idle creates
// the flag, /active removes it. No signals storms, no animation, no overlay:
// pure theme switching + a one-shot OSC tab tint, so a PARKED SESSION COSTS ~0%
// CPU (this replaced an animated screensaver that kept ~11 dimmed sessions —
// plus iTerm2/WindowServer — busy redrawing; see handoff.md history).
//
// Why a theme switch (not ANSI/iTerm palette tricks): opencode renders most of
// its UI in truecolor derived from the terminal background, so palette tweaks
// leave whites/panels bright. Switching the opencode theme dims everything
// uniformly.
//
// This plugin must NEVER touch api.route: a plugin route renders WITHOUT the
// prompt, so you couldn't type /active and the session would look frozen (see
// handoff.md, trap 7). It only switches the theme, tints the tab, and renders
// two tiny static indicators. Wake with /active or ⌘K → Wake Up; while dimmed
// the prompt stays fully alive, so you can also just keep typing.
import * as otui from "@opentui/solid"
import { watch, existsSync, mkdirSync, appendFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { homedir } from "node:os"
import { createSignal } from "solid-js"

const { createElement, spread } = otui

const DIM_THEME = "beib-dim"
const BRIGHT = "#ff9a00" // accent for the dimmed sidebar title + prompt indicator
// iTerm2 tab background tint per state (written via OSC 6 in paintTab):
// active sessions get the teal accent, parked (idle) ones go muted dark grey.
const TAB_ACTIVE = [82, 158, 153] // #529e99
const TAB_IDLE = [43, 43, 43] // #2b2b2b
const DIR = process.env.OPENCODE_IDLE_DIR || `${homedir()}/.local/state/opencode-idle`

// Build opentui nodes without JSX.
function el(type, props) {
  const node = createElement(type)
  spread(node, props ?? {})
  return node
}

const tui = async (api) => {
  try {
    mkdirSync(DIR, { recursive: true })
  } catch {}

  let tty = process.env.OPENCODE_IDLE_TTY || ""
  if (!tty) {
    try {
      tty = execSync(`ps -o tty= -p ${process.pid}`, { encoding: "utf8" }).trim()
    } catch {}
  }

  const log = (msg) => {
    try {
      appendFileSync(`${DIR}/debug.log`, `${new Date().toISOString()} ${msg}\n`)
    } catch {}
  }
  log(`tui() pid=${process.pid} tty=${tty || "none"} themeReady=${api?.theme?.ready}`)

  if (!tty || tty === "??") return {}
  const flag = `${DIR}/${tty}.flag`
  let saved = null
  const [isDim, setDim] = createSignal(false)

  const wakeUp = () => {
    try {
      execSync(`${homedir()}/.local/bin/opencode-iterm-state active`, { encoding: "utf8", timeout: 5000 })
      log("wake: executed")
    } catch (e) {
      log(`wake: error ${e?.message || e}`)
    }
  }

  // Tint THIS session's iTerm2 tab by state: active = teal, idle = grey. Writes
  // OSC 6 (per-channel tab bg) straight to the TTY device, driven by the plugin
  // so every session (even never-idled ones) gets the right color. Only writes
  // on a real state change to avoid spamming the terminal.
  const ttyPath = tty ? `/dev/${tty}` : ""
  let lastTabState = null
  const paintTab = (state) => {
    if (!ttyPath || state === lastTabState) return
    const [r, g, b] = state === "idle" ? TAB_IDLE : TAB_ACTIVE
    try {
      appendFileSync(
        ttyPath,
        `\u001b]6;1;bg;red;brightness;${r}\u0007` +
          `\u001b]6;1;bg;green;brightness;${g}\u0007` +
          `\u001b]6;1;bg;blue;brightness;${b}\u0007`,
      )
      lastTabState = state
      log(`tab: painted ${state} (${r},${g},${b})`)
    } catch (e) {
      log(`tab paint error ${e?.message || e}`)
    }
  }

  // State machine, driven by the flag. Instant theme switch (no fades), so it is
  // cheap and has no running timers while parked.
  const apply = () => {
    try {
      const idle = existsSync(flag)
      paintTab(idle ? "idle" : "active")
      if (!api.theme.ready) {
        log("apply: theme not ready")
        return
      }
      if (idle && saved === null) {
        // ENTER idle: remember the current theme, switch to the dim theme.
        if (!api.theme.has(DIM_THEME)) {
          log(`apply: theme ${DIM_THEME} not found; selected=${api.theme.selected}`)
          return
        }
        const current = api.theme.selected
        saved = current && current !== DIM_THEME ? current : "system"
        const ok = api.theme.set(DIM_THEME)
        setDim(true)
        log(`apply: dim on saved=${saved} ok=${ok}`)
      } else if (!idle && saved !== null) {
        // EXIT idle: restore the saved theme.
        const target = saved
        const ok = api.theme.set(target)
        saved = null
        setDim(false)
        log(`apply: restored to ${target} ok=${ok}`)
      } else if (!idle && api.theme.selected === DIM_THEME) {
        // Self-heal: dim theme persisted with no flag (e.g. crash mid-idle).
        setDim(false)
        const ok = api.theme.set("system")
        log(`apply: heal ok=${ok} (selected was ${DIM_THEME} without flag)`)
      }
    } catch (e) {
      log(`apply: error ${e?.message || e}`)
    }
  }

  // Keep the sidebar session title readable while dimmed (orange) and capture
  // nothing else. Never return null (the slot is single_winner).
  try {
    api.slots.register({
      slots: {
        sidebar_title(ctx, props) {
          const children = [
            el("text", {
              get fg() {
                return isDim() ? BRIGHT : ctx.theme.current.text
              },
              children: props.title,
            }),
          ]
          if (props.share_url) {
            children.push(
              el("text", {
                get fg() {
                  return ctx.theme.current.textMuted
                },
                children: props.share_url,
              }),
            )
          }
          return el("box", { paddingRight: 1, children })
        },
      },
    })
    log("slot sidebar_title registered")
  } catch (e) {
    log(`slot register error ${e?.message || e}`)
  }

  // Subtle "parked" indicator next to the prompt, visible even when the sidebar
  // is hidden. Static (just shows/hides a 💤), so it costs nothing while parked.
  try {
    api.slots.register({
      slots: {
        session_prompt_right() {
          return el("text", {
            fg: BRIGHT,
            get children() {
              return isDim() ? "💤" : ""
            },
          })
        },
      },
    })
    log("slot session_prompt_right registered")
  } catch (e) {
    log(`session_prompt_right slot error ${e?.message || e}`)
  }

  // One-click deactivation: a "Wake Up" command in the palette (⌘K).
  try {
    api.command.register(() => [
      {
        title: "Wake Up (exit idle)",
        value: "idle-dim:wake",
        group: "Session",
        onSelect: () => wakeUp(),
      },
    ])
    log("command palette wake registered")
  } catch (e) {
    log(`command palette wake error ${e?.message || e}`)
  }

  // React to flag changes immediately (fs.watch) with a slow poll fallback for
  // self-heal / missed events. Both handles are unref'd so they never keep the
  // process alive.
  try {
    const watcher = watch(DIR, () => setTimeout(apply, 50))
    watcher.unref?.()
  } catch {}
  const poll = setInterval(apply, 5000)
  poll.unref?.()

  apply()
  return {}
}

export default { id: "beib.idle-dim", tui }
