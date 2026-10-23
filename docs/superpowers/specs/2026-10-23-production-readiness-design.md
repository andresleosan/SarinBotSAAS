# Corrección de bloqueos para publicar P1

## Intención y alcance autorizado

Tras preguntar por commit/push y confirmar que `main` despliega producción, el titular pidió ayuda para resolver D1, la auditoría y la validación pendiente. Se conserva el producto de P1 en `3351698`; no se diseñan funciones nuevas. Las decisiones técnicas siguientes corresponden al implementador, no a preferencias atribuidas al titular.

## Comportamiento que se conserva

Una continuación obsoleta no autoriza un envío ni debe impedir alcanzar el trabajo vigente dentro del escaneo acotado. Una comprobación negativa temprana puede rechazar trabajo inequívocamente obsoleto; nunca concede autoridad positiva. Todo efecto vigente conserva su comprobación completa, reciente y transaccional de identidad, consentimiento, conexión, revisión y CAS. Se conservan la cancelación privada, reservas, estados inciertos, idempotencia y una sola réplica.

El caso D1 de arranque en frío conserva cincuenta continuaciones, paginación 25×4, las variantes prepared/claimed y expired/stale-authority, todas sus aserciones y el plazo original de 30 segundos. No se admiten más plazo, menos datos, tests omitidos o una suite filtrada presentada como completa.

## Evidencia y enfoque mínimo

La investigación externa de `3351698` encontró múltiples comprobaciones de autoridad y preparación de identidad antes de rechazar el head obsoleto. Una única comparación instrumentada pasó aislada (18,531/17,994 s), pero midió aproximadamente 2.100 lecturas en la recuperación de cada caso y cuatro pruebas de trabajo repetidas. No reprodujo el timeout de la suite ni prueba estabilidad. La preparación de cincuenta filas costó aproximadamente un segundo: no justifica debilitar el fixture.

Se elige rechazar primero el head inequívocamente ajeno al trabajo, antes de dependencias y preparación de identidad innecesarias. Se descartan ampliar el plazo, caché de autoridad positiva, concurrencia masiva de envíos y cambios del fixture: ocultan el coste o alteran garantías. El guard solo adelanta un rechazo necesario; el predicado completo y los fences existentes siguen siendo obligatorios para trabajo vigente. Si se comparte código de comprobación, el refactor conserva exactamente esas garantías y la normalización de advance.

Para seguridad se elige la actualización exacta mínima `next: 16.4.0 → 16.4.1`, con el mismo pnpm 11.23.0 y el lockfile compartido. React/React DOM 19.3.0 y Sharp 0.35.5 permanecen. La auditoría actual confirmó dos críticas y una alta; [la versión oficial 16.4.1](https://github.com/vercel/next.js/releases/tag/v16.4.1) corrige las tres. No se usa audit fix indiscriminado ni actualización mayor.

## Restricciones

- Node 24, pnpm 11.23.0; preservar un único `pnpm-lock.yaml`, con cambios únicamente necesarios para el parche.
- Trabajar en el worktree aislado existente; no desarrollar ni publicar desde el checkout mixto E: ni modificar source-restoration.
- Conservar AuthGate, consentimiento, payloads/rutas, generación de enlaces y contratos comerciales. No registrar cuerpos privados.
- Solo `alsdevstudio.com` como hostname del motor. Pruebas con proyecto demo y proveedores simulados; sin envíos, pagos ni activaciones reales.
- El push a main es publicación. El verde local, la CI remota y la identidad desplegada son evidencias distintas.

## Aceptación

Regresiones deterministas prueban que los registros obsoletos se rechazan sin lecturas de identidad ajenas, sin efecto y sin saltarse autorización posterior. La integración D1 completa conserva sus casos y plazos. Auditoría sin críticas/altas, suite completa sin filtros, tipos, builds de app/landing/Pages, gateway, reglas/journey de emulador y Worker check se ejecutan sobre el contenido final y conservan resultados reales.

La comprobación audible y el zoom nativo solo se declaran aprobados si se observan realmente. La identidad de Pages/Worker/Container requiere metadata actual y procedencia; un HTTP 200 o un whoami exitoso no la acreditan. Las observaciones que necesiten participación humana o acceso externo permanecen explícitas hasta obtenerlas.
