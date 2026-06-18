# Handoff — opencode-idle-dim

Fecha: 2026-06-13. Estado: **v4 (screensaver system)** instalado y commiteado. Último cambio: alien = **logo ACME rasterizado del SVG** (aspect-correct, sin deformar), **fade-in al entrar** en idle, y **despertar con cualquier tecla arreglado** (binding directo en `api.renderer.keyInput`). Verificación visual de Beib: ✅ OK (alien, fade-in y wake-con-tecla confirmados en vivo). Este repo es el espejo canónico; las copias instaladas en el sistema son las que OpenCode usa en runtime.

## Qué es esto

`/idle` dentro de una sesión de OpenCode dimmea toda la TUI (theme `beib-dim`, ~15% de brillo, uniforme) y muestra un **screensaver a pantalla completa** elegido al azar. `/active` restaura con un fade de 4 pasos. Persistente e independiente del foco. Pensado para tener muchas sesiones de OpenCode en tabs/splits de iTerm2 y ver de un vistazo cuáles están parkeadas.

Mecanismo base (sin cambios desde v1): flag file por TTY (`~/.local/state/opencode-idle/<tty>.flag`) + plugin TUI que cambia el theme y pinta el overlay. Sin daemons, sin señales.

## Dónde vive lo instalado (fuente de verdad en runtime)

| Repo | Instalado |
| --- | --- |
| `bin/opencode-iterm-state` | `~/.local/bin/opencode-iterm-state` |
| `plugin/idle-dim.js` | `~/.config/opencode/plugin/idle-dim.js` |
| `themes/beib-dim.json` + `beib-dim-03/05/07.json` | `~/.config/opencode/themes/` |
| `command/idle.md` / `command/active.md` | `~/.config/opencode/command/` |
| `tui.json.example` | `~/.config/opencode/tui.json` |

Estado runtime: flags en `~/.local/state/opencode-idle/<tty>.flag`, debug en `~/.local/state/opencode-idle/debug.log`, theme persistido en `~/.local/state/opencode/kv.json`.

**Workflow de edición:** editar en el repo → `cp -f plugin/idle-dim.js ~/.config/opencode/plugin/idle-dim.js` (o `./install.sh` para todo) → **reiniciar OpenCode** (el plugin se carga al arrancar; una instancia vieja sigue con el plugin viejo en memoria). Siempre commitear el cambio en el repo.

## Arquitectura actual (v4)

Todo en `plugin/idle-dim.js` (~430 líneas). El idle fun mode es un **overlay en el slot `app`**, NO en el sidebar y NO en rutas.

- **Slot `app`**: OpenCode lo renderiza por encima de toda la app, después del route activo, SIN reemplazar el prompt. Devolvemos un `box` absoluto a pantalla completa (zIndex 9999, fondo negro) **solo cuando `isDim()`**; cuando no, tamaño 0 / sin fondo (footprint cero). Reactividad por getters en props (`get position()`, `get children()`, etc.) que leen los signals `isDim` y `animTick`.
- **Savers pluggables**: `SAVERS = [makeAlienSaver(), makeProgressSaver()]`. `pickSaver()` elige uno **al azar en cada `/idle`**. Contrato de cada saver:
  ```js
  { name, stepMs, reset(w,h), tick(w,h), render(w,h,color) -> nodes[] }
  ```
  `startSaver()` corre un `setInterval(activeSaver.stepMs)` que llama `tick(w,h)` y hace `bumpAnim` (un signal que dispara el re-render del getter). `stopSaver()` limpia. Todos los timers con `.unref?.()`.
