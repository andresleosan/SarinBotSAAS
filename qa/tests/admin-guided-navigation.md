# Protocolo de navegación administrativa guiada

Fecha de ejecución asociada: **23 de octubre de 2026**, America/Bogota. Este protocolo define comprobaciones; los resultados y las limitaciones pertenecen al [reporte de ejecución](../../docs/qa/2026-10-22-admin-guided-navigation.md). El nombre del reporte conserva la fecha del diseño.

## Entorno y límites

- Usar Node 24 y pnpm 11.23.0, dependencias bloqueadas y una fuente reconciliada en un worktree aislado. Registrar HEAD, estado de Git, comandos, tiempos, códigos de salida y evidencia por ejecución.
- Ejecutar focal, suite completa, tipos y build secuencialmente. Mantener el demo apagado durante la suite completa y el build. No aumentar plazos, filtrar la suite completa, cambiar configuración o reemplazar un build real por tipos.
- Para el arnés Windows documentado, usar el Vitest instalado, la configuración original, dos workers, `configLoader: 'runner'`, `envDir: false`, cachés/HOME externos nuevos y TEMP/TMP corto. Registrar estas diferencias frente a `pnpm test`; no cargar credenciales, dotenv productivo ni opt-ins de proveedores.
- Demo local oficial: `pnpm run dev:local --port 3042`, Node 24, Java 21+, proyecto `demo-*`, Auth/Firestore aislados y puertos 3042/8080/9099/4400/4500 disponibles. Un solo responsable inicia y cierra el demo y sus fixtures.
- Usar únicamente datos sintéticos. No enviar preguntas reales, mensajes externos, pagos, canjes, invitaciones, activaciones, guardados, publicaciones ni aceptación de salud/menores para comprobar navegación. No cambiar flags, canales, presupuestos, APIs, dependencias o lockfile.

## Comprobaciones automatizadas

Ejecutar los once archivos, sin filtro de nombre. La verificación final añade el componente real de soporte afectado por el control de foco:

```powershell
pnpm exec vitest run tests/admin-navigation.test.ts tests/workspace-navigation.test.tsx tests/admin-modules.test.tsx tests/admin-assistant-navigation.test.tsx tests/user-avatar.test.tsx tests/admin-focus-navigation.test.tsx tests/admin-assistant-platform.test.tsx tests/admin-ai-page.test.tsx tests/admin-payment-confirmation.test.tsx tests/admin-deep-links.test.ts tests/platform-support-ui.test.tsx
pnpm test
pnpm run typecheck
pnpm run build
```

Conservar fallos y omitidas reales y no sumar focal y completa como pruebas distintas. El build debe realizar generación de páginas y verificar los límites Suspense de `useSearchParams`. Si falla por dependencias enlazadas, preservar el fallo antes de preparar una copia física exacta y sin secretos mediante el procedimiento aprobado. No ejecutar checks de Worker por rutina cuando no hay cambios de Worker.

Cobertura que se debe contrastar con los tests: destinos validados y recuperación de enlaces inválidos; query/hash y Atrás/Adelante; menú según rol; una sección activa con paneles ocultos `hidden`/`inert`; conservación de instancia, edición, busy y tupla de solicitud incierta; descarte de estado privado al cambiar UID/época/rol/salida; lectura dirigida de comprobantes; respuestas/callbacks antiguos sin poblar autoridad o destino nuevos; navegación sin PATCH, confirmación, inferencia ni creación automática de soporte.

## Recorrido real de navegador

