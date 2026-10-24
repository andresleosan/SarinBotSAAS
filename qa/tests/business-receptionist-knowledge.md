# Información empresarial para recepción — protocolo P4

Usar únicamente un negocio y cuentas sintéticos en `demo-sarin-bot`, con Auth/Firestore emulados y red externa/inferencia bloqueadas. Ejecutar desde la fuente aislada; conservar el checkout documental original.

## Contrato automatizado

- Formato de local, domicilio y atención en línea; dirección e indicaciones normalizadas, teléfono completo válido y fallbacks de datos históricos inválidos.
- Catálogo breve, precio y detalle seleccionado; metadatos permitidos como texto literal, sin inventar prestaciones ni recuperar otro servicio.
- Intención `service_details` con ID explícito del turno; validación del recurso explícito y eliminación del recurso heredado, sin borrador de configuración ni propuesta.
- Ruta real con motor simulado: última lectura autorizada, cambio/borrado durante interpretación, replay estable y consulta nueva con datos actualizados.
- Mantener consentimiento, suscripción, cuota, bloqueo, política de salud/menores y ausencia de escrituras de negocio/citas por consultas informativas.
- Notice real y composición con página, proveedor, controlador y workspace; borrador separado de configuración guardada, política cargando/error y cambio a salud.

## Navegador local

1. Entrar como dueño sintético y abrir Mi negocio → Cómo responde Sarin. Verificar que Información y alcance de Sarin comienza cerrado.
2. Abrir la guía con teclado; revisar fuentes, diferencia entre guardado y edición, confirmación explícita de cita y límites del tono/indicaciones.
3. Comprobar 1280, 390 y 320 px: texto legible, resumen accesible, foco visible, controles y ausencia de desbordamiento horizontal de página. Intentar zoom nativo al 200 % y registrar la observación real; no equiparar viewport reducido con zoom.
4. Abrir/cerrar la guía y editar indicaciones o ubicación sin guardar. Observar que esas acciones no envían chat ni POST de configuración; los GET de verificación existentes son normales.
5. Cambiar únicamente el fixture local a salud; verificar explicación de formulario sin IA, ausencia de chat activo y guía de menores según la política vigente. Verificar negocio sin onboarding completado por separado.
6. Comprobar ubicación y metadatos sintéticos en su ficha pública, conservando texto literal. Las respuestas de chat, vigencia y replay se atribuyen a pruebas con motor simulado salvo que exista un montaje local explícito que las ejercite.
7. Capturar únicamente la guía y contexto sintéticos, sin conversaciones completas ni datos privados. Detener procesos propios, retirar interceptores/viewport y cerrar pestañas propias.

## Cierre

Revisión independiente, suite general, TypeScript y build sobre la fuente final. Registrar comandos, resultados, límites y capturas en `docs/qa/2026-10-23-business-receptionist-knowledge.md`. Publicar por el workflow existente de `main` y verificar el SHA de Worker, contenedor y Pages, sin migración ni nuevos permisos.
