# Handoff — opencode-idle-dim

Fecha: 2026-06-19. Estado: **v5 — dim estático (screensaver ELIMINADO por calor)** + coordinación de barra de tabs. Último cambio: se sacó TODO el screensaver/animación/overlay/fade/any-key del plugin; `/idle` ahora es un único `api.theme.set("beib-dim")` + tint de tab gris (cero timers, ~0% CPU mientras está parkeada). Antes (v4): overlay a pantalla completa con alien ACME rebotando / barra 8-bit, fade de 4 pasos, despertar-con-tecla. Este repo es el espejo canónico; las copias instaladas en el sistema son las que OpenCode usa en runtime.

## Qué es esto

`/idle` dentro de una sesión de OpenCode dimmea toda la TUI (theme `beib-dim`, ~15% de brillo, uniforme, switch **instantáneo** sin fade), pinta el tab de iTerm2 **gris**, pone el título del sidebar naranja y un `💤` al lado del prompt. `/active` (o ⌘K → Wake Up) restaura el theme guardado y el tab teal. Persistente e independiente del foco. **Mientras está parkeada NO corre ningún timer ni re-render** — ese es el punto de v5.

Mecanismo base (sin cambios desde v1): flag file por TTY (`~/.local/state/opencode-idle/<tty>.flag`) + plugin TUI que cambia el theme. Sin daemons, sin señales.

**Por qué se sacó el screensaver:** con ~11 sesiones parkeadas, el `setInterval` de animación (alien stepMs=110, progress stepMs=130) hacía que cada instancia de OpenCode re-renderizara el overlay + iTerm2/WindowServer redibujaran sin parar → 13-27% CPU por sesión dimmeada + ~115% iTerm2/WindowServer, sumando varios cores de calor con NADA trabajando. El dim por theme switch logra el objetivo (ver de un vistazo qué está parkeado) a costo cero. (Ver `docs/orchestrator-review.md` para el camino futuro del indicador activo/idle.)

## Dónde vive lo instalado (fuente de verdad en runtime)

| Repo | Instalado |
| --- | --- |
| `bin/opencode-iterm-state` | `~/.local/bin/opencode-iterm-state` |
| `plugin/idle-dim.js` | `~/.config/opencode/plugin/idle-dim.js` |
| `themes/beib-dim.json` | `~/.config/opencode/themes/beib-dim.json` |
| `themes/beib-dim-03/05/07.json` | `~/.config/opencode/themes/` (del fade viejo, **hoy sin uso**) |
| `command/idle.md` / `command/active.md` | `~/.config/opencode/command/` |
| `command/tabs-color.md` / `command/tabs-name.md` | `~/.config/opencode/command/` |
| `tab-aliases.conf.example` | `~/.config/opencode/tab-aliases.conf` (si no existe) |
| `tui.json.example` | `~/.config/opencode/tui.json` |

Estado runtime: flags en `~/.local/state/opencode-idle/<tty>.flag`, debug en `~/.local/state/opencode-idle/debug.log`, theme persistido en `~/.local/state/opencode/kv.json`.

**Workflow de edición:** editar en el repo → `cp -f plugin/idle-dim.js ~/.config/opencode/plugin/idle-dim.js` (o `./install.sh` para todo) → **reiniciar OpenCode** (el plugin se carga al arrancar; una instancia vieja sigue con el plugin viejo en memoria). Siempre commitear el cambio en el repo.

## Arquitectura actual (v5)

Todo en `plugin/idle-dim.js` (~218 líneas; era ~666 en v4). Sin savers, sin overlay (`app` slot eliminado), sin fade, sin keyhandler. Un solo signal `isDim` para el color del título y el `💤`.

- **`apply()`** (la máquina de estados, disparada por el flag):
  - lee `idle = existsSync(flag)`, llama `paintTab(idle ? "idle" : "active")`.
  - si `idle && saved === null` (ENTRAR): guarda `saved = api.theme.selected` (o `"system"`), `api.theme.set("beib-dim")`, `setDim(true)`. **Instantáneo, sin fade.**
  - si `!idle && saved !== null` (SALIR): `api.theme.set(saved)`, `saved = null`, `setDim(false)`.
  - si `!idle && api.theme.selected === "beib-dim"` (SELF-HEAL): `api.theme.set("system")` (quedó el theme dim persistido sin flag, ej. crash).
