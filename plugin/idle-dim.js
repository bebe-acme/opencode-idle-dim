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
  const [isDim, setDim] = createSignal(false)

  const { appendFileSync } = await import("node:fs")
  const log = (msg) => {
    try { appendFileSync(`${DIR}/debug.log`, `${new Date().toISOString()} ${msg}\n`) } catch {}
  }

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
      } else if (!idle && saved !== null) {
        const ok = api.theme.set(saved)
        log(`apply: restore ok=${ok} to=${saved}`)
        saved = null
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

  try { watch(DIR, () => setTimeout(apply, 50)) } catch {}
  setInterval(apply, 1500)
  apply()
  return {}
}

export default { id: "beib.idle-dim", tui }
