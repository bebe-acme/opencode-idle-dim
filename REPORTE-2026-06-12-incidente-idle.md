# Reporte de incidente: idle fun mode v2 dejaba la sesion inusable

Fecha: 2026-06-12. Estado: resuelto, commiteado en `main` (`6ebdb0b`), plugin arreglado ya instalado.

## Que pasaba (sintoma)

Al correr `/idle`, en vez de solo dimmear la TUI, la pantalla entera se reemplazaba por el alien ACME sobre fondo oscuro. No se veia nada del UI normal y no se podia tipear `/active` para volver. Ademas, cada sesion nueva de OpenCode que caia en ciertas terminales arrancaba directamente atrapada en esa pantalla.

## Causa raiz (dos problemas combinados)

1. **Ruta fullscreen sin prompt.** El v2 registraba una ruta de plugin `idle` con `api.route.register()` y navegaba a ella al dimmear. Las rutas de plugin en OpenCode renderizan **sin el prompt ni el editor**: una vez ahi, no hay donde tipear `/active`. La sesion parecia muerta.
2. **Rotacion que re-navegaba.** El timer de rotacion de contenido llamaba `api.route.navigate("idle")` cada 8 a 12 segundos. Aunque lograras escapar de la ruta, te devolvia al alien enseguida. Trampa perfecta.

Agravante: habia 8 flag files viejos acumulados en `~/.local/state/opencode-idle/` (ttys002, 003, 004, 011, 013, 016, 017, 018). Como el flag persiste a proposito, cualquier instancia nueva en esas TTYs se dimmeaba y navegaba a la ruta apenas arrancaba. El debug log muestra varios reinicios seguidos en ttys003 intentando salir: cada reinicio volvia a caer en la trampa.

## Rescate ejecutado

- Se removieron los 8 flags con `OPENCODE_ITERM_TTY=/dev/ttysNNN opencode-iterm-state active` (eso ademas destiño las tabs de iTerm2).
- Las 7 instancias vivas restauraron solas su theme (confirmado en `debug.log`: `apply: restore ok=true`).

## El fix (commit `6ebdb0b`)

Principio nuevo: **el plugin jamas toca `api.route`**. El contenido divertido vive solo en slots del sidebar, que nunca roban el foco ni el prompt.

- `sidebar_content` (modo append, seguro): frames rotando cada 8 a 12s. Alien ACME completo reescalado a 26 columnas para que no wrapee, alien mini, frases y emojis. Cierra con el hint `idle, /active to wake`.
- `session_prompt_right`: indicador de sueño al lado del prompt, visible aunque el sidebar este oculto.
- Reactividad por getters en props que leen signals de Solid (el mismo patron ya probado de `sidebar_title`); la rotacion solo hace bump de un signal, no navega nada.
- El fade de despertar quedo igual (beib-dim-03, beib-dim-05, beib-dim-07, theme original) y ahora restaura tu theme real (`opencode`), no `system` hardcodeado.
- `OPENCODE_IDLE_DIR` y `OPENCODE_IDLE_TTY` son inyectables por env para tests.

## Tests nuevos

`node --import ./test/register.mjs --test test/idle-dim.test.mjs`

Suite de `node:test` sin node_modules: un loader hook resuelve `@opentui/solid` y `solid-js` a stubs locales. Corre el ciclo completo (flag aparece, dim, contenido en sidebar, flag desaparece, fade en orden, restore) contra un mock del API y fija el invariante de que el plugin nunca llama `api.route`. Fallaba contra el codigo viejo, pasa contra el nuevo.

## Verificacion en runtime real

Instancia descartable de OpenCode 1.17.4 dentro de tmux:

- Flag puesto: theme dimmea en menos de 2s, guarda el theme previo correcto.
- Tipeo durante el idle: el texto aparece en el prompt (esto era exactamente lo roto).
- Sidebar: alien grande, luego alien mini, luego frase, rotando solo.
- Flag removido: fade 03 -> 05 -> 07 -> `opencode` en ~1.5s, contenido idle desaparece.

## Documentacion

La trampa quedo escrita en `handoff.md` como trap 7 (nunca usar rutas de plugin para pantallas idle) y trap 8 (reactividad en slots va por getters). README actualizado con el comportamiento nuevo y la seccion de tests.

## Accion pendiente tuya

Las instancias de OpenCode que ya estaban corriendo tienen el plugin viejo cargado en memoria. **Reinicia cada instancia abierta una vez** para que cargue el plugin arreglado de `~/.config/opencode/plugin/idle-dim.js`. Despues `/idle` y `/active` funcionan normal.
