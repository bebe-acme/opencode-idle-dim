// idle-dim: dims THIS opencode instance by switching to the "beib-dim" theme
// while a per-TTY flag file exists. /idle creates the flag, /active removes it.
// No signals, no iTerm color changes: pure opencode theme switching, so every
// UI element (including generated whites/grays) dims uniformly.
import { watch, existsSync, mkdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { homedir } from "node:os"
import { createElement, spread } from "@opentui/solid"
import { createSignal } from "solid-js"

const DIM_THEME = "beib-dim"
const BRIGHT = "#ff9a00" // readable title color while dimmed
const DIR = `${homedir()}/.local/state/opencode-idle`
const FADE_THEMES = ["beib-dim-03", "beib-dim-05", "beib-dim-07"]
const FADE_STEP_MS = 400

// Content pool for idle screen rotation
const ACME_GREEN = "#00ff2a"
const CONTENT_POOL = [
  {
    type: "ascii",
    color: ACME_GREEN,
    text: [
      "      ████              ██████████              ████      ",
      "      ████              ██████████              ████      ",
      "      ████              ██████████              ████      ",
      "           ████    ████████████████████    ████           ",
      "           ████    ████████████████████    ████           ",
      "            ██████████████████████████████████            ",
      "                ██████████████████████████                ",
      "                ██████████████████████████                ",
      "            ████████      ████████      ████████          ",
      "            ████████      ████████      ████████          ",
      "            ████████      ████████      ████████          ",
      "            ██████████████████████████████████            ",
      "            ██████████████████████████████████            ",
      "                ██████████████████████████                ",
      "                ██████████████████████████                ",
      "                     █████          █████                 ",
      "                     █████          █████                 ",
    ].join("\n"),
  },
  {
    type: "phrase",
    color: BRIGHT,
    text: "beib.exe has stopped responding\n      (￣▽￣)~*  z Z z",
  },
  {
    type: "phrase",
    color: BRIGHT,
    text: "💤  beib is dreaming...\n   afk but the vibes remain",
  },
  {
    type: "phrase",
    color: BRIGHT,
    text: "🌙 ·  ·  ·  ✨\n  stars passing by",
  },
  {
    type: "emoji",
    color: BRIGHT,
    text: "（◎−◎；）zZz",
  },
  {
    type: "ascii",
    color: ACME_GREEN,
    text: "  ██    ██\n████  ████\n  ██    ██\n  ████████\n    ████",
  },
  {
    type: "phrase",
    color: "#888888",
    text: "♪♫•*¨*•.¸¸  background music  ¸¸.•*¨*•♫♪",
  },
  {
    type: "emoji",
    color: BRIGHT,
    text: "🐱  =^..^=  🐱\n  cat guardian mode",
  },
  {
    type: "phrase",
    color: BRIGHT,
    text: "if a terminal dims and no one sees it...\n       ...does it even compile?",
  },
  {
    type: "ascii",
    color: "#00ffcc",
    text: [
      "    ╱▔▔╲",
      "   ╱    ╲",
      "  ╱  ◉◉  ╲",
      "  ▏  ▃▃  ▕",
      "  ▏      ▕",
      "   ╲    ╱",
      "    ╲▁▁╱",
    ].join("\n"),
  },
  {
    type: "phrase",
    color: BRIGHT,
    text: "loading beib.dll ... zzz\n       (press /active to resume)",
  },
  {
    type: "emoji",
    color: "#ff9a00",
    text: "⚡ idle · beib afk",
  },
]

function pickFrame() {
  // Prefer alien ~60% of the time, phrases ~30%, emoji ~10%
  const roll = Math.random()
  if (roll < 0.60) {
    return CONTENT_POOL.find(e => e.type === "ascii" && e.color === ACME_GREEN) || CONTENT_POOL[0]
  }
  if (roll < 0.90) {
    const phrases = CONTENT_POOL.filter(e => e.type === "phrase")
    return phrases[Math.floor(Math.random() * phrases.length)] || CONTENT_POOL[1]
  }
  const emojis = CONTENT_POOL.filter(e => e.type === "emoji")
  return emojis[Math.floor(Math.random() * emojis.length)] || CONTENT_POOL[4]
}

function getCurrentArt() {
  return pickFrame()
}

function runFadeSequence(api, target, log) {
  return new Promise((resolve) => {
    let step = 0
    function next() {
      if (step >= FADE_THEMES.length) {
        api.theme.set(target)
        log(`fade: final restore to ${target}`)
        resolve()
        return
      }
      const ok = api.theme.set(FADE_THEMES[step])
      log(`fade: step ${step} theme=${FADE_THEMES[step]} ok=${ok}`)
      step++
      setTimeout(next, FADE_STEP_MS)
    }
    next()
  })
}

function registerIdleRoute(api, log) {
  try {
    api.route.register([
      {
        name: "idle",
        render: () => {
          const art = getCurrentArt()
          const lines = art.text.split("\n")
          return el("box", {
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            width: "100%",
            children: lines.map(line =>
              el("text", { fg: art.color || BRIGHT, children: line })
            ),
          })
        },
      },
    ])
    log("idle route registered")
    return true
  } catch (e) {
    log(`idle route failed: ${e?.message || e}`)
    return false
  }
}

// Build opentui nodes without JSX.
function el(type, props) {
  const node = createElement(type)
  spread(node, props ?? {})
  return node
}

const tui = async (api) => {
  try { mkdirSync(DIR, { recursive: true }) } catch {}

  let tty = ""
  try {
    tty = execSync(`ps -o tty= -p ${process.pid}`, { encoding: "utf8" }).trim()
  } catch {}

  try {
    const { appendFileSync } = await import("node:fs")
    appendFileSync(`${DIR}/debug.log`, `${new Date().toISOString()} tui() pid=${process.pid} tty=${tty || "none"} themeReady=${api?.theme?.ready}\n`)
  } catch {}

  if (!tty || tty === "??") return {}
  const flag = `${DIR}/${tty}.flag`
  let saved = null
  let savedRoute = null
  const [isDim, setDim] = createSignal(false)

  const { appendFileSync } = await import("node:fs")
  const log = (msg) => {
    try { appendFileSync(`${DIR}/debug.log`, `${new Date().toISOString()} ${msg}\n`) } catch {}
  }
  const idleRoute = registerIdleRoute(api, log)

  const apply = () => {
    try {
      const idle = existsSync(flag)
      setDim(idle)
      if (!api.theme.ready) { log("apply: theme not ready"); return }
      if (idle && saved === null) {
        const has = api.theme.has(DIM_THEME)
        if (!has) { log(`apply: theme ${DIM_THEME} not found; selected=${api.theme.selected}`); return }
        // Never record the dim theme itself as the previous theme (covers
        // restarts that happen while the flag exists and kv persisted the dim).
        const current = api.theme.selected
        saved = current && current !== DIM_THEME ? current : "system"
        const ok = api.theme.set(DIM_THEME)
        log(`apply: set dim ok=${ok} saved=${saved}`)
        // Navigate to idle route if available
        if (idleRoute) {
          try {
            savedRoute = api.route.current
            api.route.navigate("idle")
          } catch (e) { log(`navigate idle error: ${e?.message || e}`) }
        }
      } else if (!idle && saved !== null) {
        // Navigate back from idle route first
        if (idleRoute) {
          try {
            if (savedRoute) {
              api.route.navigate(savedRoute.name, savedRoute.params)
              savedRoute = null
            } else {
              api.route.navigate("home")
            }
          } catch (e) { log(`navigate back error: ${e?.message || e}`) }
        }
        // Wake-up fade sequence
        const target = saved
        saved = null
        setTimeout(() => runFadeSequence(api, target, log), 100)
        log(`apply: starting fade to ${target}`)
      } else if (!idle && api.theme.selected === DIM_THEME) {
        // Instance started dimmed (flag was removed while it was down, or kv
        // kept the dim theme): heal back to system.
        const ok = api.theme.set("system")
        log(`apply: heal ok=${ok} (selected was ${DIM_THEME} without flag)`)
      }
    } catch (e) { log(`apply: error ${e?.message || e}`) }
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
              get fg() { return isDim() ? BRIGHT : ctx.theme.current.text },
              children: props.title,
            }),
          ]
          if (props.share_url) {
            children.push(
              el("text", {
                get fg() { return ctx.theme.current.textMuted },
                children: props.share_url,
              }),
            )
          }
          return el("box", { paddingRight: 1, children })
        },
      },
    })
    log("slot sidebar_title registered")
  } catch (e) { log(`slot register error ${e?.message || e}`) }

  // Fallback: sidebar_content shows mini idle indicator
  try {
    api.slots.register({
      slots: {
        sidebar_content(ctx, props) {
          if (!isDim()) return null
          const art = getCurrentArt()
          const firstLine = art.text.split("\n")[0]
          return el("box", {
            flexDirection: "column",
            paddingTop: 1,
            children: [
              el("text", { fg: art.color || BRIGHT, children: firstLine }),
              el("text", { fg: ctx.theme.current.textMuted, children: "─".repeat(20) }),
              el("text", { fg: BRIGHT, children: "💤 idle · /active to wake" }),
            ],
          })
        },
      },
    })
    log("slot sidebar_content registered")
  } catch (e) { log(`sidebar_content slot error ${e?.message || e}`) }

  // Fallback: session_prompt_right subtle indicator
  try {
    api.slots.register({
      slots: {
        session_prompt_right(ctx, props) {
          if (!isDim()) return null
          return el("text", { fg: BRIGHT, children: "💤" })
        },
      },
    })
    log("slot session_prompt_right registered")
  } catch (e) { log(`session_prompt_right slot error ${e?.message || e}`) }

  try { watch(DIR, () => setTimeout(apply, 50)) } catch {}
  setInterval(apply, 1500)
  apply()
  return {}
}

export default { id: "beib.idle-dim", tui }
