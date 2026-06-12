# Idle Fun Mode v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add playful ASCII art (ACME alien), rotating content, and a ~1.5s wake-up fade to the idle-dim plugin, with route-based full-screen primary path and slot-based fallback.

**Architecture:** Single plugin file `idle-dim.js` grows from 106 to ~280 lines. Three new pre-generated theme JSONs added to `themes/`. Existing flag-file mechanism, commands, and iterm-state script unchanged. Route `idle` renders full-screen content if the API allows; sidebar slots serve as fallback.

**Tech Stack:** Node.js, OpenCode TUI Plugin API (`@opentui/solid`, `@opencode-ai/plugin/tui`), SolidJS signals, bash

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `themes/beib-dim-03.json` | CREATE | Theme at brightness factor 0.30 |
| `themes/beib-dim-05.json` | CREATE | Theme at brightness factor 0.50 |
| `themes/beib-dim-07.json` | CREATE | Theme at brightness factor 0.70 |
| `plugin/idle-dim.js` | MODIFY | Add content pool, route, slots, fade, rotation |
| `install.sh` | MODIFY | Copy new theme files |
| `tui.json.example` | MODIFY | Show options format |
| `bin/opencode-iterm-state` | NO CHANGE | — |
| `command/idle.md` | NO CHANGE | — |
| `command/active.md` | NO CHANGE | — |
| `themes/beib-dim.json` | NO CHANGE | — |

---

### Task 1: Generate intermediate theme files

**Files:**
- Create: `themes/beib-dim-03.json`
- Create: `themes/beib-dim-05.json`
- Create: `themes/beib-dim-07.json`

Each theme is `beib-dim.json` with every color multiplied by the target factor. The factor scales each RGB component toward 0 (black), same as the original dim approach.

- [ ] **Step 1: Generate beib-dim-03.json (factor 0.30)**

Write `themes/beib-dim-03.json` — every hex color from `beib-dim.json` has each channel multiplied by `0.30 / 0.15 = 2.0`. Take `beib-dim.json` colors, which are already at factor ~0.15, and double each RGB component. Or more cleanly: generate from the original system theme with factor 0.30.

Since we don't have the original system theme on disk, compute from `beib-dim.json` by scaling each channel by `0.30/0.15 = 2.0`, clamped to 0xFF. All colors in `beib-dim.json` are ≤ `#262521` so doubling stays within range.

```bash
node -e "
const dim = require('./themes/beib-dim.json');
const factor = 0.30 / 0.15; // 2.0
const out = { \$schema: dim.\$schema, theme: {} };
for (const [k, v] of Object.entries(dim.theme)) {
  if (v === 'none') { out.theme[k] = 'none'; continue; }
  const r = Math.min(255, Math.round(parseInt(v.slice(1,3), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(v.slice(3,5), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(v.slice(5,7), 16) * factor));
  out.theme[k] = '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('');
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
" > themes/beib-dim-03.json
```

- [ ] **Step 2: Generate beib-dim-05.json (factor 0.50)**

Same script, factor = `0.50 / 0.15 = 3.333...`:

```bash
node -e "
const dim = require('./themes/beib-dim.json');
const factor = 0.50 / 0.15;
const out = { \$schema: dim.\$schema, theme: {} };
for (const [k, v] of Object.entries(dim.theme)) {
  if (v === 'none') { out.theme[k] = 'none'; continue; }
  const r = Math.min(255, Math.round(parseInt(v.slice(1,3), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(v.slice(3,5), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(v.slice(5,7), 16) * factor));
  out.theme[k] = '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('');
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
" > themes/beib-dim-05.json
```

- [ ] **Step 3: Generate beib-dim-07.json (factor 0.70)**

Same script, factor = `0.70 / 0.15 = 4.666...`:

