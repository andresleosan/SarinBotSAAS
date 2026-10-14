# Migración a pnpm — verificación

## Cambios

App y kit Cloudflare comparten `pnpm-lock.yaml` y `pnpm-workspace.yaml`. Se fija pnpm 11.23.0 con Node 24. Los overrides de seguridad se trasladan al workspace y los scripts de instalación aprobados se restringen a versiones existentes.

La comparación de los dos lockfiles npm, normalizando aliases, conserva las 517 combinaciones paquete/versión y sus integridades. `pnpm import` seleccionó inicialmente otra versión de `caniuse-lite`; se restauró 1.0.30001816 y su integridad original antes de probar. Las tres excepciones de antigüedad se limitan a versiones ya fijadas. Vite 8.3.4 se declara como dependencia directa de desarrollo porque la prueba del runner importa su API; ya estaba presente como dependencia de Vitest.

Launcher: usa la CLI real de pnpm y Firebase CLI 15.33.0 mediante `dlx`, con permiso de build exclusivo de protobufjs. No inicia inferencia. CI instala desde la raíz y Docker instala solo la app, incluyendo ambos manifiestos para validar el lock compartido.

## Evidencia local

- Baseline npm: 150 pruebas aprobadas, 8 opt-in omitidas.
- `pnpm install --frozen-lockfile`: pasa para ambos paquetes.
- `pnpm run typecheck`: pasa.
- `pnpm test`: 153 aprobadas, 8 opt-in omitidas; incluye tres casos nuevos del comando/guardas del launcher.
- `pnpm run test:rules`: 7 aprobadas con Firestore oficial y Java 21.
- `pnpm run test:local --port 3040`: pasa.
- `pnpm run test:journey --port 3040`: 61 comprobaciones aprobadas, limpieza sintética confirmada y datos manuales conservados. App instalada mediante pnpm, usando los emuladores oficiales ya activos; el arranque aislado completo se verifica en CI.
- `pnpm audit --audit-level=high`: sin vulnerabilidades conocidas.
- `pnpm run build`: app standalone compilada.
- `pnpm run build:landing` y `pnpm run check:landing`: 41 archivos, aviso de lanzamiento y sin configuración privada.
- `pnpm --filter sarin-cloudflare-host --fail-if-no-match run check`: 8 pruebas, tipos y dry-run aprobados; sin publicación del Worker.
- Docker Linux: build pnpm congelado y arranque standalone en loopback, filesystem de solo lectura, usuario no root y capacidades retiradas. `/` y `/admin/vault` responden 200; las siete API protegidas responden 401 usando sus métodos correctos.
- Revisión independiente estática de workflow, Docker, integridades y versiones: sin bloqueantes.

## Cierre verificado

- Commit de código `04d57cd22f9243b9e4e93c0c20ceb373f408178e`, integrado por fast-forward y publicado en `main`.
- En la carpeta habitual: instalación congelada sin lockfiles npm, TypeScript y 153 pruebas aprobadas; humo local aprobado. Se retiraron también los dos archivos internos `.package-lock.json` del árbol de dependencias anterior. No se desinstaló npm global ni se borraron sus cachés.
- [GitHub Actions 38527082839](https://github.com/andresleosan/SarinBotSAAS/actions/runs/38527082839): los tres jobs finalizaron con éxito, incluido el arranque aislado del launcher pnpm en Linux y su recorrido completo.
- Pages producción `07bcf4b6-7f31-44ac-b500-bc4e1de8de94`: success. El log confirma pnpm 11.23.0, instalación del workspace y comando `pnpm run build:landing && pnpm run check:landing`. `NODE_VERSION=24` y `PNPM_VERSION=11.23.0` guardados. La plataforma emitió una advertencia de engines en su bootstrap de Corepack con Node 24.13.1; instalación, compilación y publicación terminaron sin errores.
- Dominio `sarinbotsaas.pages.dev` y URL del despliegue: HTTP 200. Esta publicación sigue siendo la portada temporal, con Firebase real pendiente.
- Contenedor de comprobación y Next temporal en 3040 retirados; los emuladores y la app habitual en 3030 permanecen activos. Datos manuales y Vault conservados. Ollama y la Mac siguen pendientes por decisión del propietario.

Evidencia visual: `pnpm-pages-settings.png` y `pnpm-pages-deployment.png`.
