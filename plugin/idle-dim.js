// idle-dim: dims THIS opencode instance by switching to the "beib-dim" theme
// while a per-TTY flag file exists. /idle creates the flag, /active removes it.
// No signals, no iTerm color changes: pure opencode theme switching, so every
// UI element (including generated whites/grays) dims uniformly.
//
// Idle fun mode lives in sidebar slots only. The plugin must NEVER touch
// api.route: plugin routes render without the prompt/editor, so a fullscreen
// idle route leaves the user unable to type /active (the session looks dead).
// See handoff.md, trap 7.
import { watch, existsSync, mkdirSync, appendFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { homedir } from "node:os"
import { createElement, spread } from "@opentui/solid"
import { createSignal } from "solid-js"

const DIM_THEME = "beib-dim"
const BRIGHT = "#ff9a00" // readable accent color while dimmed
const ACME_GREEN = "#00ff2a"
const DIR = process.env.OPENCODE_IDLE_DIR || `${homedir()}/.local/state/opencode-idle`
const FADE_THEMES = ["beib-dim-03", "beib-dim-05", "beib-dim-07"]
const FADE_STEP_MS = 400
const ROTATION_BASE_MS = 8000
const ROTATION_JITTER_MS = 4000

// Sidebar-safe idle frames: every line stays under ~27 columns so nothing
// wraps in the sidebar. type drives the rotation weights in pickFrame.
const FRAMES = [
  {
    type: "alien",
    color: ACME_GREEN,
    lines: [
      "   ██       █████       ██",
      "     ██  ██████████  ██",
      "      █████████████████",
      "        █████████████",
      "      ████   ████   ████",
      "      █████████████████",
      "        █████████████",
      "          ███     ███",
    ],
  },
  {
    type: "alien",
    color: ACME_GREEN,
    lines: ["  ██    ██", "████  ████", "  ██    ██", "  ████████", "    ████"],
  },
  {
    type: "phrase",
    color: BRIGHT,
    lines: ["beib.exe has stopped", "responding", "(￣▽￣)~*  z Z z"],
  },
  {
    type: "phrase",
    color: BRIGHT,
    lines: ["💤 beib is dreaming...", "afk but vibes remain"],
  },
  {
    type: "phrase",
    color: BRIGHT,
    lines: ["🌙 ·  ·  ·  ✨", "stars passing by"],
  },
  {
    type: "phrase",
    color: "#888888",
    lines: ["♪♫•*¨*•.¸¸", "background music", "¸¸.•*¨*•♫♪"],
  },
  {
    type: "phrase",
    color: BRIGHT,
    lines: ["loading beib.dll ... zzz"],
  },
  { type: "emoji", color: BRIGHT, lines: ["（◎−◎；）zZz"] },
  { type: "emoji", color: BRIGHT, lines: ["🐱  =^..^=", "cat guardian mode"] },
  { type: "emoji", color: BRIGHT, lines: ["⚡ idle · beib afk"] },
]

function pickFrame() {
  // Aliens ~60% of the time, phrases ~30%, emoji ~10%.
  const roll = Math.random()
  const type = roll < 0.6 ? "alien" : roll < 0.9 ? "phrase" : "emoji"
  const pool = FRAMES.filter((frame) => frame.type === type)
  return pool[Math.floor(Math.random() * pool.length)] || FRAMES[0]
}

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
  let rotationTimer = null
  const [isDim, setDim] = createSignal(false)
  const [frameTick, bumpFrameTick] = createSignal(0)

  const startRotation = () => {
    if (rotationTimer) return
    rotationTimer = setInterval(
      () => {
        if (!isDim()) {
          stopRotation()
          return
        }
        bumpFrameTick((value) => value + 1)
      },
      ROTATION_BASE_MS + Math.floor(Math.random() * ROTATION_JITTER_MS),
    )
    rotationTimer.unref?.()
  }

  const stopRotation = () => {
    if (rotationTimer) {
      clearInterval(rotationTimer)
      rotationTimer = null
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
        // Never record the dim theme itself as the previous theme (covers
        // restarts that happen while the flag exists and kv persisted the dim).
        const current = api.theme.selected
        saved = current && current !== DIM_THEME ? current : "system"
        const ok = api.theme.set(DIM_THEME)
        log(`apply: set dim ok=${ok} saved=${saved}`)
        if (ok) startRotation()
      } else if (!idle && saved !== null) {
        // Wake-up fade sequence.
        if (!fading) {
          stopRotation()
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
        // Instance started dimmed (flag was removed while it was down, or kv
        // kept the dim theme): heal back to system.
        stopRotation()
        const ok = api.theme.set("system")
        log(`apply: heal ok=${ok} (selected was ${DIM_THEME} without flag)`)
      }
      // Ensure rotation is running whenever dimmed (covers re-idle during fade).
      if (isDim() && !rotationTimer) {
        startRotation()
      }
    } catch (e) {
      log(`apply: error ${e?.message || e}`)
    }
  }

  // Keep the sidebar session title readable while dimmed: win the
  // sidebar_title slot and only change the fg color reactively. Never return
  // null (single_winner decides fallback at initial render).
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

  // Idle fun content: rotating frames in the sidebar (append slot). The box is
  // always returned; only its children react to isDim/frameTick, mirroring the
  // proven getter pattern from sidebar_title.
  try {
    api.slots.register({
      slots: {
        sidebar_content(ctx) {
          return el("box", {
            flexDirection: "column",
            get children() {
              if (!isDim()) return []
              frameTick()
              const frame = pickFrame()
              return [
                el("box", { height: 1 }),
                ...frame.lines.map((line) => el("text", { fg: frame.color, children: line })),
                el("text", { fg: ctx.theme.current.textMuted, children: "─".repeat(20) }),
                el("text", { fg: BRIGHT, children: "💤 idle · /active to wake" }),
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

  // Subtle indicator next to the prompt, visible even when the sidebar is
  // hidden. Empty string while active so nothing renders.
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