- **Slots** (los únicos que quedan):
  - `sidebar_title`: naranja (`BRIGHT=#ff9a00`) cuando `isDim()`, si no `ctx.theme.current.text`. **Nunca null** (es `single_winner`). Color por getter reactivo.
  - `session_prompt_right`: `💤` cuando `isDim()`, si no `""`. Estático.
- **`paintTab(state)`**: OSC 6 (`\033]6;1;bg;{red,green,blue};brightness;N`) directo a `/dev/<tty>`. **activa = teal `#529e99`** (`TAB_ACTIVE`), **idle = gris `#2b2b2b`** (`TAB_IDLE`). Sólo escribe en cambio de estado (`lastTabState`). Así toda sesión (incluso las que nunca corrieron `/idle`) toma el color activo al arrancar. El bash `send_idle/active_escape_codes` ya **no** toca el bg del tab (sólo limpia el badge).
- **Wake**: `/active` (saca el flag) o comando ⌘K "Wake Up" (`api.command.register` → `wakeUp()` corre `opencode-iterm-state active`). Ya **no** hay despertar-con-tecla (no hace falta: el prompt está vivo, podés tipear directamente; sin overlay nada "tapa" la sesión).
- **Watcher**: `fs.watch(DIR, …)` reacciona al instante; `setInterval(apply, 5000)` es sólo fallback/self-heal (era 1.5s en v4). Ambos `.unref?.()`.
- **Constantes** (arriba del archivo): `DIM_THEME="beib-dim"`, `BRIGHT="#ff9a00"`, `TAB_ACTIVE=[82,158,153]`, `TAB_IDLE=[43,43,43]`, `DIR`.

### Coordinación de toda la barra (`/tabs-color`, `/tabs-name`)

Dos subcomandos del bash (`opencode-iterm-state tabs-color|tabs-name`, expuestos como `/tabs-color` y `/tabs-name`) que operan sobre **todas** las sesiones de iTerm2 a la vez. Reusan el AppleScript `list`; los panes de un mismo tab salen en líneas **consecutivas** (loop window→tab→session), así que se agrupan por `(window,tab)` sin AppleScript nuevo. On-demand, no hay watcher. **No mueven ningún pane** (mover panes entre tabs solo lo hace la API Python de iTerm2, descartada por pesada).

- **`tabs-color`**: pinta cada tab por estado — **teal si CUALQUIER pane está activo, gris solo si TODOS están idle** (lee los flags `<tty>.flag`). Resuelve el tab mixto (idle+activo) que con el `paintTab` por-sesión quedaba ambiguo. Escribe OSC 6 a cada `/dev/<tty>` del tab. Salta panes no-opencode (shells, `ssh`, `btop`) detectados por NO tener `(node)` en el nombre ni `<tty>.flag/.info` (`_is_opencode_pane`).
- **`tabs-name`**: nombra cada tab `proj1:proj2` (basename del cwd de cada pane opencode, unidos con `:`; ambos panes reciben el combinado). El cwd sale por `lsof` del pid de opencode (`_project_label`; o de un `<tty>.info` si el plugin algún día lo publica). **Labels cortos vía `~/.config/opencode/tab-aliases.conf`** (`<path-o-basename>=<label>`, gana el match por path completo; `_alias_val` con awk); sin alias → basename. Beib eligió "basename + alias file" (ej. `opencode-idle-dim=DIMM`).

## Contexto del cambio v5 (fix de calor, 2026-06-19)

El gatillo fue calor/CPU alto sin nada trabajando (load 12-15, cores 76-90°C en un M5 Pro). Diagnóstico: (a) **3 MCP `@aaronsb/google-workspace-mcp` huérfanos** (PPID=1, sus opencode murieron) quemando ~3 cores; (b) el screensaver en ~11 sesiones parkeadas; (c) Chrome aparte; (d) presión de memoria (swap 96%). Se hicieron 3 tracks; **sólo el Track 2 (sacar el screensaver) toca este repo**. Los otros dos son sistema (fuera del repo):

- **Track 1 (sistema):** reorganización de MCP google-workspace de global → por proyecto (en `~/.config/opencode/opencode.jsonc` + `opencode.json` de cada proyecto), backup en `opencode.jsonc.bak-20260619-mcp-reorg`. Reaper de huérfanos: `~/.config/opencode/bin/reap-orphan-mcp.sh` + LaunchAgent `~/Library/LaunchAgents/com.beib.reap-orphan-mcp.plist` (cada 10 min, mata procs MCP con PPID==1 y sus descendientes). OJO: el google-workspace-mcp corre en DOS niveles (wrapper `npm exec` + hijo `node` caliente); matar sólo el PPID==1 deja vivo al hijo (reparenta a launchd) → hay que matar el subárbol.
- **Track 3 (este repo):** `docs/orchestrator-review.md` — review de orquestadores/indicadores activo-idle compatibles con OpenCode (Beib no quiere seguir customizando iTerm2 a mano).

