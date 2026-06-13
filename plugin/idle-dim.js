// idle-dim: dims THIS opencode instance by switching to the "beib-dim" theme
// while a per-TTY flag file exists. /idle creates the flag, /active removes it.
// No signals, no iTerm color changes: pure opencode theme switching, so every
// UI element (including generated whites/grays) dims uniformly.
//
// Idle fun mode is a full-screen screensaver picked at random on each /idle and
// drawn in a high-zIndex overlay via the `app` slot. The `app` slot draws ON TOP
// of the app WITHOUT replacing the prompt, so the session is never "dead" —
// unlike api.route, which the plugin must NEVER touch (a plugin route renders
// without the prompt; you cannot type /active and the session looks frozen).
// See handoff.md, trap 7. A persistent header (project name + folder) renders on
// top of every saver so a parked session is always identifiable. Dismiss: any
// key (useKeyboard), ⌘K → Wake Up, or /active.
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

// DVD-logo style palette: color flips on each wall bounce.
const SAVER_COLORS = ["#00ff2a", "#00ffcc", "#ff9a00", "#ff4fd8", "#5b8cff", "#fff35c"]

// Small classic invader for the bouncing screensaver (11x8).
const ALIEN = [
  "  █     █  ",
  "   █   █   ",
  "  ███████  ",
  " ██ ███ ██ ",
  "███████████",
  "█ ███████ █",
  "█ █     █ █",
  "   ██ ██   ",
]
const ALIEN_W = 11
const ALIEN_H = 8

// Compact alien for the sidebar fallback (shown if the overlay can't paint).
const MINI_ALIEN = ["  ██    ██  ", "  ████████  ", " ██  ██  ██ ", " ██████████ ", "  ██    ██  "]

// Pac-Man + ghost sprites (full blocks, like the alien — reliable rendering).
const PAC_OPEN = [" ██ ", "███ ", " ██ "]
const PAC_CLOSED = [" ██ ", "████", " ██ "]
const PAC_COLOR = "#ffd400"
const GHOST = [" ██ ", "████", "█ █ "]
const GHOST_COLORS = ["#ff0000", "#ffb8ff", "#00ffff", "#ffb851"]

// 5-row pixel font for the LOADING screen (3 cols per glyph).
const FONT = {
  L: ["█  ", "█  ", "█  ", "█  ", "███"],
  O: ["███", "█ █", "█ █", "█ █", "███"],
  A: ["███", "█ █", "███", "█ █", "█ █"],
  D: ["██ ", "█ █", "█ █", "█ █", "██ "],
  I: ["███", " █ ", " █ ", " █ ", "███"],
  N: ["█ █", "███", "███", "█ █", "█ █"],
  G: ["███", "█  ", "█ █", "█ █", "███"],
  ".": ["   ", "   ", "   ", "   ", " █ "],
  " ": ["   ", "   ", "   ", "   ", "   "],
}

function renderWord(word) {
  const rows = ["", "", "", "", ""]
  for (const ch of word) {
    const g = FONT[ch] || FONT[" "]
    for (let r = 0; r < 5; r++) rows[r] += g[r] + " "
  }
  return rows
}

// Build opentui nodes without JSX.
function el(type, props) {
  const node = createElement(type)
  spread(node, props ?? {})
  return node
}

// ── Screensavers ──────────────────────────────────────────────────────────
// Each saver: { name, stepMs, reset(w,h), tick(w,h), render(w,h) -> nodes[] }.
// Animation area is y ∈ [3, h): the top 3 rows are reserved for the identity
// header.

function makeAlienSaver() {
  let x = 2
  let y = 3
  let dx = 1
  let dy = 1
  let color = 0
  const reset = (w, h) => {
    x = 2 + Math.floor(Math.random() * Math.max(1, w - ALIEN_W - 4))
    y = 3 + Math.floor(Math.random() * Math.max(1, h - ALIEN_H - 6))
    dx = Math.random() < 0.5 ? -1 : 1
    dy = Math.random() < 0.5 ? -1 : 1
    color = 0
  }
  return {
    name: "alien",
    stepMs: 110,
    reset,
    tick(w, h) {
      x += dx
      y += dy
      let b = false
      if (x <= 0) { x = 0; dx = 1; b = true }
      if (x + ALIEN_W >= w) { x = w - ALIEN_W; dx = -1; b = true }
      if (y <= 3) { y = 3; dy = 1; b = true }
      if (y + ALIEN_H >= h) { y = h - ALIEN_H; dy = -1; b = true }
      if (b) color = (color + 1) % SAVER_COLORS.length
    },
    render() {
      const c = SAVER_COLORS[color % SAVER_COLORS.length]
      return [
        el("box", {
          position: "absolute",
          left: Math.round(x),
          top: Math.round(y),
          flexDirection: "column",
          children: ALIEN.map((ln) => el("text", { fg: c, children: ln })),
        }),
      ]
    },
  }
}

