---
name: Sarin — Agenda clara
description: Sistema visual existente para gestionar citas y conversaciones con claridad.
colors:
  sarin-canvas: "#f7f9ff"
  sarin-paper: "#ffffff"
  sarin-ink: "#162344"
  sarin-muted: "#52617d"
  sarin-line: "#e0e6f1"
  sarin-blue: "#315ff3"
  sarin-soft: "#edf1ff"
typography:
  display:
    fontFamily: "DM Sans, Arial, sans-serif"
  body:
    fontFamily: "DM Sans, Arial, sans-serif"
    lineHeight: 1.6
spacing:
  related-fields: "12px"
  field-groups: "16px"
  sections: "24px"
---

# Design System: Sarin — Agenda clara

## Overview

**Creative North Star: "Agenda clara"**

La dirección aprobada es **Agenda clara**, elegida por el propietario el 13 de octubre de 2026. Sarin es un servicio comercial de citas: el dueño gestiona su negocio y su agenda; el cliente consulta servicios, reserva y recupera sus citas. La aplicación prioriza tareas, lectura y estados verificables. No es un proyecto nuevo ni una autorización para sustituir su identidad.

Este archivo consolida [design-system.md](design-system.md), [docs/design-system.md](docs/design-system.md), los contratos administrativos y los tokens observados en src/app/globals.css del commit 889017457801759e44835b723d8e0c26aa3e6baa. Los archivos anteriores conservan sus decisiones históricas; este es el punto de entrada para trabajos nuevos. Si se detecta una discrepancia con una decisión posterior del propietario, documentarla y resolverla antes de cambiar la identidad.

La aplicación usa el modo **Operate** de Impeccable; ayuda y documentación, **Read**; la landing, **Persuade**. Una landing no determina la densidad ni la navegación de la aplicación. Se conservan la marca, el rostro de Sarin y los recursos propios. Los patrones estudiados en Fresha se adaptan a Sarin con sus propios textos y contratos.

**Key Characteristics:** tareas claras, datos verificables, densidad útil e identidad consistente.

## Colors

Los siete colores del frontmatter corresponden a tokens existentes, no a una paleta nueva. En CSS se reutilizan sarin-canvas, sarin-paper, sarin-ink, sarin-muted, sarin-line, sarin-blue y sarin-soft.

- Canvas: fondo general claro; paper: superficies de lectura y edición.
- Ink: texto principal; muted: información secundaria legible.
- Blue: acción principal, selección y foco; soft: selección o contexto suave.
- Line: separación de filas, grupos y superficies.

Los estados incluyen texto y, cuando ayude, icono semántico. El color por sí solo no acredita guardado, permiso, cobro, disponibilidad o entrega. Los nuevos estados críticos se comprueban por contraste en su contexto real; no se inventa una paleta de estados en esta consolidación.

## Typography

DM Sans local, pesos 400–700, para títulos, cuerpo, etiquetas y formularios. Los archivos WOFF2 y sus licencias permanecen en public/fonts. No añadir llamadas a Google Fonts ni cambiar de fuente por una recomendación genérica de una skill.

Horas e importes usan cifras tabulares. La implementación actual declara IBM Plex Mono para usos técnicos concretos y conserva una variable Space Grotesk; su presencia en layout no cambia la fuente principal aprobada. No introducir nuevos usos de esas fuentes sin una necesidad concreta de la pantalla.

La altura de línea del cuerpo existente es 1.6. Los tamaños y pesos se toman de los componentes compartidos y la jerarquía de la pantalla; no se crea aquí una escala tipográfica que el producto no utiliza. Etiquetas, errores y ayudas permanecen legibles en móvil y con zoom.

## Layout

Una tarea principal por vista o panel, con detalles secundarios progresivos. Configuración, agenda, recepción, facturación y superadministración conservan sus ámbitos y la jerarquía aprobada. La navegación del dueño mantiene los destinos existentes; una mejora local no crea una arquitectura de navegación competidora.

Usar 12 px entre campos relacionados, 16 px entre grupos y 24 px entre secciones. Aprovechar el ancho útil; evitar grandes alturas vacías y cadenas de tarjetas innecesarias. Las acciones secundarias pueden compartir cabecera cuando caben. Los horarios se alinean por día en escritorio y se apilan en móvil.

Adaptación desde 320 px. Verificación final a 320, 390 y 1280 px, teclado y zoom nativo al 200 %. El viewport estrecho no sustituye la prueba de zoom. Tablas anchas necesitan una estrategia explícita de consulta; no provocar desbordamiento horizontal de toda la página. Los controles tienen al menos 44 px de área de interacción.

