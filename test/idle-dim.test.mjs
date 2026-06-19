// Behavioral test for plugin/idle-dim.js. Run with:
//   node --import ./test/register.mjs --test test/idle-dim.test.mjs
//
// The hard requirement encoded here: the plugin must NEVER touch api.route.
// OpenCode plugin routes render without the prompt/editor, so navigating to a
// fullscreen idle route leaves the user unable to type /active (the session
// looks dead). The dim indicator must live in sidebar/prompt slots only.
//
// The plugin is the "cheap" version: entering/leaving idle is a single instant
// theme switch (no fade animation, no screensaver, no overlay), so a parked
// session costs ~0% CPU.
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
    command: {
      register() {},
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

test("idle-dim lifecycle: instant dim, prompt/title indicators, restore, no routes", async () => {
  const plugin = (await import("../plugin/idle-dim.js")).default
  const api = makeApi()
  await plugin.tui(api)

  // Slots registered, routes untouched.
  assert.ok(api.slotDefs.sidebar_title, "sidebar_title slot registered")
  assert.ok(api.slotDefs.session_prompt_right, "session_prompt_right slot registered")
  assert.deepEqual(api.routeCalls, [], "plugin must never touch api.route")

  // Active state: prompt indicator empty, title in the theme color.
  const promptNode = api.slotDefs.session_prompt_right(slotContext, {})
  assert.equal(childrenOf(promptNode).join(""), "", "no prompt indicator while active")
  const titleNode = api.slotDefs.sidebar_title(slotContext, { title: "proj" })
  const titleText = childrenOf(titleNode)[0]
  assert.equal(titleText.props.fg, "#ffffff", "title in theme color while active")

  // Flag appears: theme dims with a single instant switch (no fade steps).
  writeFileSync(FLAG_FILE, "")
  await waitFor(() => api.themeCalls.includes("beib-dim"), 6000, "dim theme set after flag creation")
  assert.deepEqual(api.themeCalls, ["beib-dim"], "enter idle is one instant theme switch (no fade)")

  // Idle state: prompt shows the 💤 indicator, title turns bright orange.
  assert.equal(childrenOf(promptNode).join(""), "💤", "prompt indicator visible while dimmed")
  assert.equal(titleText.props.fg, "#ff9a00", "title is bright orange while dimmed")

  // Flag removed: theme restored to the saved theme with a single instant switch.
  rmSync(FLAG_FILE)
  await waitFor(() => api.themeCalls.at(-1) === "system", 6000, "theme restored after flag removal")
  assert.deepEqual(api.themeCalls, ["beib-dim", "system"], "restore is one instant switch back (no fade)")

  // Back to active: prompt indicator gone, title back to the theme color.
  assert.equal(childrenOf(promptNode).join(""), "", "prompt indicator cleared")
  assert.equal(titleText.props.fg, "#ffffff", "title back to theme color")

  // The invariant, end to end: not a single route call.
  assert.deepEqual(api.routeCalls, [], "plugin never registered or navigated a route")
})
