# Resumen operativo del dueño — protocolo

Usar exclusivamente un proyecto `demo-*`, cuentas sintéticas, red local aislada y los runners del repositorio. Node24 y pnpm11.23.0; conservar lockfile y evidencias. No llamar al motor, enviar mensajes, registrar pagos o modificar citas reales.

## Contrato y almacenamiento

1. Ejecutar `tests/owner-operation-summary-{model,domain,routes,d1}.test.ts`. Rango inclusivo de1–31 días, dentro de hoy−365..hoy en Colombia. Rechazar fechas imposibles, parámetros duplicados/extra y cuerpo en GET.
2. Dueño vigente únicamente; cliente/otro dueño/superadmin ajeno no obtienen bypass. Historia propia sigue legible con plan vencido y sin añadir un consentimiento nuevo.
3. Una transacción lee el negocio y una consulta de citas por `dateKey`, orden ascendente, límite1000.999 documentos recuperados son admisibles;1000 producen413 sin totales parciales, incluidos bloqueos. No escribir al leer.
4. Clasificar una vez cada documento válido por estado actual. Separar bloqueos, registros inválidos y confirmadas sin fin verificable. Terminaron sin resultado es subconjunto de confirmadas. Sin fecha indexable puede faltar: nunca prometer cobertura completa.
5. D1 real y Firestore real:999/1000, fechas legadas, autorización, movimiento/corrección concurrente y ausencia de escrituras. Medir bytes/tiempo de respuestas locales y reintentos transaccionales; no extrapolar a producción.

## Sesión, interfaz y navegador

1. Ejecutar los cuatro suites de reporte: hook, UI, page y authority; conservar también navegación/dashboard. Una carga inicial; consultas y actualización explícitas; sin polling propio. Fijar `serverNow` de la respuesta y usar tiempo monótono para presets posteriores.
2. Cambiar periodo mientras una lectura no coopera con Abort; token o JSON lentos; respuesta corrupta, rango/negocio/dueño equivocado; época nueva,401/403 y fallo503 del sondeo de negocio. Nunca recuperar datos privados tardíos.503→200 conserva borrador y periodo y necesita Actualizar;401/403 conocido no se deshace por un éxito tardío.
3. La advertencia de cobertura permanece en vacío y error. Al consultar, retirar tarjetas anteriores. Un error no es cero. Resultado/error reciben foco después de una acción explícita; la carga inicial no lo roba. Detalles cerrados inicialmente.
4. Fixture de siete días/dos recursos con estados, un menor representado y precios distintos: contar citas, sin personas/importes/tasas. Cambiar explícitamente un estado sintético y Actualizar; distinguir una mutación de fixture de una prueba del escritor de asistencia.
5. Observar Hoy/7/30, edición del periodo, cambio de medianoche Colombia, vacío, error de rango,999 y1000→413→reducir fechas. Mantener cuatro destinos principales y entrada secundaria desde Mi agenda, con sus guardas de acciones pendientes.
6. Comprobar320/390/640/1280px: campos de fecha legibles, sin scroll horizontal global; tabla puede desplazar dentro de su contenedor. Revisar teclado, foco, zoom nativo200% y lector audible; registrar como no observado cualquier recorrido no verificable.
7. Guardar capturas sintéticas, verificar hashes de negocio/citas frente a las mutaciones de fixture autorizadas y cero eventos/conversaciones. Cerrar sesión/pestañas propias, restablecer viewport y detener solo el harness propio. Conservar datos y recibos, sin restaurar ni purgar para simular rollback.

## Cierre

Suite completa, TypeScript y build sobre código estable. Repetir emulador solo si cambió el backend después de su gate. Worker sin cambios no requiere check/deploy rutinario. Revisión independiente una vez; corregir Important con reproducción y evidencia, declarar Minors diferidos. Registrar QA real por separado del plan histórico y publicar únicamente en la etapa autorizada.
