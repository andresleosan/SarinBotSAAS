# Aceptación del catálogo de servicios

Protocolo de Chrome mediante CUA para la descripción y categoría opcionales de cada servicio. Este archivo define los pasos; los resultados, comandos y capturas de una corrida se registran en `docs/qa/`.

## Entorno y preparación

Usar exclusivamente la aplicación local conectada a los emuladores oficiales de `demo-sarin-bot`, con cuentas emuladas y un negocio sintético identificable. Confirmar el origen `http://127.0.0.1:<puerto>` o `http://localhost:<puerto>` y el proyecto demo antes de editar. No usar producción, cuentas reales ni llamadas al motor de IA.

Preparar un negocio sintético activo con permisos de prueba ya registrados, horario y recursos válidos. Conservar su configuración inicial para restaurarla al terminar. El catálogo de aceptación debe permitir comprobar un menú mixto y uno histórico sin metadatos:

| Servicio sintético | Categoría | Descripción |
| --- | --- | --- |
| Corte de prueba | `  Cabello  ` | `  Incluye lavado y peinado.  ` |
| Peinado de prueba | `CABELLO` | Texto breve con salto de línea. |
| Consulta de prueba | Vacía | Vacía. |

Para Unicode y texto largo, usar únicamente variantes de estos datos sintéticos. No ejecutar el asistente para crear o modificar la configuración.

## Recorrido en CUA

1. Acceder como dueño local a `/dashboard/onboarding`. Localizar los campos «Descripción (opcional)» y «Categoría (opcional)» de cada servicio y la ayuda que indica que serán visibles para clientes.
2. Escribir los valores de la tabla sin alterar ID, precio, duración, buffer, recurso ni horario. Guardar desde el formulario y comprobar el estado de guardado exitoso.
3. Recargar la configuración. Comprobar que permanecen los textos y que se quitaron los espacios exteriores. Verificar que precio, duración y asignación de recursos coinciden con el estado inicial.
4. Salir de la sesión local y abrir `/b/[slug-sintético]`. Comprobar que el catálogo aparece antes de Google. La categoría «Cabello» reúne los dos primeros servicios una sola vez, con la escritura del primer servicio; «Sin categoría» contiene la consulta.
5. Comprobar que cada descripción aparece bajo su servicio, que el salto de línea se conserva y que no queda un espacio editorial vacío donde no hay descripción. Precio COP y duración deben permanecer visibles.
6. Revisar la respuesta local de `?view=profile`: los servicios contienen solo `id`, `name`, `price`, `durationMinutes` y los metadatos no vacíos. No deben aparecer buffer, recursos, notas internas, identidad del dueño, configuración del asistente ni facturación. Confirmar `Cache-Control: no-store`.
7. Entrar otra vez como dueño local, vaciar explícitamente descripción y categoría y guardar. Tras recargar, los campos siguen vacíos. Consultar el perfil sin sesión: los campos vacíos no están en la respuesta y sus bloques no se muestran.
8. Dejar todos los servicios sin categoría. Verificar la lista plana, en el orden original, sin el título «Sin categoría». Añadir una categoría solo al segundo servicio y comprobar que los grupos siguen el orden de primera aparición, sin orden alfabético.
9. Probar en el fixture dos categorías con la misma letra acentuada en formas Unicode compuesta y descompuesta; deben reunirse. Comprobar también diferencias de mayúsculas. Una categoría distinta que omita la tilde debe seguir siendo distinta.
10. Introducir texto literal como `<strong>prueba</strong>` en una descripción sintética. Debe mostrarse como texto, sin formato HTML ni elementos generados a partir del contenido.
11. Comprobar descripción de 300 y categoría de 60 caracteres, incluidos textos largos sin espacios. Los controles no deben permitir exceder sus máximos al escribir. La validación de HTTP 400 para 301/61 se comprueba mediante la integración automatizada, sin alterar la página mediante código de prueba.
12. Revisar el formulario y el perfil a **320, 390 y 1280 px**. No debe existir desplazamiento horizontal; nombres, categorías y descripciones largas envuelven líneas. La acción principal conserva su acceso y los controles no se recortan.
13. Con teclado, recorrer los campos y Guardar con Tab/Shift+Tab. Comprobar foco visible, etiquetas accesibles y que Enter inserta un salto de línea dentro de la descripción. En el perfil, activar «Reservar» y «Volver al negocio» con teclado sin enviar una solicitud de IA.
14. Confirmar que el recorrido autenticado y «Mis citas» siguen disponibles con el fixture existente; no crear reservas mediante IA. Revisar que la consola no contiene errores inesperados.
15. Restaurar la configuración sintética inicial, el viewport y las opciones temporales de prueba. Cerrar solo las pestañas de aceptación y retirar únicamente los datos que pertenecen al fixture de esta corrida.

## Contratos automatizados complementarios

El recorrido local de `tests/local-journey.integration.test.ts` comprueba mediante HTTP autenticado el guardado con trim, lectura del dueño, perfil anónimo mínimo, preservación al omitir campos, borrado explícito, HTTP 400 para 301/61 y HTTP 401 al escribir sin sesión. Restaura los servicios antes de continuar las reservas. Estas regresiones de integración se añadieron después de la implementación.

Las pruebas de negocios, esquemas y perfil cubren la preservación por ID, campos históricos y agrupación. `tests/service-catalog-prompts.test.ts` comprueba que los contextos de intención, cliente y copiloto mantienen únicamente datos operativos del servicio. `tests/booking-proposals.test.ts` comprueba propuestas históricas, metadatos en propuestas nuevas, rechazo 409 tras un cambio pendiente y recuperación idempotente de citas ya confirmadas. Ninguna de estas comprobaciones necesita invocar un proveedor de IA.

Registrar por separado la salida real de `pnpm test`, `pnpm run typecheck`, `pnpm run build` y del recorrido local autorizado, junto con capturas del formulario y del perfil en los anchos comprobados. Una lista de pasos no equivale a una corrida completada ni a una publicación.