Conservar el componente de navegación actual al ampliar la aplicación. Las notas antiguas sobre una barra lateral o desplazable describen cortes previos; no obligan a reemplazar WorkspaceNavigation, su menú móvil, sus deep-links o su comportamiento de foco.

## Elevation & Depth

Superficies claras, líneas discretas y sombras suaves cuando la implementación compartida ya las utiliza. La profundidad ayuda a distinguir contenido, capas y diálogos; no compite con las citas o formularios. Evitar nuevas capas decorativas, glows y efectos costosos en pantallas de trabajo.

No se introduce un catálogo nuevo de sombras. Reutilizar los valores de los componentes existentes y verificar que popovers, avisos y diálogos no oculten acciones ni foco.

## Shapes

Mantener bordes y radios del componente compartido; la dirección documentada utiliza curvas moderadas, aproximadamente 10–20 px según la superficie. No convertir ese intervalo descriptivo en una obligación de usar un radio idéntico en todo el producto. Inputs, botones, tarjetas y menús deben conservar una familia coherente.

No cambiar tablas, listas, selects o controles conocidos por widgets personalizados sin una mejora funcional comprobable.

## Components

- **Acciones:** verbos concretos en español, una acción principal clara, foco visible y área táctil suficiente. Botones y enlaces conservan semántica, estado disabled y tratamiento de busy. No repetir escrituras por doble clic.
- **Formularios:** etiquetas asociadas, ayuda contextual y validación comprensible. Conservar datos ante errores recuperables y explicar qué se hará público. Revisar antes de operaciones sensibles. Aplicar un hijo o editar un borrador no equivale a guardar el padre.
- **Estados:** distinguir cargando, vacío, error, acceso denegado, bloqueado y resultado incierto. No representar una lectura fallida como cero registros ni un espacio vacío como hora reservable.
- **Agenda:** distinguir atención, preparación y bloqueo; conservar horarios guardados y recursos históricos. Una cita pasada no prueba asistencia; el resultado de atención y el pago son hechos diferentes.
- **Persistencia:** el estado visual procede de respuestas verificadas. Cambio de UID, época de autenticación o negocio descarta respuestas viejas y datos privados del contexto anterior. Ocultar un panel no cancela por sí mismo una escritura incierta.
- **Diálogos y navegación:** teclado, Escape cuando corresponda, foco al abrir/cerrar y retorno al origen. Un resultado tardío de un panel oculto no roba el foco. Atrás/Adelante y deep-links forman parte del recorrido.
- **Marca y landing:** conservar el rostro de Sarin, QR, assets y decisiones de copy del propietario. La sección «Tú atiendes» mantiene sus títulos y descripciones sin iconos o numeración decorativos retirados.
- **Imagen de cita:** copia estática generada localmente, sin teléfono, correo o respuestas privadas; no prometer sincronización o avisos por descargarla.

## Do's and Don'ts

- Reutilizar componentes, hooks y servicios antes de crear variantes, abstracciones o dependencias nuevas. TypeScript estricto, imports y nombres coherentes con el repositorio.
- Cargar las skills pertinentes para la tarea; no ejecutar toda la colección sobre cada cambio. Taste usa su recorrido de app screens y conserva paleta/tipografía. La skill histórica de redesign aporta una revisión contextual; no autoriza una sustitución visual global.
- Mantener validación de servidor, autorización por negocio/rol y separación de datos públicos, privados y sensibles. La ocultación de un botón no sustituye un permiso.
- No añadir métricas, clientes, resultados, ahorros ni estados de entrega ficticios. Los fixtures de QA son sintéticos y están identificados como tales.
- Respetar prefers-reduced-motion, reducir trabajo fuera de pantalla y pausar animación al ocultar la pestaña cuando ya lo hace el componente.
- **Decisión histórica de movimiento:** la landing tiene una secuencia del propietario de cinco escenas de 8,8 s, continua y sin controles. Se conserva durante esta consolidación. Existe tensión con la regla R-39 de antislop sobre pausa para movimiento prolongado: registrar la revisión de accesibilidad y consultar cualquier cambio de esa decisión en su tarea, sin declararla aprobada por instalar la skill. No extender esta excepción a nuevas animaciones.
- Medir rendimiento antes/después con condiciones comparables. No añadir caché a respuestas privadas o a escrituras para mejorar una puntuación. No afirmar INP real con una captura o un único ensayo de laboratorio.
- Usar una sola réplica de la aplicación y solo alsdevstudio.com como hostname del motor, según AGENTS.md. La estética no cambia los contratos de reserva, cuota o recuperación.
- El cierre visual y funcional se verifica en la aplicación real mediante Playwright MCP después del ciclo de construcción. Las pruebas focales de dominio, autorización y tipos acompañan la implementación; una captura no sustituye esas pruebas ni un pase aislado a toda la suite.