function makePacmanSaver() {
  let pacX = -4
  let row = 5
  let open = true
  let items = []
  const reset = (w, h) => {
    pacX = -4
    row = Math.max(3, Math.floor(h / 2) - 1)
    open = true
    items = []
    for (let c = 7; c < w - 3; c += 3) {
      items.push({ col: c, kind: "dot", color: "#9a9a9a", alive: true })
    }
    const spots = [0.38, 0.55, 0.72, 0.88]
    spots.forEach((p, i) => {
      const col = Math.floor(w * p)
      items.push({ col, kind: "ghost", color: GHOST_COLORS[i % GHOST_COLORS.length], alive: true })
    })
  }
  return {
    name: "pacman",
    stepMs: 140,
    reset,
    tick(w, h) {
      pacX += 1
      open = !open
      const mouth = pacX + 3
      for (const it of items) {
        if (it.alive && it.col <= mouth) it.alive = false
      }
      if (pacX > w + 4) reset(w, h)
    },
    render() {
      const nodes = []
      for (const it of items) {
        if (!it.alive) continue
        if (it.kind === "dot") {
          nodes.push(
            el("text", { position: "absolute", left: it.col, top: row + 1, fg: it.color, children: "·" }),
          )
        } else {
          nodes.push(
            el("box", {
              position: "absolute",
              left: it.col,
              top: row,
              flexDirection: "column",
              children: GHOST.map((ln) => el("text", { fg: it.color, children: ln })),
            }),
          )
        }
      }
      const sprite = open ? PAC_OPEN : PAC_CLOSED
      nodes.push(
        el("box", {
          position: "absolute",
          left: Math.round(pacX),
          top: row,
          flexDirection: "column",
          children: sprite.map((ln) => el("text", { fg: PAC_COLOR, children: ln })),
        }),
      )
      return nodes
    },
  }
}