| Caso | Acción y criterio observable |
| --- | --- |
| Shell y rol | A 320, 390 y 1280 px comprobar contexto, enlaces del rol, destino activo y una sección visible. Cuenta ordinaria sin enlaces administrativos. Menú móvil con `aria-expanded`/`aria-controls`, acción de al menos 44 px, Tab, Escape y devolución del foco. Elegir por teclado el destino ya activo también deja foco visible. Conservar Ctrl/Meta/clic central para apertura aparte y el desplazamiento habitual de rutas del negocio. |
| Accesibilidad y espacio | Comprobar teclado, foco visible, campos largos, ausencia de desbordamiento y acciones accesibles a zoom 200 %. Registrar el método de zoom. Comprobar movimiento reducido si se observa; no atribuirlo a otra prueba. |
| Estado local | Editar un campo sintético sin guardar, cambiar módulo y volver: misma edición. Ocultar paneles sin desmontarlos; después cambiar/perder autoridad y verificar que desaparece el estado privado de todos los paneles. |
| Comprobante dirigido | Sembrar más de 500 comprobantes pendientes; abrir el enlace al situado fuera del primer listado y comprobar sección, registro y foco. Actualizar sin reclamar foco. |
| Negocio ausente | Abrir hash de negocio sintético ausente: aviso de cobertura/recuperación enfocable y navegación disponible; no presentar el registro como inexistente globalmente. |
| Historial | Atrás/Adelante y cambios de query/hash conservan un destino coherente y foco de la tarea correspondiente, sin una escritura causada por navegar. |
| Propuesta enlazada | Abrir una propuesta sintética vigente: solo lectura/revisión. Cambiar sección y volver conserva busy/estado/requestId. No confirmar ni preparar de nuevo para navegar. Un destino sensible posterior ofrece apertura explícita en otra pestaña sin reemplazar la tarea actual. |
| Soporte | Abrir hilo sintético existente y el hash de soporte: sección y foco correctos, sin enviar ni crear conversación por navegar. Distinguir plataforma Sarin y negocios. |
| Respuesta tardía | Con respuesta de pago/soporte controlada después de ocultar el panel, comprobar que foco sigue en la tarea activa y un lector de pantalla no anuncia el panel oculto. Si no se ejecuta realmente, registrar como no observado y limitar la atribución a tests concretos. |
| Respuesta tras volver | Retener GET de propuesta A, ir a Consulta y volver con Atrás antes de liberar la respuesta: el aviso de preservación mantiene foco al terminar éxito/error de A. Cubrir también A → B sin sustituir A. Una interacción explícita posterior con la tarea conservada permite su foco habitual. El envío de soporte equivalente se cubre con transporte simulado; no enviar un mensaje desde navegador para este caso. |
| Overlays | Buscar portales/diálogos fuera de paneles en fuente y comprobar overlays administrativos en el DOM activo al navegar. No prometer cerrar un popup externo de reautenticación ya abierto; su retorno exige la acción humana actual para confirmar. |
| Dueño | Entrar por agenda, configuración, QR y suscripción; conservar ConsentPanel y contexto. Configuración conserva su control de logo y Guardar configuración, sin nuevos Guardar borrador/Publicar. No subir logo, preparar tarjeta, comprar o guardar para este smoke. |

Si el transporte de Browser Use bloquea una carga directa, registrar el incidente; la entrada landing → enlace visible al workspace sirve para observar el flujo SPA, sin modificar autenticación para acomodar la herramienta.

## Revisión, evidencia y entrega

Revisar el delta completo desde la base efectiva y registrar la revisión independiente: sin nuevas rutas de backend, contratos/payloads alterados, contactos en URL, remount por módulo o reutilización de scope oculto. Comprobar también que siguen `AuthGate`, consentimiento y permisos del servidor.

Las lecturas de componentes ocultos continúan y los borradores ordinarios solo viven en memoria. No afirmar ahorro de red, persistencia durable, cancelación automática de operaciones o resolución del límite de settings sin CAS. Las carreras y reintentos inciertos no observados en navegador solo se describen según la evidencia automatizada disponible.

Guardar capturas visualmente revisadas y saneadas, sin tokens ni datos privados, con URL/estado y viewport asociados. Separar código local, navegador local, CI remota y runtime desplegado. Mantener visibles fallos anteriores, omitidas y auditoría de dependencias; un pase local no prueba toda CI ni habilita publicación.

La entrega de navegación no despliega. Una publicación futura requiere reconciliar fuente, artefacto y runtime efectivos, resolver sus gates, mantener una instancia por la cola process-local y seguir el procedimiento vigente de publicación/reversión. Revertir UI no deshace acciones reales de usuarios ni borra datos. Cerrar únicamente pestañas, procesos y fixtures propios; preservar otras fuentes y evidencia histórica.