## Trampas conocidas (no re-descubrir)

1. **No usar SIGUSR2** para refrescar el theme: aborta tool calls en vuelo. Se usa watcher + poll (5s).
2. **No dimear vía paleta ANSI/AppleScript:** OpenCode usa truecolor derivado del background; los blancos/paneles quedan brillantes. Por eso se cambia el theme entero.
3. **`sidebar_title` es `single_winner` y fija el fallback en el render inicial:** nunca devolver null; cambiar solo el color por getter reactivo.
4. **Plugins TUI van en `tui.json`, no en `opencode.jsonc`.**
5. iTerm2 bloquea `SetProfile` por escape code y devuelve colores de 3 componentes por AppleScript; el legacy `dump`/`apply` lo maneja.
6. Detección de TTY camina el árbol de procesos (el shell de tools no tiene `/dev/tty`). Override: `OPENCODE_ITERM_TTY`.
7. **NUNCA usar `api.route.register`/`navigate` para la pantalla idle.** Las rutas de plugin renderizan SIN el prompt → el usuario queda sin poder tipear `/active` (sesión "muerta"). Brickeó 8 TTYs el 2026-06-12 (ver `REPORTE-2026-06-12-incidente-idle.md`). El test fija el invariante: **cero `api.route`**. (En v4 esto se resolvía con el slot `app`; en v5 ni siquiera hay overlay, pero el invariante se mantiene.)
8. **Reactividad en slots por getters en props** (`get fg()`, `get children()`), no por re-ejecutar la función del slot. (En v5 sólo lo usan `sidebar_title` y `session_prompt_right`.)
9. **`api.theme.current.*` son objetos `RGBA`, no strings.** Pasarlos a `fg` funciona; al loguearlos se ven como `rgba(0.32,…)`.
10. **Nombre de tab: OSC 1 vs lock de iTerm.** Las sesiones nombradas a mano tienen "allow title setting" OFF y **descartan OSC 1** (probado en vivo). Por eso `tabs-name` usa AppleScript `set name of session`, que **sí** pega en sesiones locked. OJO: **dentro de `tell application "iTerm2"` la palabra `tab` es la clase tab de iTerm, NO el char TAB** → `offset of tab` falla mudo; parsear los pares `tty\tname` **antes** del bloque `tell` con `character id 9`. El **color** de tab (OSC 6) NO sufre el lock.
11. **No mover panes entre tabs:** el AppleScript de iTerm2 no puede (mantenimiento); solo la API Python (`async_set_tabs`). Descartado por requerir habilitar la API + `pip install iterm2`. Por eso "color inteligente por tab", no migrar panes.
12. **MCP google-workspace huérfano de dos niveles:** matar sólo el wrapper PPID==1 deja el hijo `node` caliente vivo (reparenta a launchd). Matar el subárbol completo. El reaper (Track 1) ya lo hace.
13. **(Histórico, v4)** El overlay vivía en el slot `app` (encima del prompt, footprint cero cuando no dim); el despertar-con-tecla iba por `api.renderer.keyInput.on("keypress")` porque `useKeyboard()` de @opentui/solid necesita el `RendererContext` y falla mudo desde un slot; los sprites usaban medios-bloques (`toHalfBlocks`/`scalePixels`) para píxeles cuadrados. **Todo eso se eliminó en v5.** Si algún día vuelve una animación, que sea **opt-in** y que se frene sola tras N segundos (no dejar `setInterval` vivo en sesiones parkeadas).

## Tests

```
node --import ./test/register.mjs --test test/idle-dim.test.mjs
```
Stubs de `@opentui/solid` y `solid-js` vía loader hook (`test/register.mjs` → `test/loader.mjs` → `test/stubs/`), sin node_modules. Cubre: **dim instantáneo** al aparecer el flag (`themeCalls == ["beib-dim"]`, sin pasos de fade), título naranja + `💤` en el prompt mientras dim, **restore instantáneo** (`["beib-dim","system"]`), y el invariante **cero `api.route`**. `OPENCODE_IDLE_DIR` y `OPENCODE_IDLE_TTY` inyectables por env. Estado: **1 pass** (~170ms; en v4 tardaba ~3.5s por los fades).