function makeProgressSaver() {
  const SEG = 12
  let pct = 0
  let dots = 0
  let done = false
  let blink = false
  let ticks = 0
  const reset = () => {
    pct = 0
    dots = 0
    done = false
    blink = false
    ticks = 0
  }
  return {
    name: "progress",
    stepMs: 140,
    reset,
    tick() {
      ticks++
      if (ticks % 3 === 0) dots = (dots + 1) % 4
      blink = !blink
      if (!done) {
        pct += 3
        if (pct >= 100) { pct = 100; done = true; ticks = 0 }
      } else if (ticks > 12) {
        reset()
      }
    },
    render(w, h) {
      const WHITE = "#ffffff"
      const GREEN = "#3bdc3b"
      const EMPTY = "#1a1a1a"
      const filled = Math.round((pct / 100) * SEG)
      const tail = ".".repeat(dots) + " ".repeat(3 - dots)
      const wordRows = renderWord("LOADING" + tail).map((ln) => el("text", { fg: WHITE, children: ln }))
      const borderW = SEG * 2 + 1
      const segChildren = [el("text", { fg: WHITE, children: "┃ " })]
      for (let i = 0; i < SEG; i++) {
        segChildren.push(
          el("text", { fg: i < filled ? GREEN : EMPTY, children: i < SEG - 1 ? "█ " : "█" }),
        )
      }
      segChildren.push(el("text", { fg: WHITE, children: " ┃" }))
      const children = [
        ...wordRows,
        el("box", { height: 1 }),
        el("text", { fg: WHITE, children: "┏" + "━".repeat(borderW) + "┓" }),
        el("box", { flexDirection: "row", children: segChildren }),
        el("text", { fg: WHITE, children: "┗" + "━".repeat(borderW) + "┛" }),
      ]
      if (done) {
        children.push(el("box", { height: 1 }))
        children.push(el("text", { fg: blink ? "#ffd400" : "#4a4a00", children: "▸ PRESS ANY KEY" }))
      }
      return [
        el("box", {
          position: "absolute",
          left: 0,
          top: Math.max(3, Math.floor(h / 2) - 5),
          width: "100%",
          flexDirection: "column",
          alignItems: "center",
          children,
        }),
      ]
    },
  }
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
  let lastTitle = ""
  const [isDim, setDim] = createSignal(false)
  const [animTick, bumpAnim] = createSignal(0)

  const wakeUp = () => {
    try {
      execSync(`${homedir()}/.local/bin/opencode-iterm-state active`, { encoding: "utf8", timeout: 5000 })
      log("wake: executed")
    } catch (e) {
      log(`wake: error ${e?.message || e}`)
    }
  }

  const termSize = () => {
    const r = api.renderer || {}
    const w = r.width || r.terminalWidth || r.cols || (r.terminal && r.terminal.width) || 80
    const h = r.height || r.terminalHeight || r.rows || (r.terminal && r.terminal.height) || 24
    return { w: Math.max(w, ALIEN_W + 4), h: Math.max(h, ALIEN_H + 6) }
  }

  const folderLabel = () => {
    let dir = ""
    try {
      dir = (api.state && api.state.path && (api.state.path.directory || api.state.path.worktree)) || ""
    } catch {}
    if (!dir) {
      try {
        dir = process.cwd()
      } catch {}
    }
    const home = homedir()
    if (dir && home && dir.startsWith(home)) dir = "~" + dir.slice(home.length)
    return dir || ""
  }

  // Screensaver controller.
  const SAVERS = [makeAlienSaver(), makePacmanSaver(), makeProgressSaver()]
  let activeSaver = null
  let saverTimer = null

  const pickSaver = () => {
    activeSaver = SAVERS[Math.floor(Math.random() * SAVERS.length)]
    const { w, h } = termSize()
    try {
      activeSaver.reset(w, h)
    } catch (e) {
      log(`saver reset error ${e?.message || e}`)
    }
    log(`saver: picked ${activeSaver.name}`)
  }

  const startSaver = () => {
    if (saverTimer) return
    const step = (activeSaver && activeSaver.stepMs) || 120
    saverTimer = setInterval(() => {
      if (!isDim()) {
        stopSaver()
        return
      }
      if (activeSaver) {
        const { w, h } = termSize()
        try {
          activeSaver.tick(w, h)
        } catch (e) {
          log(`saver tick error ${e?.message || e}`)
        }
      }
      bumpAnim((v) => v + 1)
    }, step)
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
        const current = api.theme.selected
        saved = current && current !== DIM_THEME ? current : "system"
        const ok = api.theme.set(DIM_THEME)
        log(`apply: set dim ok=${ok} saved=${saved}`)
        if (ok) {
          pickSaver()
          startSaver()
        }
      } else if (!idle && saved !== null) {
        if (!fading) {
          stopSaver()
          activeSaver = null
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
        stopSaver()
        activeSaver = null
        const ok = api.theme.set("system")
        log(`apply: heal ok=${ok} (selected was ${DIM_THEME} without flag)`)
      }
      // Ensure the saver runs whenever dimmed (covers re-idle during fade).
      if (isDim() && !saverTimer) {
        if (!activeSaver) pickSaver()
        startSaver()
      }
    } catch (e) {
      log(`apply: error ${e?.message || e}`)
    }
  }

  // Keep the sidebar session title readable while dimmed and capture it for the
  // overlay identity header. Never return null.
  try {
    api.slots.register({
      slots: {
        sidebar_title(ctx, props) {
          if (props && props.title) lastTitle = props.title
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

  // Sidebar fallback: small alien + hint when dimmed (guaranteed-visible
  // indicator; the overlay normally covers this).
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

  // Screensaver overlay in the `app` slot: full-screen, on top of the app, only
  // while dimmed. Renders the active saver + a persistent identity header
  // (project name + folder) + a dismiss hint. Never touches api.route.
  try {
    api.slots.register({
      slots: {
        app() {
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
              const { w, h } = termSize()
              let saverNodes = []
              if (activeSaver) {
                try {
                  saverNodes = activeSaver.render(w, h)
                } catch (e) {
                  log(`saver render error ${e?.message || e}`)
                }
              }
              const name = lastTitle || folderLabel().split("/").pop() || "opencode"
              const header = el("box", {
                position: "absolute",
                left: 2,
                top: 0,
                flexDirection: "column",
                children: [
                  el("text", { fg: BRIGHT, children: "▶ " + name }),
                  el("text", { fg: "#b36b00", children: "  " + folderLabel() }),
                ],
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
              return [...saverNodes, header, hint]
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
