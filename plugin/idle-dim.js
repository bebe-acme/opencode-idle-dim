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
// top of every saver so a parked session is always identifiable. One color is
// used everywhere, captured from the active theme accent before dimming. Sprites
// use half-block characters (▀▄█) so pixels are square instead of stretched.
// Dismiss: any key (useKeyboard), ⌘K → Wake Up, or /active.
import * as otui from "@opentui/solid"
import { watch, existsSync, mkdirSync, appendFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { homedir } from "node:os"
import { createSignal } from "solid-js"

const { createElement, spread } = otui

const DIM_THEME = "beib-dim"
const BRIGHT = "#ff9a00" // fallback accent when the theme accent can't be read
const ACME_GREEN = "#00ff2a"
const DIR = process.env.OPENCODE_IDLE_DIR || `${homedir()}/.local/state/opencode-idle`
const FADE_THEMES = ["beib-dim-03", "beib-dim-05", "beib-dim-07"]
const FADE_STEP_MS = 400

// Convert a pixel grid (strings; any non-space/non-dot char = filled) into
// half-block rows so each character holds two vertical pixels — square pixels,
// no vertical stretch.
function toHalfBlocks(rows) {
  const h = rows.length
  const w = Math.max(...rows.map((r) => r.length))
  const g = rows.map((r) => r.padEnd(w, " ").split("").map((c) => c !== " " && c !== "."))
  const out = []
  for (let y = 0; y < h; y += 2) {
    let line = ""
    for (let x = 0; x < w; x++) {
      const t = g[y][x]
      const b = y + 1 < h ? g[y + 1][x] : false
      line += t && b ? "█" : t ? "▀" : b ? "▄" : " "
    }
    out.push(line)
  }
  return out
}

// Classic space invader (square pixels via half-blocks).
const ALIEN = toHalfBlocks([
  "....#...#....",
  "....#...#....",
  "...#######...",
  "..#########..",
  "..##.###.##..",
  "..#########..",
  ".###########.",
  "##.#######.##",
  "##.#######.##",
  "...#.....#...",
  "..##.....##..",
  "..##.....##..",
])
const ALIEN_W = 13
const ALIEN_H = ALIEN.length // 6

// Compact alien for the sidebar fallback (shown if the overlay can't paint).
const MINI_ALIEN = toHalfBlocks([
  "..#.....#..",
  "...#...#...",
  "..#######..",
  ".##.###.##.",
  "###########",
  "#.#####.#.#",
  "...#...#...",
])

// ── Screensavers ──────────────────────────────────────────────────────────
// Each saver: { name, stepMs, reset(w,h), tick(w,h), render(w,h,color) }.
// One color (the theme accent) is passed to render. Top 3 rows reserved for
// the identity header.

function makeAlienSaver() {
  let x = 2
  let y = 3
  let dx = 1
  let dy = 1
  const reset = (w, h) => {
    x = 2 + Math.floor(Math.random() * Math.max(1, w - ALIEN_W - 4))
    y = 3 + Math.floor(Math.random() * Math.max(1, h - ALIEN_H - 4))
    dx = Math.random() < 0.5 ? -1 : 1
    dy = Math.random() < 0.5 ? -1 : 1
  }
  return {
    name: "alien",
    stepMs: 110,
    reset,
    tick(w, h) {
      x += dx
      y += dy
      if (x <= 0) { x = 0; dx = 1 }
      if (x + ALIEN_W >= w) { x = w - ALIEN_W; dx = -1 }
      if (y <= 3) { y = 3; dy = 1 }
      if (y + ALIEN_H >= h) { y = h - ALIEN_H; dy = -1 }
    },
    render(w, h, color) {
      return [
        el("box", {
          position: "absolute",
          left: Math.round(x),
          top: Math.round(y),
          flexDirection: "column",
          children: ALIEN.map((ln) => el("text", { fg: color, children: ln })),
        }),
      ]
    },
  }
}

function makeProgressSaver() {
  const SEG = 12
  let pct = 0
  let done = false
  let hold = 0
  const reset = () => {
    pct = 0
    done = false
    hold = 0
  }
  return {
    name: "progress",
    stepMs: 130,
    reset,
    tick() {
      if (!done) {
        pct += 3
        if (pct >= 100) { pct = 100; done = true; hold = 0 }
      } else {
        hold++
        if (hold > 10) reset()
      }
    },
    render(w, h, color) {
      const filled = Math.round((pct / 100) * SEG)
      const mid =
        "█ " + Array.from({ length: SEG }, (_, i) => (i < filled ? "██" : "  ")).join(" ") + " █"
      const border = "█".repeat(mid.length)
      return [
        el("box", {
          position: "absolute",
          left: 0,
          top: Math.max(3, Math.floor(h / 2) - 1),
          width: "100%",
          flexDirection: "column",
          alignItems: "center",
          children: [
            el("text", { fg: color, children: border }),
            el("text", { fg: color, children: mid }),
            el("text", { fg: color, children: border }),
          ],
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
  let savedAccent = BRIGHT
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
  const SAVERS = [makeAlienSaver(), makeProgressSaver()]
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
        // Capture the live theme accent BEFORE dimming, so the screensaver
        // matches the terminal color (one color everywhere).
        try {
          const cur = api.theme.current || {}
          savedAccent = cur.primary || cur.accent || cur.text || BRIGHT
        } catch {
          savedAccent = BRIGHT
        }
        const current = api.theme.selected
        saved = current && current !== DIM_THEME ? current : "system"
        const ok = api.theme.set(DIM_THEME)
        log(`apply: set dim ok=${ok} saved=${saved} accent=${savedAccent}`)
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
                ...MINI_ALIEN.map((line) => el("text", { fg: savedAccent, children: line })),
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
              const color = savedAccent
              let saverNodes = []
              if (activeSaver) {
                try {
                  saverNodes = activeSaver.render(w, h, color)
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
                  el("text", { fg: color, children: "▶ " + name }),
                  el("text", { fg: "#8a8a8a", children: "  " + folderLabel() }),
                ],
              })
              const hint = el("box", {
                position: "absolute",
                left: 0,
                bottom: 1,
                width: "100%",
                justifyContent: "center",
                children: [
                  el("text", { fg: color, children: "💤  idle  ·  press any key or ⌘K → Wake Up" }),
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
