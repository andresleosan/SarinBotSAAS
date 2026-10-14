# Adelantos sin Firebase ni Ollama

Alcance aprobado por el propietario: extender Agenda clara a las pantallas internas, probar el recorrido completo con emuladores y añadir CI en GitHub. Ollama, la Mac y el túnel quedan fuera hasta nueva indicación.

## Diseño acordado

La interfaz usa el diseño ya elegido en `design-system.md`: canvas `#f7f9ff`, papel `#fff`, tinta `#162344`, texto secundario `#52617d`, líneas `#e0e6f1`, azul `#315ff3` y fondos suaves `#edf1ff`. DM Sans y rostro de Sarin. La navegación y los controles funcionales conservan SVG; la limpieza de etiquetas decorativas de la portada se mantiene. Se conservan AuthGate, permisos, persistencia y contratos API.

## Trabajo y verificación

- [x] Adaptar shell, acceso, agenda, configuración, QR, facturación, administración e isla. Revisar estados vacíos, errores y móvil de 320 px.
- [x] Adaptar Vault, tablas Markdown y diálogo de copias sin modificar IndexedDB ni sus handlers. Las pruebas automatizadas de persistencia y copias pasan; diálogos revisados en Chrome. El chooser de importación está limitado por el permiso de archivos de la extensión, documentado en QA.
- [x] Añadir un ensayo local repetible de negocio, reserva, colisión, cancelación/bloqueo, comprobante y aprobación idempotente. Solo proyecto demo, loopback y datos nuevos de cada corrida; limpieza acotada a esos datos.
- [x] Añadir CI de tipos, pruebas, reglas reales emuladas, recorrido local, builds y dry-run del Worker. Permisos de lectura, acciones oficiales fijadas por SHA y ninguna credencial/despliegue externo.
- [x] Ejecutar verificaciones conjuntas, revisar seguridad/diff, guardar pruebas visuales y push. CI real `38523876656`: tres jobs aprobados para `d761de4`.

## Límites

No crear proyectos externos, configurar facturación ni conectar modelos. La portada pública permanece en Pages; las pantallas privadas se revisan localmente hasta disponer de Firebase real. El CI verifica código y artefactos; no sustituye la aceptación con Firebase/Ollama reales ni bloquea por sí mismo el autodeploy de Pages.