- **Saver 1 — alien (DVD bounce)**: `makeAlienSaver`. El **logo ACME** rasterizado del SVG (ver abajo) que rebota por la pantalla (rebota en bordes, área `y ∈ [3,h)`). Grilla nativa 10×7 px, escalada 2× con `scalePixels` y dibujada con **medios-bloques** → 20 cols × 7 filas, aspect ratio 10:7 exacto.
- **Saver 2 — progress (loading 8-bit)**: `makeProgressSaver`. SOLO una barra pixelada: frame de bloques `█` + 12 segmentos chunky de 2 anchos que se llenan y loopean (sube `pct`, al 100% hold ~1.3s y reset). Sin la palabra "LOADING" (Beib la sacó: quedaba enorme).
- **Un solo color**: `savedAccent` se captura del theme activo **antes** de dimmear, en `apply()`: `api.theme.current.primary || .accent || .text || BRIGHT`. Se pasa a `render(w,h,color)` y se usa en alien, barra, header y hint. Si la terminal de Beib es naranja, todo sale naranja. (Antes el alien hacía color-flip arcoíris en cada rebote; se eliminó por pedido.)
- **Header de identidad (CRÍTICO)**: como el overlay tapa el `sidebar_title`, el overlay dibuja arriba-izquierda (rendered last, encima del saver) dos líneas: `▶ <nombre>` (color accent) + la carpeta (gris `#8a8a8a`). El nombre se captura del slot `sidebar_title` (`props.title → lastTitle`); la carpeta de `api.state.path.directory || worktree || process.cwd()`, abreviada con `~`. Los 3 primeros renglones quedan reservados para que el saver no lo tape.
- **Dismiss**: cualquier tecla, vía binding directo `api.renderer.keyInput.on("keypress", …)` en `ensureKeyHandler()` (idempotente, re-intentado en cada render del slot hasta que el renderer exista) + comando ⌘K "Wake Up (exit idle)" (`api.command.register`, deprecado pero funcional) + `/active`. Los tres corren `wakeUp()` que ejecuta `opencode-iterm-state active`. **No usar `useKeyboard()` de @opentui/solid desde un slot**: necesita el `RendererContext` de Solid y falla silenciosamente (así estuvo roto el wake-con-tecla). `api.renderer` ES el `CliRenderer` (confirmado en `@opencode-ai/plugin` tui.d.ts).
- **Otros slots**: `sidebar_title` (título naranja + captura de `lastTitle`, nunca null), `sidebar_content` (mini alien fallback, garantiza algo visible si el overlay no pinta), `session_prompt_right` (💤 al lado del prompt).
- **Fade de ENTRADA** (`runFadeInSequence`, guard `fadingIn`): al aparecer el flag pasa original → `beib-dim-07` → `-05` → `-03` → `beib-dim` (oscurece gradual, 400ms/paso). El overlay+saver **recién se muestran al llegar a `beib-dim`** (`setDim(true)` en el callback `onDim`), así se ve oscurecer antes de aparecer el screensaver. Si el flag desaparece a mitad (despertaste rápido) aborta y vuelve al theme original.
- **Fade de DESPERTAR**: `runFadeSequence` pasa `beib-dim` → `beib-dim-03` → `-05` → `-07` → theme original, 400ms por paso (~1.6s). Cancelable: si reaparece el flag aborta y vuelve a `beib-dim`; `fading` guard evita fades duplicados; `saved` se preserva en abort.
- **Color del tab (iTerm2)**: lo pinta el **plugin** (`paintTab`), no el bash. Escribe OSC 6 (`\033]6;1;bg;{red,green,blue};brightness;N`) directo a `/dev/<tty>` según el flag: **activa = teal `#529e99`** (`TAB_ACTIVE`, el mismo accent que el alien de idle), **idle = gris `#2b2b2b`** (`TAB_IDLE`). Se llama en `apply()` con `paintTab(idle ? "idle" : "active")` y sólo escribe en cambio de estado (`lastTabState`). Así toda sesión (incluso las que nunca corrieron `/idle`) toma el color activo al arrancar. El bash `send_idle/active_escape_codes` ya **no** toca el bg del tab (sólo limpia el badge) para no pelear con el plugin. Para cambiar colores: `TAB_ACTIVE`/`TAB_IDLE` en el plugin.

### Medios-bloques (fix del alien deforme)

En terminal cada char es ~2:1 (más alto que ancho), así que un sprite full-block se ve **estirado**. Solución: `toHalfBlocks(rows)` toma una grilla de píxeles (strings, `#`=lleno) y combina cada par de filas en una fila de chars usando `▀▄█` → píxeles cuadrados. `scalePixels(rows, sx, sy)` agranda la grilla por factores enteros sin deformar (para hacer el sprite más grande manteniendo aspect ratio). **Para cualquier sprite nuevo, usar este patrón.**