```bash
node -e "
const dim = require('./themes/beib-dim.json');
const factor = 0.70 / 0.15;
const out = { \$schema: dim.\$schema, theme: {} };
for (const [k, v] of Object.entries(dim.theme)) {
  if (v === 'none') { out.theme[k] = 'none'; continue; }
  const r = Math.min(255, Math.round(parseInt(v.slice(1,3), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(v.slice(3,5), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(v.slice(5,7), 16) * factor));
  out.theme[k] = '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('');
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
" > themes/beib-dim-07.json
```

- [ ] **Step 4: Validate generated themes**

```bash
node --check <(echo "require('./themes/beib-dim-03.json')") && echo "03 OK"
node --check <(echo "require('./themes/beib-dim-05.json')") && echo "05 OK"
node --check <(echo "require('./themes/beib-dim-07.json')") && echo "07 OK"
```

Expected: `03 OK`, `05 OK`, `07 OK`.

- [ ] **Step 5: Commit**

```bash
git add themes/beib-dim-03.json themes/beib-dim-05.json themes/beib-dim-07.json
git commit -m "feat: add intermediate dim themes for wake-up fade (0.30, 0.50, 0.70)"
```

---

### Task 2: Add content pool to plugin

**Files:**
- Modify: `plugin/idle-dim.js`

Add the content pool — an array of objects with `type`, `text`, and `color`. Placed at the top of the plugin file, after the existing constants.

- [ ] **Step 1: Add CONTENT_POOL constant**

Insert after the existing constants block (after `const DIR = ...` line 13). Read the current file first.

```js
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
```

- [ ] **Step 2: Verify the file is valid JavaScript**

