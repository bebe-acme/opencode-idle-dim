# Handoff — opencode-idle-dim

Fecha: 2026-06-12. Estado: v1 funcionando y verificado visualmente. Este repo es el espejo canónico de la tool; las copias vivas instaladas en el sistema son las que OpenCode usa.

## Qué es esto

`/idle` dentro de una sesión de OpenCode dimmea toda la TUI (~85% más oscura, uniforme, como el dimming nativo de iTerm2) dejando el título del proyecto legible en naranja `#ff9a00`, y tiñe la tab de iTerm2 de claro. `/active` restaura todo. Persistente e independiente del foco. Mecanismo: flag file por TTY + plugin TUI que cambia el theme a `beib-dim`.

## Dónde vive lo instalado (fuente de verdad en runtime)

| Repo | Instalado |
| --- | --- |
| `bin/opencode-iterm-state` | `~/.local/bin/opencode-iterm-state` |
| `plugin/idle-dim.js` | `~/.config/opencode/plugin/idle-dim.js` |
| `themes/beib-dim.json` | `~/.config/opencode/themes/beib-dim.json` |
| `command/idle.md` / `command/active.md` | `~/.config/opencode/command/` (las instaladas usan path absoluto `/Users/beib/...`; las del repo usan `~`) |
| `tui.json.example` | `~/.config/opencode/tui.json` (`{"plugin": ["./plugin/idle-dim.js"]}`) |

Estado runtime: flags en `~/.local/state/opencode-idle/<tty>.flag`, debug en `~/.local/state/opencode-idle/debug.log`, theme persistido en `~/.local/state/opencode/kv.json`, estados legacy de colores iTerm en `~/.local/state/opencode-iterm-state/`.

**Si editás algo acá, re-instalá con `./install.sh` (o copiá a mano) y reiniciá las instancias de OpenCode.** Al revés: si tocás las copias instaladas, traé el cambio a este repo y commiteá.

## Verificación hecha (evidencia)

- Ciclo doble idle/active verificado con screenshots reales en una instancia desechable de OpenCode 1.17.4: dim uniforme total, título naranja legible, restore perfecto, segunda pasada idéntica.
- `node --check` y `bash -n` limpios.
- Idempotencia: `IDLE_ALREADY` en segundo `/idle`; `/active` seguro sin idle previo.
- Self-heal verificado: kv contaminado con `beib-dim` vuelve a `system` al arrancar sin flag.

## Trampas conocidas (no re-descubrir)

1. **No usar SIGUSR2** para refrescar el theme: aborta tool calls en vuelo en OpenCode (parecía "user aborted"). El plugin usa watcher + poll de 1.5s.
2. **No dimear vía paleta ANSI/AppleScript:** OpenCode renderiza en truecolor derivado del background; los blancos/paneles quedan brillantes. Por eso se cambia el theme entero.
3. **El slot `sidebar_title` es `single_winner` y decide el fallback en el render inicial:** nunca devolver null; cambiar solo el color reactivamente (signal de Solid + getter en props).
4. **Plugins TUI se registran en `tui.json`, no en `opencode.jsonc`** (el loader de server exige `server()` y falla).
5. iTerm2 bloquea `SetProfile` por escape code (banner de seguridad) y devuelve colores de 3 componentes (sin alpha) por AppleScript; el código legacy `dump`/`apply` ya lo maneja.
6. La detección de TTY camina el árbol de procesos porque el shell de tools no tiene `/dev/tty`. Override: `OPENCODE_ITERM_TTY`.

## Ideas / próximos pasos

- [ ] Auto-idle: escuchar el evento `session.idle` del sistema de plugins de OpenCode (o `api.event.on("session.status")`) para dimear solo tras N minutos sin actividad, sin `/idle` manual.
- [ ] Generador del theme: script `make-dim-theme.js` que tome el theme actual del usuario y genere `beib-dim.json` con multiplicador configurable (hoy el theme está hardcodeado a partir de la paleta de Beib, factor 0.15).
- [ ] Parametrizar color del título (`BRIGHT`) y nombre del theme vía `tui.json` options (`["./plugin/idle-dim.js", {...}]`).
- [ ] Soporte multi-terminal: el dim del theme ya es agnóstico; separar lo específico de iTerm2 (tab tint, locate/list) detrás de un check de `TERM_PROGRAM`.
- [ ] Publicar como plugin npm (`exports: {"./tui": ...}`) para instalar sin clonar.
- [ ] Screenshots/GIF para el README.

## Contexto de sesión previa

Construido en la sesión RSRCH de `/researchs` el 11-12 jun 2026. El dimming nativo de iTerm2 (Appearance > Dimming) quedó **deshabilitado** a propósito para que no se mezcle con este mecanismo. Profile Default de iTerm: bg `#022029`, fg `#ff9a00` (de ahí el naranja del título).
