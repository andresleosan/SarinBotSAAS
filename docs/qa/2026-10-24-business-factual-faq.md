# FAQ factual mínima — QA local del 24 de octubre de 2026

Base compuesta `4999faa63fc9fd475db2e4e8907c472bbd0d57e3`; rama `codex/business-factual-faq-20261024`, implementación final `db9158e`. S07 permanece publicado y cerrado. Se ejecutó el siguiente pendiente de la composición, orden9, desde su diseño/plan aprobados; solo esos dos documentos se trasladaron desde E:, sin modificar ese checkout mixto.

## Resultado funcional

Tres temas fijos (`parking`, `accessibility`, `onsite_payment_methods`), respuestas literales normalizadas de hasta400caracteres/tresLF. Editor separado `/dashboard/faq`, revisión de diferencias, confirmación local y PUT recuperable por ID/huella/CAS. Dos hijos privados; ninguna FAQ en Business, proyección pública, prompt, transcript o almacenamiento del navegador. Cliente consulta un tema/revisión explícitos con permisos/política vigentes, sin acciones ni cuota de IA.

## Validación

| Comprobación | Resultado observado |
| --- | --- |
| Modelo/dominio/rutas/hooks/panel/integración y respaldo D1/R2 | 86 aprobadas en8archivos antes de las correcciones finales. |
| D1 real ampliado | 5/5: concurrencia, respuesta perdida/journal, replay posterior, política y Worker anterior sin medias escrituras. |
| Correcciones de revisión | Dos Important reproducidos RED→GREEN; 40/40 en editor, autoridad y rebooking; denegación conocida también cubierta. |
| Suite completa final estable | 4200aprobadas,0fallos,36omitidas;271archivos aprobados,0fallidos; exit0 sobre código establedb9158e. |
| Firestore real, reglas+Admin | 34/34 aprobadas:14 reglas y20 Admin; exit0 en emulador oficial con Java21. |
| TypeScript / build Next | Exit0; build final compilación/tipos/generación. |
| Worker | 160pruebas, tipos y dry-run exit0. |
| Auditoría | Cero vulnerabilidades conocidas; lockfile idéntico, SHA256 `f035b6bd0ddb862b899be3e15ec8115cf0a47ac508f8d1e644899aa902e12358`. |

La suite general omite suites opt-in; Firestore se ejecuta aparte. Journey y proveedor en vivo no se reejecutaron en este incremento; no se atribuye una prueba nueva a los recibos verdes de S07. No hubo push, merge o despliegue de FAQ ni mutaciones productivas. No hacen falta migraciones SQL: Worker debe admitir ambos hijos antes de publicar la app.

## Navegador real

Demo exclusiva `demo-sarin-bot`, localhost3049 y emuladores locales; guard de red y entorno sin credenciales productivas. El fixture inicial creó11documentos de negocio/permisos y cero citas, cero conversaciones, revisiónFAQ0. Se guardaron dos respuestas por UI, revisión1/recibo1. Un segundo comando por la API dueña local guardó revisión2/recibo2, cambió estacionamiento y retiró pagos.

Se observaron lista antigua→409→texto anterior retirado→nueva elección explícita→respuesta actualizada. La pregunta retirada desapareció. HTML se mostró literal, fuera del transcript/formulario. La transición sintética de política general1→salud2 retiró el chat/FAQ al actualizarse la lectura de política; volvió a general3 conservando FAQ/recibos. No se ejercitó una confirmación incierta en navegador: su aislamiento, consentimiento/época y carreras están cubiertos por automatización.

En Mi negocio se dejó `Borrador FAQ sin guardar`, abrió la gestión en otra pestaña y se verificó el valor original intacto. La configuración persistida conservó el nombre del fixture; no hubo POST agregado. Al cierre se cerró la sesión y ambas pestañas propias y se restableció el viewport. Wrapper local detenido, evidencia conservada. Inventario final: cero citas, cero conversaciones, revisiónFAQ2/dosrecibos y política3. No se restauraron ni purgaron datos para simular rollback.

