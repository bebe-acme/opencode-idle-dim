// idle-dim: dims THIS opencode instance by switching to the "beib-dim" theme
// while a per-TTY flag file exists. /idle creates the flag, /active removes it.
// No signals, no iTerm color changes: pure opencode theme switching, so every
// UI element (including generated whites/grays) dims uniformly.
//
// Idle fun mode is a full-screen screensaver: the ACME alien bounces around the
// terminal like a DVD logo, in a high-zIndex overlay rendered through the `app`
// slot. The `app` slot draws ON TOP of the app WITHOUT replacing the prompt, so
// the session is never "dead" — unlike api.route, which the plugin must NEVER
// touch (a plugin route renders without the prompt; you cannot type /active and
// the session looks frozen). See handoff.md, trap 7. Dismiss: ⌘K → Wake Up,
// any key (useKeyboard), or /active.
import * as otui from "@opentui/solid"
import { watch, existsSync, mkdirSync, appendFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { homedir } from "node:os"
import { createSignal } from "solid-js"

const { createElement, spread } = otui

const DIM_THEME = "beib-dim"
const BRIGHT = "#ff9a00" // readable accent color while dimmed
const ACME_GREEN = "#00ff2a"
const DIR = process.env.OPENCODE_IDLE_DIR || `${homedir()}/.local/state/opencode-idle`
const FADE_THEMES = ["beib-dim-03", "beib-dim-05", "beib-dim-07"]
const FADE_STEP_MS = 400
const SAVER_STEP_MS = 110 // bounce tick — lower is faster/smoother

// ACME alien for the bouncing screensaver (classic invader silhouette).
const ALIEN = [
  "    ██          ██    ",
  "      ██      ██      ",
  "    ██████████████    ",
  "  ████  ██████  ████  ",
  "██████████████████████",
  "██  ██████████████  ██",
  "██  ██          ██  ██",
  "      ████  ████      ",
]
const ALIEN_W = 22
const ALIEN_H = 8
// DVD-logo style: color flips on each wall bounce.
const SAVER_COLORS = ["#00ff2a", "#00ffcc", "#ff9a00", "#ff4fd8", "#5b8cff", "#fff35c"]

// Compact alien for the sidebar fallback (shown if the overlay can't paint).
const MINI_ALIEN = ["  ██    ██  ", "  ████████  ", " ██  ██  ██ ", " ██████████ ", "  ██    ██  "]

function runFadeSequence(api, target, log, flag, onDone) {
  return new Promise((resolve) => {
    let step = 0
    function next() {
      if (existsSync(flag)) {
        log("fade: aborted, flag reappeared")
        api.theme.set(DIM_THEME)
        resolve()
        return
      }
      if (step >= FADE_THEMES.length) {
        const ok = api.theme.set(target)
        log(`fade: final restore to ${target} ok=${ok}`)
        if (onDone) onDone()
        resolve()
        return
      }
      const ok = api.theme.set(FADE_THEMES[step])
      log(`fade: step ${step} theme=${FADE_THEMES[step]} ok=${ok}`)
      step++
      setTimeout(next, FADE_STEP_MS)
    }
    setTimeout(next, FADE_STEP_MS)
  })
}

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
  let fading = false
  const [isDim, setDim] = createSignal(false)
  const [animTick, bumpAnim] = createSignal(0)

  // One-click wake: run the active script (removes the flag → fade restore).
  const wakeUp = () => {
    try {
      execSync(`${homedir()}/.local/bin/opencode-iterm-state active`, { encoding: "utf8", timeout: 5000 })
      log("wake: executed")
    } catch (e) {
      log(`wake: error ${e?.message || e}`)
    }
  }

  // Screensaver bounce state.
  let sx = 4
  let sy = 2
  let sdx = 1
  let sdy = 1
  let scolor = 0
  let saverTimer = null

  const termSize = () => {
    const r = api.renderer || {}
    const w = r.width || r.terminalWidth || r.cols || (r.terminal && r.terminal.width) || 80
    const h = r.height || r.terminalHeight || r.rows || (r.terminal && r.terminal.height) || 24
    return { w: Math.max(w, ALIEN_W + 2), h: Math.max(h, ALIEN_H + 2) }
  }

  const startSaver = () => {
    if (saverTimer) return
    saverTimer = setInterval(() => {
      if (!isDim()) {
        stopSaver()
        return
      }
      const { w, h } = termSize()
      sx += sdx
      sy += sdy
      let bounced = false
      if (sx <= 0) { sx = 0; sdx = 1; bounced = true }
      if (sx + ALIEN_W >= w) { sx = w - ALIEN_W; sdx = -1; bounced = true }
      if (sy <= 0) { sy = 0; sdy = 1; bounced = true }
      if (sy + ALIEN_H >= h) { sy = h - ALIEN_H; sdy = -1; bounced = true }
      if (bounced) scolor = (scolor + 1) % SAVER_COLORS.length
      bumpAnim((v) => v + 1)
    }, SAVER_STEP_MS)
    saverTimer.unref?.()
  }

  const stopSaver = () => {
    if (saverTimer) {
      clearInterval(saverTimer)
      saverTimer = null
    }
  }

  const apply = () => {
    try {
      const idle = existsSync(flag)
      setDim(idle)
      if (!api.theme.ready) {
        log("apply: theme not ready")
        return
      }
      if (idle && saved === null) {
        const has = api.theme.has(DIM_THEME)
        if (!has) {
          log(`apply: theme ${DIM_THEME} not found; selected=${api.theme.selected}`)
          return
        }
        // Never record the dim theme itself as the previous theme.
        const current = api.theme.selected
        saved = current && current !== DIM_THEME ? current : "system"
        const ok = api.theme.set(DIM_THEME)
        log(`apply: set dim ok=${ok} saved=${saved}`)
        if (ok) startSaver()
      } else if (!idle && saved !== null) {
        // Wake-up fade sequence.
        if (!fading) {
          stopSaver()
          fading = true
          const target = saved
          setTimeout(() => {
            runFadeSequence(api, target, log, flag, () => {
              saved = null
            }).finally(() => {
              fading = false
            })
          }, 100)
          log(`apply: starting fade to ${target}`)
        }
      } else if (!idle && api.theme.selected === DIM_THEME) {
        // Instance started dimmed (flag removed while it was down): heal.
        stopSaver()
        const ok = api.theme.set("system")
        log(`apply: heal ok=${ok} (selected was ${DIM_THEME} without flag)`)
      }
      // Ensure the saver runs whenever dimmed (covers re-idle during fade).
      if (isDim() && !saverTimer) startSaver()
    } catch (e) {
      log(`apply: error ${e?.message || e}`)
    }
  }

  // Keep the sidebar session title readable while dimmed: win the sidebar_title
  // slot and only change the fg color reactively. Never return null.
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

  // Sidebar fallback: small alien + hint when dimmed. The screensaver overlay
  // normally covers this; it stays as a guaranteed-visible indicator.
  try {
    api.slots.register({
      slots: {
        sidebar_content(ctx) {
          return el("box", {
            flexDirection: "column",
            alignItems: "center",
            get children() {
              if (!isDim()) return []
              animTick()
              return [
                el("box", { height: 1 }),
                ...MINI_ALIEN.map((line) => el("text", { fg: ACME_GREEN, children: line })),
                el("box", { height: 1 }),
                el("text", { fg: ctx.theme.current.textMuted, children: "─".repeat(20) }),
                el("text", { fg: BRIGHT, children: "💤 idle · ⌘K → Wake Up" }),
              ]
            },
          })
        },
      },
    })
    log("slot sidebar_content registered")
  } catch (e) {
    log(`sidebar_content slot error ${e?.message || e}`)
  }

  // Subtle indicator next to the prompt, visible even when sidebar is hidden.
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

  // Screensaver: full-screen overlay in the `app` slot (renders on top of the
  // app, above the active route, WITHOUT replacing the prompt). Only paints
  // while dimmed; zero footprint otherwise.
  try {
    api.slots.register({
      slots: {
        app() {
          // Dismiss on any key while idle (best-effort; ⌘K is the guaranteed path).
          try {
            if (otui.useKeyboard) {
              otui.useKeyboard(() => {
                if (isDim()) wakeUp()
              })
            }
          } catch {}
          return el("box", {
            get position() {
              return isDim() ? "absolute" : "relative"
            },
            get left() {
              return isDim() ? 0 : undefined
            },
            get top() {
              return isDim() ? 0 : undefined
            },
            get width() {
              return isDim() ? "100%" : 0
            },
            get height() {
              return isDim() ? "100%" : 0
            },
            get zIndex() {
              return isDim() ? 9999 : 0
            },
            get backgroundColor() {
              return isDim() ? "#000000" : undefined
            },
            get children() {
              if (!isDim()) return []
              animTick()
              const color = SAVER_COLORS[scolor % SAVER_COLORS.length]
              const alien = el("box", {
                position: "absolute",
                left: Math.round(sx),
                top: Math.round(sy),
                flexDirection: "column",
                children: ALIEN.map((line) => el("text", { fg: color, children: line })),
              })
              const hint = el("box", {
                position: "absolute",
                left: 0,
                bottom: 1,
                width: "100%",
                justifyContent: "center",
                children: [
                  el("text", { fg: BRIGHT, children: "💤  idle  ·  press any key or ⌘K → Wake Up" }),
                ],
              })
              return [alien, hint]
            },
          })
        },
      },
    })
    log("slot app (screensaver) registered")
  } catch (e) {
    log(`app slot error ${e?.message || e}`)
  }

  // One-click deactivation: register a "Wake Up" command in the palette (⌘K).
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

  try {
    const watcher = watch(DIR, () => setTimeout(apply, 50))
    watcher.unref?.()
  } catch {}
  const poll = setInterval(apply, 1500)
  poll.unref?.()

  apply()
  return {}
}

export default { id: "beib.idle-dim", tui }