**El alien ACME** (`ACME_PIXELS`) se rasterizó directo del SVG (`acme-alien-logo.png`/SVG, viewBox 362.78×259.62 sobre grilla de 30.71u → 10 cols × 7 filas de píxeles; cada celda del logo = 1 `#`). Se escala `scalePixels(ACME_PIXELS, 2, 2)` → 20×14 px → `toHalfBlocks` → 20 cols × 7 char-rows, aspect 10:7 exacto. El `MINI_ALIEN` (sidebar) usa el mismo `ACME_PIXELS` a tamaño nativo. **Si rehacés el sprite, editá `ACME_PIXELS` (es la fuente) y previsualizá con un script node antes de embeber.**

## Cómo agregar un saver nuevo

1. Escribir `makeXSaver()` que devuelva `{ name, stepMs, reset(w,h), tick(w,h), render(w,h,color) }`. `render` devuelve nodos `el(...)` posicionados absolutos; usar `color` (el accent) para un solo color; reservar `y ∈ [3,h)`.
2. Agregarlo a `SAVERS`.
3. Para sprites, definir grilla de píxeles + `toHalfBlocks`. Previsualizar con un script node en `/tmp` antes de embeber (así se hizo el alien y la barra).
4. `node --check`, correr el test, `cp` a runtime, reiniciar OpenCode, probar.

## Trampas conocidas (no re-descubrir)

1. **No usar SIGUSR2** para refrescar el theme: aborta tool calls en vuelo. Se usa watcher + poll de 1.5s.
2. **No dimear vía paleta ANSI/AppleScript:** OpenCode usa truecolor derivado del background; los blancos/paneles quedan brillantes. Por eso se cambia el theme entero.
3. **`sidebar_title` es `single_winner` y fija el fallback en el render inicial:** nunca devolver null; cambiar solo el color por getter reactivo.
4. **Plugins TUI van en `tui.json`, no en `opencode.jsonc`.**
5. iTerm2 bloquea `SetProfile` por escape code y devuelve colores de 3 componentes por AppleScript; el legacy `dump`/`apply` lo maneja.
6. Detección de TTY camina el árbol de procesos (el shell de tools no tiene `/dev/tty`). Override: `OPENCODE_ITERM_TTY`.
7. **NUNCA usar `api.route.register`/`navigate` para la pantalla idle.** Las rutas de plugin renderizan SIN el prompt → el usuario queda sin poder tipear `/active` (sesión "muerta"). Brickeó 8 TTYs el 2026-06-12 (ver `REPORTE-2026-06-12-incidente-idle.md`). **La solución correcta es el slot `app`** (overlay encima, prompt sigue vivo abajo). El test fija el invariante: cero `api.route`.
8. **Reactividad en slots por getters en props** (`get fg()`, `get children()`), no por re-ejecutar la función del slot. El saver hace bump de `animTick` y los getters lo leen.
9. **Aspect ratio:** sprites full-block se ven estirados; usar `toHalfBlocks` (trampa 2026-06-13).
10. **El overlay `app` debe ser footprint-cero cuando NO está dim** (width/height 0, sin backgroundColor) o tapa la sesión normal. Todo por getters condicionados a `isDim()`.
11. **Teclado**: `useKeyboard()` de @opentui/solid necesita el `RendererContext` de Solid; desde un slot getter no lo tiene y falla mudo (no despierta con tecla). Usar `api.renderer.keyInput.on("keypress", …)` directo (`api.renderer` es el `CliRenderer`). El listener NO consume el evento, así que no rompe el tipeo (trampa 2026-06-13).
12. **`api.theme.current.*` son objetos `RGBA`, no strings.** Pasarlos a `fg` funciona; al loguearlos se ven como `rgba(0.32,…)` (sólo la stringificación). El accent del saver se captura así, antes de dimmear.

## Tests

```
node --import ./test/register.mjs --test test/idle-dim.test.mjs
```
Stubs de `@opentui/solid` y `solid-js` vía loader hook (`test/register.mjs` → `test/loader.mjs` → `test/stubs/`), sin node_modules. El stub de opentui solo exporta `createElement`/`spread` (por eso `useKeyboard` se accede como `otui.useKeyboard`, undefined en test). Cubre: dim al aparecer el flag, contenido idle en `sidebar_content`, fade en orden (03, 05, 07, original), restore, y el invariante **cero `api.route`**. `OPENCODE_IDLE_DIR` y `OPENCODE_IDLE_TTY` inyectables por env. Estado: **1 pass**.

