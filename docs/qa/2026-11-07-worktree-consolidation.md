# Consolidación local de Sarin Bot

Fecha: 7 de noviembre de 2026, America/Bogota.

El encargo del propietario autoriza consolidar main en `E:/Proyectos/Sarin Bot` y separar después Sarin Bot Hub de AgendIA. La revisión inicial encontró main ya publicado en `9d2f9c1`, posterior al `13b2cd8` citado en el encargo: no se duplicó el commit de declaración. Las cuatro pruebas locales adicionales se conservaron y publicaron como `57cf586`.

## Preservación

- Respaldo privado en `%LOCALAPPDATA%/SarinBot/backups/2026-11-07-hub-agendia`: 11.273 archivos, 237.031.600 bytes, comprobados individualmente por SHA-256. Incluye el Git original, índices, cambios staged/unstaged, documentos, assets, entorno local y archivos ignorados. `snapshot-manifest.json` identifica cada archivo. Solo se excluyeron cachés regenerables `node_modules` y `.next`; los enlaces se registraron sin seguirlos.
- Los originales completos, incluidas esas cachés, permanecen en `E:/SarinBot-migration-archive-20261107`. Las carpetas `E:/Proyectos/SarinBot-worktrees` y `E:/Proyectos/Sarin Bot pnpm-migration` ya no existen en su ubicación anterior. Se archivaron, no se destruyeron.
- La revisión automática bloqueó la retirada mediante `git worktree remove --force`. Se utilizó la alternativa conservadora: mover los árboles originales al archivo y ejecutar `git worktree prune --expire now` para retirar únicamente los registros de ubicaciones inexistentes.
- El worktree histórico `paid-trial` tenía cambios pendientes; quedaron preservados tanto en el respaldo verificado como en el archivo completo. Las otras ubicaciones de trabajo fuera del alcance permanecen intactas.
- Los archivos históricos de aplicación no se superpusieron sobre main. Tres pruebas antiguas exclusivas del checkout mixto quedaron fuera de la fuente activa, dentro del respaldo.
- Los documentos históricos/locales y la autoridad mutable Fresha permanecen en la raíz con exclusiones locales explícitas en `.git/info/exclude`; no se publicaron capturas privadas ni secretos. Las versiones distintas de documentos están disponibles en el respaldo, sin sustituir documentación más reciente de main.

## Continuidad y comprobaciones

- La raíz está en main. El commit `57cf586` se verificó publicado en origin/main.
- Pruebas de cambios preservados y declaración: siete archivos, 105 pruebas aprobadas.
- Instalación con Node 24.22.1, pnpm 11.23.0 y `--frozen-lockfile` correcta; lockfile conservado.
- Coordinador Fresha: 35 pruebas aprobadas. `check-plan --next` verifica 181 tareas y los 165 requisitos; siguiente tarea `R0-POLICY-B4`.
- `tasks.json` revisión 128 solo actualiza ubicación/layout. Tareas, estados, evidencias, requisitos, aprobaciones y preferencias son idénticos al respaldo. El visor se regeneró desde esa autoridad local.

Esta consolidación no acredita la finalización funcional del plan Fresha ni modifica flags, credenciales, webhooks o capacidades de producción.
