// Behavioral test for plugin/idle-dim.js. Run with:
//   node --import ./test/register.mjs --test test/idle-dim.test.mjs
//
// The hard requirement encoded here: the plugin must NEVER touch api.route.
// OpenCode plugin routes render without the prompt/editor, so navigating to a
// fullscreen idle route leaves the user unable to type /active (the session
// looks dead). Idle fun content must live in sidebar slots only.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const FLAG_TTY = "ttystest"
const STATE_DIR = mkdtempSync(join(tmpdir(), "opencode-idle-test-"))
process.env.OPENCODE_IDLE_DIR = STATE_DIR
process.env.OPENCODE_IDLE_TTY = FLAG_TTY

const FLAG_FILE = join(STATE_DIR, `${FLAG_TTY}.flag`)

function makeApi() {
  const themeCalls = []
  const routeCalls = []
  const slotDefs = {}
  let selected = "system"
  return {
    themeCalls,
    routeCalls,
    slotDefs,
    theme: {
      ready: true,
      get selected() {
        return selected
      },
      has: () => true,
      set(name) {
        themeCalls.push(name)
        selected = name
        return true
      },
    },
    slots: {
      register(definition) {
        Object.assign(slotDefs, definition.slots)
      },
    },
    route: {
      register(...args) {
        routeCalls.push(["register", args])
      },
      navigate(...args) {
        routeCalls.push(["navigate", args])
      },
      get current() {
        routeCalls.push(["current"])
        return { name: "session", params: {} }
      },
    },
  }
}

const slotContext = { theme: { current: { text: "#ffffff", textMuted: "#888888" } } }

async function waitFor(condition, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(`timed out waiting for: ${label}`)
}

function childrenOf(node) {
  const children = node?.props?.children
  if (children === undefined || children === null) return []
  return Array.isArray(children) ? children : [children]
}

test("idle-dim lifecycle: dim, sidebar content, fade restore, no routes", async () => {
  const plugin = (await import("../plugin/idle-dim.js")).default
  const api = makeApi()
  await plugin.tui(api)

  // Slots registered, routes untouched.
  assert.ok(api.slotDefs.sidebar_title, "sidebar_title slot registered")
  assert.ok(api.slotDefs.sidebar_content, "sidebar_content slot registered")
  assert.ok(api.slotDefs.session_prompt_right, "session_prompt_right slot registered")
  assert.deepEqual(api.routeCalls, [], "plugin must never touch api.route")

  // Active state: sidebar content empty, prompt indicator empty.
  const sidebarNode = api.slotDefs.sidebar_content(slotContext, {})
  assert.ok(sidebarNode, "sidebar_content always returns a node (append slot)")
  assert.equal(childrenOf(sidebarNode).length, 0, "no idle content while active")
  const promptNode = api.slotDefs.session_prompt_right(slotContext, {})
  assert.equal(childrenOf(promptNode).join(""), "", "no prompt indicator while active")

  // Flag appears: theme dims within the 1.5s poll window.
  writeFileSync(FLAG_FILE, "")
  await waitFor(() => api.themeCalls.includes("beib-dim"), 5000, "dim theme set after flag creation")

  // Entering idle fades IN (bright -> dark) before reaching the dim theme.
  assert.deepEqual(
    api.themeCalls.slice(0, 4),
    ["beib-dim-07", "beib-dim-05", "beib-dim-03", "beib-dim"],
    "enter fade steps through intermediate themes in order",
  )

  // Idle state: sidebar shows rotating content, prompt shows indicator.
  const idleChildren = childrenOf(api.slotDefs.sidebar_content(slotContext, {}))
  assert.ok(idleChildren.length > 0, "sidebar shows idle content while dimmed")
  assert.equal(childrenOf(promptNode).join(""), "💤", "prompt indicator visible while dimmed")

  // Title slot stays rendered and turns bright while dimmed.
  const titleNode = api.slotDefs.sidebar_title(slotContext, { title: "proj" })
  const titleText = childrenOf(titleNode)[0]
  assert.equal(titleText.props.fg, "#ff9a00", "title is bright orange while dimmed")

  // Flag removed: wake fade steps through intermediate themes, then restores.
  rmSync(FLAG_FILE)
  await waitFor(
    () => api.themeCalls.at(-1) === "system",
    6000,
    "theme restored to saved theme after flag removal",
  )
  const fadeTail = api.themeCalls.slice(-4)
  assert.deepEqual(
    fadeTail,
    ["beib-dim-03", "beib-dim-05", "beib-dim-07", "system"],
    "wake fade steps through intermediate themes in order",
  )

  // Back to active: idle content gone, title back to theme color.
  assert.equal(childrenOf(api.slotDefs.sidebar_content(slotContext, {})).length, 0, "idle content cleared")
  assert.equal(titleText.props.fg, "#ffffff", "title back to theme color")

  // The invariant, end to end: not a single route call.
  assert.deepEqual(api.routeCalls, [], "plugin never registered or navigated a route")
})
