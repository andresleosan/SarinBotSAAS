# FAQ factual: protocolo sintético local

Plan: `docs/superpowers/plans/2026-10-22-business-factual-faq.md`. No ejecutar en producción. Node24/pnpm11.23.0/Java21; proyecto `demo-sarin-bot`, Auth/Firestore locales y guard de red saliente. No contactos reales, cobros, mensajes externos ni inferencia.

1. Dueño vigente: abrir `/dashboard/faq`, comprobar tres preguntas opcionales y ausencia real de estado. Guardar exige cambios, revisión y confirmación local. Campos vacíos retiran temas. HTML/instrucciones permanecen texto.
2. Revisar añadidas/cambiadas/retiradas. Guardar y verificar revisión/recibo sin tocar BusinessConfig, proyección, citas o cuotas. Verificar borrador de Mi negocio al abrir el enlace secundario explícito en otra pestaña.
3. Cliente consentido/general/sin menores: perfil anónimo y calendario no incluyen FAQ; chat general la mantiene plegada. Abrir lista, elegir un ID/revisión, cambiar elección y cerrar/reabrir. La respuesta no entra en el transcript ni cambia el mensaje o una propuesta.
4. Cambiar respuestas desde otro comando dueño entre lista y elección. La elección antigua recibe409, borra el texto y recarga temas; exige otra elección, sin fallback. Retirar tema impide leerlo.
5. Cambiar política a salud/menores, consentimiento o cuenta. Purga inmediata cuando el gate actual cambia; respuesta tardía no reaparece. Confirmación incierta del chat conserva su recuperación. Las carreras se atribuyen a tests automatizados salvo reproducción observada.
6. Automatización: lectura10s aborta/descarta tarde; PUT20s solo aviso. Ausencia de recibo no desbloquea otro guardado; reintento conserva cuerpo/ID; huella ajena no prueba aplicación. GET anterior no revierte un PUT confirmado. Fallo temporal de autoridad conserva borrador/pendiente; denegación401/403 conocida purga.
7. D1 real: dos handles/CAS, journal de respuesta perdida, cambio de política y Worker anterior sin escrituras parciales. Firestore Admin real: CAS/recibo atómicos. SDK: dueño/cliente/tercero/anónimo sin acceso directo a ambos hijos. Restauración sintética conserva estado, respuestas y huellas.
8. Responsive320/390/1280, texto largo, foco/controles44px. Registrar zoom nativo200%/lector audible como no observados si no se ejercitan; no presentar emulación de ancho como zoom.
9. Cerrar sesión/pestañas propias, restablecer viewport, detener únicamente wrapper propio, verificar puertos y conservar recibos/primeros fallos. Worker compatible antes de app; rollback preserva FAQ/recibos y enforcementS09. Este protocolo no autoriza despliegue.