| Vista | Evidencia |
| --- | --- |
| Editor390px, guardado y texto literal | [owner-390.png](2026-10-24-business-factual-faq-evidence/owner-390.png) |
| Editor320px | [owner-320.png](2026-10-24-business-factual-faq-evidence/owner-320.png) |
| Cliente1280px, FAQ separada | [client-1280.png](2026-10-24-business-factual-faq-evidence/client-1280.png) |
| Conflicto390px y nueva elección | [client-conflict-390.png](2026-10-24-business-factual-faq-evidence/client-conflict-390.png) |
| Política salud: FAQ retirada | [client-policy-closed-390.png](2026-10-24-business-factual-faq-evidence/client-policy-closed-390.png) |
| Borrador de configuración conservado | [configuration-draft-390.png](2026-10-24-business-factual-faq-evidence/configuration-draft-390.png) |

Anchos efectivos medidos:320/390, scrollWidth305/375, sin desbordamiento horizontal. El primer screenshot inmediatamente después del cambio de viewport aún reflejó el layout anterior; no se utilizó como prueba responsive. Zoom nativo200% y lector audible no observados, sin pase atribuido.

## Revisión y fallos preservados

Una revisión independiente de `4999faa..950e612`+testsTask5 encontró cero Critical y dos Important. Se cerraron en una pasada TDD: un fallo temporal del sondeo de negocio ya no pierde borrador/recuperación (disponibilidad separada de identidad;401/403 conocido purga); un GET anterior ya no reemplaza la revisión confirmada por PUT. No se solicitó re-review del mismo diff.

Minor nuevo diferido: consultar recibo durante WebCrypto aún en preparación puede mostrar estado incierto; si el hash falla puede requerir Actualizar. También se ignora elegibilidad fresca durante esa preparación; CAS/autoridad/política del servidor impiden aplicar un comando no autorizado. La fase explícita preparación/enviado queda pendiente. MinorCRM de S07 permanece diferido y no se modificó.

Primer pase completo:4190aprobadas/6fallidas/36omitidas. Dos fallos del fixture de compatibilidad dependían del literal anterior de la allowlist; cuatro dobles de Auth de rebooking omitían época/isCurrentSession. Se actualizaron los fixtures y se añadió el Worker anterior a FAQ sin escrituras parciales, sin debilitar permisos. Segundo pase4200/0/36; el pase estable final incluye además la denegación conocida añadida después de iniciar ese segundo pase.

Firestore inicial33/1: el fixture nuevo simuló Date.now y rompió los deadlines reales gRPC. El fixture admite un now explícito y el test Admin usa reloj real; no se cambiaron producto, plazos o dependencias para pasar. Fallos iniciales de D1/migración/tipos también se conservan: discriminador de comando de test, siembra de FAQ omitida y timezone faltante en fixture. La prueba inicial de salud del chat usó una ruta de health incorrecta; se corrigió a `/api/sarin/health` y exige un sondeo inicial real, sin llamadas adicionales por FAQ.

Recibos externos: `../work/faq-*-result.json`, `faq-first-*`, `faq-second-*`, logs originales y `.superpowers/sdd/2026-10-22-business-factual-faq/`. Demo/fixtures: `../work/faq-qa-runs/`; fuente auxiliar, manifiestos y recibos preservados fuera de Git. Decisiones: mantener Next16.4.1 publicado y lock en vez del16.4.0 histórico; conservar workspace/evidencia según el titular.

Siguiente incremento funcional tras integrar este trabajo: resumen operativoS17, orden10. No adelantar Task7S05 hasta S12 ni habilitar S08/S11/S12/salud/menores en este incremento. La preparación de publicación exige Worker compatible y rollback con enforcementS09; no elimina FAQ/recibos ni restaura datos para revertir UI.
