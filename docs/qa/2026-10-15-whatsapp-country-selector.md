# Selector de país para WhatsApp

Solicitud del propietario: separar la bandera y el indicativo del número en Datos de tu negocio.

## Alcance

- Selector nativo accesible con nombres de países en español, bandera SVG local e indicativo. Colombia por defecto cuando el campo está vacío.
- Número nacional a la derecha; pegado internacional con `+` o `00` reconocido sin duplicar indicativo.
- `phoneWhatsApp` conserva el contrato internacional único. No hay migración ni cambios de autenticación, API, WhatsApp Business o proveedores de IA.
- Los valores legacy, ceros iniciales e indicativos desconocidos no se reescriben al cargar. Países con prefijo compartido respetan la selección durante la edición.

## Validación

- `pnpm test`: 438 aprobadas y 18 omitidas de integración opt-in. Incluye 30 regresiones de los nuevos campos/helpers; RED observado antes de implementar y corregir prefijos compartidos.
- `pnpm run typecheck`: aprobado.
- `pnpm audit --audit-level=high`: cero vulnerabilidades conocidas.
- Revisión independiente del cambio y de los scripts privados: sin bloqueadores.
- Chrome contra Firebase emulado, proyecto demo y datos sintéticos: pegado de España/Colombia, cambio de país, guardado y recarga correctos.
- Entradas vacías y extensiones inválidas rechazadas por validación del formulario. Selector accesible mediante Shift+Tab.
- Escritorio y móvil de 320 px inspeccionados: sin desbordamiento horizontal; selector y número con altura táctil de 44 px. Viewport restaurado al terminar.
- Captura móvil privada: `C:/Users/USER/AppData/Local/SarinBot/deployment/phone-country-mobile.png`.

## Publicación

Código: `a687b576fbc30e1495caa85f6e2bd36b712842a2`, con `[CF-Pages-Skip]` para no publicar la portada. [CI 38844049015](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38844049015) terminó con los tres trabajos correctos: tipos/pruebas/builds, reglas/recorrido local y Cloudflare.

- Imagen privada activa: `sarin-bot:phone-country-20261016t030925z`, ID `sha256:237f953b94843bbdff412db414f6bb6b33cdd9511853667dc848429096c5d279`.
- Snapshot de 109 archivos del commit exacto; SHA256 `3f033767c06f9b791b9fd0786cc0411b61cc1363988089931228b1da419e0540`.
- Activación con 28 límites de autenticación, páginas/recursos, lectura de Firebase y catálogo del motor local verificados. Configuración, proveedor de IA y WhatsApp desactivado conservados.
- Chrome autenticado en la instancia privada: Sarin Pruebas muestra bandera de Colombia, `+57` separado y el número nacional existente. No se guardó ni modificó el negocio real para esta comprobación.
- Captura privada final: `C:/Users/USER/AppData/Local/SarinBot/deployment/phone-country-sarin-pruebas.png`.
- Rollback preparado: `/opt/sarin-bot/runtime/rollbacks/phone-country-image-update-20261016T030804Z-deb4c8c0`; restaura la imagen anterior `compact-forms-20261016t025030z` mediante el wrapper privado revisado.

El recorrido de reservas con IA sigue pendiente y no se presenta como aprobado por estas pruebas del formulario.
