# Sarin Bot: landing y planes de chatbot aprobados

Estado: el propietario aprobó el 7 de noviembre de 2026 publicar los tres precios y «A medida» a cotizar. La landing no activa cobros ni modifica suscripciones.

Esta revisión sustituye la portada administrativa documentada en `2026-11-07-sarin-hub.md`. La raíz y el export estático ahora promocionan el servicio de chatbot de Sarin Bot; `/admin` conserva el centro de control y su acceso restringido. La identidad y los planes de citas de AgendIA permanecen separados.

## Precios aprobados

| Plan | Precio | Período | Respuestas completas incluidas |
| --- | --- | --- | --- |
| Inicio | 49.900 COP | 30 días | 1.000 |
| Negocio | 99.900 COP | 30 días | 3.000 |
| Crecimiento | 199.900 COP | 30 días | 8.000 |
| A medida | Cotizar según alcance | Acordado por proyecto | Acordadas por proyecto |

Una respuesta completa del bot se cuenta una vez; los mensajes del cliente no consumen ese cupo. Los planes por volumen comparten el alcance acordado del chatbot. La configuración e integración se cotizan antes de activar el servicio. Los cargos del canal de WhatsApp y del proveedor de IA se cotizan aparte cuando correspondan. No se prometen respuestas ilimitadas, acumulación de cupos ni cobros automáticos.

Los importes se propusieron por solicitud del propietario y después fueron aprobados expresamente con «Publicar esos precios y “A medida” a cotizar». `BOT_SERVICE_OFFER_IS_DRAFT` es `false`; la landing final no muestra el marcador de propuesta ni el texto de aprobación pendiente. Cada CTA abre el contacto existente de WhatsApp para consultar el plan; no hay checkout ni modificación de la facturación compartida de AgendIA.

El plan a medida incluye un chatbot con nombre, personalidad e identidad propios y una mascota personalizada para la marca. El volumen y las integraciones se cotizan según la dificultad del proyecto. Esta prestación personalizada fue solicitada expresamente por el propietario; no implica un generador automático de mascotas ni reutiliza la imagen de referencia de OpsyBot en la marca Sarin.

## Contenido y diseño

- Componentes independientes `BotServiceHome` y `BotServicePricing`; no reutilizan ni alteran la landing comercial de citas.
- Cabecera con Sarin Bot, ALS Dev Studio, secciones reales y administración secundaria.
- Presentación del servicio, información configurada del negocio, canal web, WhatsApp sujeto a configuración/verificación y consulta de consumo.
- Escala comparativa de planes en filas que se apilan en móvil, sin etiquetas de popularidad ni prestaciones ficticias.
- CTA de cotización y contacto a `sarinWhatsAppUrl`; crédito a la web de ALS Dev Studio.
- No se anuncia un widget embebible automático, disponibilidad 24/7 ni integraciones ya activadas.

Dirección: Agenda clara, DM Sans y paleta existente. Lectura de servicio comercial para webs y emprendimientos; energía 2 / ritmo 2 / movimiento 1. El hero prioriza servicio y contacto; la imagen existente de Sarin identifica al asistente. Las capacidades se presentan en filas para explicar el alcance; los precios siguen ese mismo formato para comparar volumen y coste. No se crearon imágenes ni se añadieron animaciones.

## Verificación actual

- RED: dos pruebas de raíz/export fallaron contra la portada administrativa. Dos pruebas posteriores de precios configurados fallaron contra la variante que solo mostraba cotización.
- GREEN: `bot-service-home`, `auth-provider` y `admin-navigation`: 3 archivos, 101 pruebas correctas.
- `pnpm run typecheck`: correcto.
- `pnpm run build`: correcto para la nueva landing y el layout administrativo; posteriormente se ajustó solo el copy del plan personalizado y la ocultación del enlace de salto sin foco.
- `pnpm run build:landing`: correcto con la propuesta de cuatro planes.
- `pnpm run check:landing`: correcto, 41 archivos públicos, destinos reales y sin configuración de backend. Node informa el aviso conocido de detección de módulo al importar el archivo TypeScript de contacto; el comando termina correctamente.
- `GET /` local: 200, título `Sarin Bot | Chatbots para webs y emprendimientos`.
- `GET /admin` local: 200, título `Sarin Bot Admin Hub | ALS Dev Studio`.
- `git diff --check`: correcto en el corte anterior a esta nota.

## Revisión visual

Playwright MCP, Edge: raíz en 3047 y export estático en 3048. Se revisaron 320, 390 y 1280 px sin desbordamiento horizontal (`scrollWidth === innerWidth`). Los enlaces de cabecera llegan a las secciones reales; el botón secundario Administración abre `/admin` y muestra el acceso de Sarin Bot Admin Hub. Tab alcanza los planes con contorno sólido de 3 px. Los CTA de cotización miden 48 px y los enlaces de consulta 44 px. La consola final del export contiene cero errores y advertencias. No se enviaron mensajes ni se inició una sesión real.

Se inspeccionaron las capturas finales del export, con los importes aprobados y el plan personalizado actual. El DOM final acredita `data-offer-status="approved"` y ausencia del marcador de aprobación pendiente:

- [Comparación de precios aprobados](2026-11-07-sarin-service-pricing.png)
- [Portada completa a 1280 px](2026-11-07-sarin-service-1280.png)
- [Portada completa a 390 px](2026-11-07-sarin-service-390.png)

Se corrigió la ocultación del enlace «Saltar al contenido» sin foco siguiendo el patrón ya existente en la landing anterior. La imagen del hero conserva dimensiones y prioridad; las imágenes son assets existentes de Sarin. La tipografía, contraste y estados visibles mantienen los tokens aprobados. No hay animaciones nuevas ni afirmaciones de integraciones automáticas o resultados ficticios.

Las capturas de la portada administrativa anterior y la comparación que contiene el marcador de propuesta son históricas. La prueba de zoom nativo al 200 % mantiene la limitación ya registrada: el navegador headless no respondió al atajo y no se sustituyó por CSS.

## Preservación final

`git diff --exit-code 57cf586 --` sobre los 108 archivos rastreados de los ámbitos protegidos terminó con código 0 y salida vacía, después de dejar estable la landing: `cloudflare/`, `src/lib/sarin/`, `src/app/api/admin/`, `src/app/api/sarin/`, los cuatro módulos de servidor WhatsApp especificados y los cinco componentes administrativos protegidos. Sus contenidos Git coinciden con el commit de origen. El archivo generado `next-env.d.ts` se devolvió a su contenido anterior y no forma parte del cambio. `git diff --check` final pasó.

Como revisión independiente adicional, se leyeron los scripts de despliegue, gateway, proxy y Dockerfile de AgendIA sin editarlos. Las 15 pruebas de gateway, router y validación de despliegue pasaron; ejecutar `deploy-agendia.mjs` sin `--deploy` confirmó los objetivos AgendIA sin publicar. No se encontró un defecto crítico confirmado en la separación revisada. Esta comprobación no reemplaza la verificación del despliegue real.