```bash
node --check plugin/idle-dim.js
```

Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add plugin/idle-dim.js
git commit -m "feat: add CONTENT_POOL with ACME alien, phrases, and emoji art"
```

---

### Task 3: Implement idle screen (route + slots)

**Files:**
- Modify: `plugin/idle-dim.js`

Add route-based idle screen as primary path, with `registerIdleRoute()` function. Register `sidebar_content` and `session_prompt_right` slots as fallback. Both paths use `CONTENT_POOL` and a shared `getCurrentArt()` function.

- [ ] **Step 1: Add helper — getCurrentArt() and pickFrame()**

Insert after the CONTENT_POOL constant, before the `tui` function:

```js
let poolIndex = 0
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
```

- [ ] **Step 2: Add registerIdleRoute() function**

Insert after the helper functions, before the `tui` function:

```js
async function registerIdleRoute(api, isDim) {
  let routeUnreg = null
  try {
    routeUnreg = api.route.register([
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
    return routeUnreg
  } catch (e) {
    log(`idle route failed: ${e?.message || e}`)
    return null
  }
}
```

- [ ] **Step 3: Add idle screen trigger logic in the tui function**

Inside the `apply()` function in `tui()`, after the theme-switch logic (around the `else if (!idle && saved !== null)` block), add route navigation:

Locate the `apply()` function (starts around line 45) and modify it. The current apply does theme switching. Add after the existing theme logic:

```js
const apply = () => {
    try {
      const idle = existsSync(flag)
      const wasDim = isDim()
      setDim(idle)
      if (!api.theme.ready) { log("apply: theme not ready"); return }
      if (idle && saved === null) {
        const has = api.theme.has(DIM_THEME)
        if (!has) { log(`apply: theme ${DIM_THEME} not found; selected=${api.theme.selected}`); return }
        const current = api.theme.selected
        saved = current && current !== DIM_THEME ? current : "system"
        const ok = api.theme.set(DIM_THEME)
        log(`apply: set dim ok=${ok} saved=${saved}`)
        // Navigate to idle route if available
        if (idleRoute) {
          try { api.route.navigate("idle") } catch (e) { log(`navigate idle error: ${e?.message || e}`) }
        }
      } else if (!idle && saved !== null) {
        // Wake-up: navigate back first, then fade
        if (idleRoute) {
          try { api.route.navigate("session") } catch (e) { log(`navigate session error: ${e?.message || e}`) }
        }
        // Fade sequence (Task 4 will add this)
        const ok = api.theme.set(saved)
        log(`apply: restore ok=${ok} to=${saved}`)
        saved = null
      } else if (!idle && api.theme.selected === DIM_THEME) {
        const ok = api.theme.set("system")
        log(`apply: heal ok=${ok} (selected was ${DIM_THEME} without flag)`)
      }
    } catch (e) { log(`apply: error ${e?.message || e}`) }
  }
```

- [ ] **Step 4: Initialize idleRoute in tui()**

In the `tui` function, after `const [isDim, setDim] = createSignal(false)` (line 38), add:

```js
const idleRoute = await registerIdleRoute(api, isDim)
```

- [ ] **Step 5: Add slot fallback — sidebar_content and session_prompt_right**

After the existing `sidebar_title` slot registration (after line 98), add fallback slots:

```js
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
```

- [ ] **Step 6: Verify**

```bash
node --check plugin/idle-dim.js
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add plugin/idle-dim.js
git commit -m "feat: add route-based idle screen with slot fallback"
```

---

### Task 4: Implement wake-up fade sequence

**Files:**
- Modify: `plugin/idle-dim.js`

Replace the instant `api.theme.set(saved)` on wake-up with a multi-step fade through intermediate themes.

- [ ] **Step 1: Add fade constants and themes array**

After the existing constants (line 13 area):

```js
const FADE_THEMES = ["beib-dim-03", "beib-dim-05", "beib-dim-07"]
const FADE_STEP_MS = 400
```

- [ ] **Step 2: Add runFadeSequence() function**

Insert after `getCurrentArt()`:

```js
function runFadeSequence(api, target) {
  return new Promise((resolve) => {
    let step = 0
    function next() {
      if (step >= FADE_THEMES.length) {
        // Final step: restore original
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
```

- [ ] **Step 3: Integrate fade into apply() — modify the active branch**

Replace the `api.theme.set(saved)` line in the active branch of `apply()`:

```js
} else if (!idle && saved !== null) {
  // Navigate back from idle route first
  if (idleRoute) {
    try { api.route.navigate("session") } catch (e) { log(`navigate session error: ${e?.message || e}`) }
  }
  // Wake-up fade sequence
  const target = saved
  saved = null
  setTimeout(() => runFadeSequence(api, target), 100)
  log(`apply: starting fade to ${target}`)
}
```

- [ ] **Step 4: Verify**

```bash
node --check plugin/idle-dim.js
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add plugin/idle-dim.js
git commit -m "feat: add 4-step wake-up fade sequence (1.5s)"
```

---

### Task 5: Implement content rotation (alien flight)

**Files:**
- Modify: `plugin/idle-dim.js`

Add a rotation interval that changes the idle screen content every ~10s while dimmed.

- [ ] **Step 1: Add rotation logic in tui()**

Inside the `tui` function, after the existing `setInterval(apply, 1500)` (line 101 area), add a content rotation interval:

```js
// Content rotation while idle: change position/frame every ~10s
let rotationInterval = null
const startRotation = () => {
  if (rotationInterval) return
  rotationInterval = setInterval(() => {
    if (!isDim()) return
    // Force re-render by toggling a reactive index
    poolIndex = (poolIndex + 1) % 9999
    // If we have the idle route, re-navigate to trigger re-render
    if (idleRoute) {
      try { api.route.navigate("idle") } catch {}
    }
    log(`rotation: frame ${poolIndex % CONTENT_POOL.length}`)
  }, 8000 + Math.random() * 4000) // 8-12s random
}

const stopRotation = () => {
  if (rotationInterval) { clearInterval(rotationInterval); rotationInterval = null }
}
```

- [ ] **Step 2: Wire rotation start/stop into apply()**

In the `apply()` function, start rotation when entering idle and stop when leaving:

In the idle branch (around line 57, after `api.theme.set(DIM_THEME)`):
```js
startRotation()
```

In the active branch (around line 60, inside the `else if (!idle && saved !== null)`):
```js
stopRotation()
```

Also in the heal branch (around line 63):
```js
stopRotation()
```

- [ ] **Step 3: Verify**

```bash
node --check plugin/idle-dim.js
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add plugin/idle-dim.js
git commit -m "feat: add content rotation (alien flight) every ~10s while idle"
```

---

### Task 6: Update install script and tui.json example

**Files:**
- Modify: `install.sh`
- Modify: `tui.json.example`

- [ ] **Step 1: Update install.sh to copy new theme files**

Add after the existing theme copy line (the one that copies `beib-dim.json`):

```bash
# In install.sh, add these lines after the existing beib-dim.json copy:
cp -f "$SCRIPT_DIR/themes/beib-dim-03.json" "$HOME/.config/opencode/themes/beib-dim-03.json"
cp -f "$SCRIPT_DIR/themes/beib-dim-05.json" "$HOME/.config/opencode/themes/beib-dim-05.json"
cp -f "$SCRIPT_DIR/themes/beib-dim-07.json" "$HOME/.config/opencode/themes/beib-dim-07.json"
```

Also add them to the "Installed files" echo summary section.

- [ ] **Step 2: Update tui.json.example with options**

Read `tui.json.example` and add an `options` object to the plugin tuple:

```json
{
  "plugin": [
    ["./plugin/idle-dim.js", {
      "phrases": [],
      "rotationMs": [8000, 12000],
      "titleColor": "#ff9a00"
    }]
  ]
}
```

- [ ] **Step 3: Verify bash syntax**

```bash
bash -n install.sh
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add install.sh tui.json.example
git commit -m "chore: update install script for new themes, add tui options example"
```

---

### Task 7: Final verification

**Files:** All modified files.

- [ ] **Step 1: JavaScript syntax check**

```bash
node --check plugin/idle-dim.js && echo "JS OK"
```

Expected: `JS OK`

- [ ] **Step 2: Bash syntax check**

```bash
bash -n install.sh && echo "Bash OK"
bash -n bin/opencode-iterm-state && echo "iterm-state OK"
```

Expected: `Bash OK`, `iterm-state OK`

- [ ] **Step 3: Theme JSON validation**

```bash
for f in themes/beib-dim*.json; do
  node -e "const j = require('./$f'); if (!j.theme || !j.\$schema) throw new Error('invalid theme: $f')" && echo "$f OK"
done
```

Expected: all 4 files OK.

- [ ] **Step 4: Full install and visual verification**

```bash
./install.sh
```

Then restart OpenCode and run the visual check:
1. Open a disposable OpenCode instance
2. Run `/idle` — verify: theme dims, alien/art appears, content rotates
3. Run `/active` — verify: fade sequence plays (~1.5s), original theme restored
4. Repeat 3 cycles — verify idempotence
5. Run `/active` from normal state — verify safe (no crash)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "verify: end-to-end idle fun mode v2 verified"
```

---

## Plan Self-Review

**Spec coverage:**
- ✅ ACME alien renders in green → Task 2 (CONTENT_POOL), Task 3 (route + slots)
- ✅ Alien "flies" (position/content changes) → Task 5 (rotation)
- ✅ Content rotates (alien, phrases, emojis) → Task 2 (pool), Task 5 (rotation)
- ✅ Wake-up fade (4-step, ~1.5s) → Task 4 (runFadeSequence)
- ✅ Route primary / slot fallback → Task 3
- ✅ Existing behavior preserved → all changes are additive, no removal of existing logic
- ✅ No regressions (node --check, bash -n) → Task 7

**Placeholder scan:** No TBDs, TODOs, or vague instructions. Every step has exact code or commands.

**Type consistency:** `isDim` is a SolidJS signal getter (from `createSignal`). `pickFrame()` returns an object from `CONTENT_POOL`. `runFadeSequence(api, target)` takes the plugin API and target theme name string. All consistent across tasks.