Verificación manual: `~/.local/bin/opencode-iterm-state idle` (crea flag), mirar la sesión, `~/.local/bin/opencode-iterm-state active` (restaura). `tail ~/.local/state/opencode-idle/debug.log` muestra `saver: picked <name>`, `accent=...`, y errores si los hay.

## Historia reciente (commits clave)

- **(HEAD, este commit)** — **color de tab por estado**, pintado por el plugin (`paintTab`): activa = teal `#529e99` (el accent del alien de idle), idle = gris `#2b2b2b`. El bash deja de tintar el bg del tab (sólo limpia badge). Docs (README, handoff, comandos `idle`/`active`) actualizadas.
- `7f555ba` — docs: README reescrito para v4 (screensavers, fade-in, wake con tecla).
- `9977b66` — alien = logo ACME rasterizado del SVG (aspect-correct vía `scalePixels`+`toHalfBlocks`), **fade-in al entrar** (`runFadeInSequence`), **fix despertar-con-tecla** (binding directo en `api.renderer.keyInput`, ya no `useKeyboard`), saca `ACME_GREEN` sin uso, agrega `.gitignore`, commitea `acme-alien-logo.png` (fuente del sprite) + `REPORTE-2026-06-12-incidente-idle.md`.
- `f216a3d` — saca Pac-Man, alien medio-bloque (píxeles cuadrados), loading solo barra, un solo color del theme accent.
- `6978234` — sistema de savers pluggables (random por /idle): alien chico, Pac-Man con fantasmas, barra LOADING 8-bit + header de identidad.
- `a2e29a9` — screensaver DVD-bounce fullscreen vía slot `app` (sin rutas), dismiss con cualquier tecla.
- `6ebdb0b` — **fix del incidente**: saca la ruta fullscreen que dejaba sin `/active` (trampa 7).
- `ccdb5db` — comando ⌘K Wake Up.
- Cadena `7705f61`…`f5c0209` — fade de 4 pasos, cancelable, guard de duplicados, preservación de `saved`.

Specs/planes: `docs/superpowers/specs/2026-06-12-idle-fun-mode-design.md`, `docs/superpowers/plans/2026-06-12-idle-fun-mode-plan.md`, `.opencode/plans/1781290888739-silent-moon.md` (plan v4). Incidente: `REPORTE-2026-06-12-incidente-idle.md`.

## Archivos (resuelto en el commit HEAD)

- `REPORTE-2026-06-12-incidente-idle.md` — **commiteado** (documenta la trampa 7).
- `acme-alien-logo.png` — **commiteado**, fuente del sprite `ACME_PIXELS`.
- `.playwright-mcp/` — **ignorado** vía `.gitignore`.

## Próximos pasos / ideas

- [x] ~~Verificación visual de Beib~~ — OK (alien ACME proporcionado, fade-in, despertar-con-tecla confirmados en vivo 2026-06-13).
- [ ] Posibles savers nuevos: starfield/warp, matrix rain, acuario, snake. Mismo contrato + `toHalfBlocks` (+ `scalePixels` si querés agrandar).
- [ ] Actualizar `README.md` (sigue describiendo el sidebar rotativo de v2, no el screensaver de v4).
- [ ] Auto-idle: `api.event.on("session.status"/"session.idle")` para dimear tras N min sin actividad.
- [ ] Opciones por `tui.json` (`["./plugin/idle-dim.js", { accent, savers, ... }]`): hoy el plugin ignora el segundo arg `options`.
- [ ] Multi-terminal: separar lo de iTerm2 (tab tint) detrás de `TERM_PROGRAM`.
- [ ] Publicar como plugin npm (`exports: {"./tui": ...}`).

## Contexto

iTerm2 Profile Default: bg `#022029`, fg/accent `#ff9a00` (de ahí el naranja). El dimming nativo de iTerm2 está deshabilitado a propósito. Beib: MacBook Pro M5 Pro, OpenCode 1.17.4.