Verificación manual: `~/.local/bin/opencode-iterm-state idle` (crea flag), mirar la sesión, `~/.local/bin/opencode-iterm-state active` (restaura). `tail ~/.local/state/opencode-idle/debug.log` muestra `tab: painted idle …`, `apply: dim on …`, `apply: restored to …`.

## Historia reciente (commits clave)

- **(HEAD, este commit)** — **v5: se elimina el screensaver entero** (savers, sprites ACME, overlay `app`, fade in/out, animTick, despertar-con-tecla) por calor con muchas sesiones parkeadas. `/idle` queda como dim instantáneo por theme + tint de tab gris, cero CPU al estar parkeada. Test reescrito (dim/restore instantáneo + cero-route). README + handoff reescritos. (Parte del fix de calor; Track 1 = reorg MCP + reaper, en sistema; Track 3 = `docs/orchestrator-review.md`.)
- `7a282be` — comandos `/tabs-color` y `/tabs-name` (color teal/gris por tab any-active→teal; nombres `proj1:proj2` con alias file). Nombres por AppleScript (pega en sesiones locked).
- `e823465` — color de tab por estado, pintado por el plugin (`paintTab`): activa teal, idle gris. El bash deja de tintar el bg.
- `7f555ba` — docs: README v4 (screensavers, fade-in, wake con tecla).
- `9977b66` — alien = logo ACME del SVG (aspect-correct), fade-in al entrar, fix despertar-con-tecla, `.gitignore`, commitea `acme-alien-logo.png` + `REPORTE-2026-06-12-incidente-idle.md`.
- `f216a3d` — saca Pac-Man, alien medio-bloque, loading solo barra, un solo color.
- `6978234` — savers pluggables (random por /idle): alien, Pac-Man, barra LOADING + header.
- `a2e29a9` — screensaver DVD-bounce fullscreen vía slot `app`, dismiss con cualquier tecla.
- `6ebdb0b` — fix del incidente: saca la ruta fullscreen que dejaba sin `/active` (trampa 7).
- `ccdb5db` — comando ⌘K Wake Up.
- Cadena `7705f61`…`f5c0209` — fade de 4 pasos, cancelable.

Specs/planes: `.opencode/plans/1781358825007-proud-knight.md` (plan v5/heat-fix), `.opencode/plans/1781290888739-silent-moon.md` (plan v4). Incidente: `REPORTE-2026-06-12-incidente-idle.md`.

## Archivos

- `acme-alien-logo.png` — **commiteado**, era la fuente del sprite `ACME_PIXELS`. **Ya no lo usa el plugin** (v5 sin sprite); se conserva como histórico.
- `themes/beib-dim-03/05/07.json` — pasos intermedios del fade viejo. **Sin uso en v5**; se conservan por si vuelve un fade opt-in.
- `.playwright-mcp/` — ignorado vía `.gitignore`.

## Próximos pasos / ideas

- [ ] Si vuelve animación, que sea **opt-in por `tui.json`** y **auto-freeze tras N segundos** (nunca dejar `setInterval` vivo en sesiones parkeadas).
- [ ] Borrar de verdad `themes/beib-dim-03/05/07.json` + `acme-alien-logo.png` del repo e install.sh si se confirma que no vuelve el fade/sprite.
- [ ] `tabs-name`: que el plugin publique `<tty>.info` con el cwd, para no depender de `lsof`.
- [ ] Auto-idle: plugin de evento (`event` hook) escuchando `session.idle`/`session.status` para dimear tras N min sin actividad (OJO: el TUI plugin `tui(api)` es otra forma que el plugin de eventos estándar; verificar si `api` expone `api.event` o hace falta un plugin separado).
- [ ] Indicador activo/idle centralizado: ver `docs/orchestrator-review.md`.
- [ ] Multi-terminal: separar lo de iTerm2 (tab tint) detrás de `TERM_PROGRAM`.

## Contexto

iTerm2 Profile Default: bg `#022029`, fg/accent `#ff9a00` (de ahí el naranja). El dimming nativo de iTerm2 está deshabilitado a propósito. Beib: MacBook Pro M5 Pro (Mac17,9, 18-core, 64GB), OpenCode 1.17.8.
