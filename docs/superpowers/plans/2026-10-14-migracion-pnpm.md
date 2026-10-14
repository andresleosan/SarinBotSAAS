# Migración de Sarin Bot a pnpm

Autorizada por el propietario: migrar y retirar los archivos de npm cuando la migración pase sus verificaciones. Node permanece en 24; pnpm se fija en 11.23.0. Firebase real sigue pendiente y no se conecta Ollama ni la Mac.

1. Aislar el cambio en `chore/pnpm-migration`, conservar la copia de trabajo original y comparar con la suite npm previa.
2. Importar ambos lockfiles a un único workspace de la app y `cloudflare`; conservar versiones, integridades y overrides existentes. Revisar y permitir scripts de instalación solo para versiones conocidas.
3. Adaptar launcher, ayudas, Docker, CI y documentación a pnpm. Declarar como directa cualquier dependencia que el código importe y npm resolviera incidentalmente.
4. Verificar instalación congelada, tipos, pruebas unitarias, reglas Firestore, recorrido local, builds de app/portada, Worker y Docker antes de retirar ambos `package-lock.json` y los overrides exclusivos de npm.
5. Ajustar Pages al comando pnpm y `PNPM_VERSION=11.23.0`, integrar mediante fast-forward, instalar el workspace original y hacer push a `main`.
6. Confirmar CI y publicación reales; registrar evidencia y dejar los comandos de desarrollo pnpm operativos.

La caché global de npm y el npm incluido con Node no se desinstalan. Docker usa npm únicamente para instalar la CLI fija de pnpm en la etapa de construcción. Las variables estándar `npm_execpath` y `npm_config_user_agent` siguen siendo parte del contrato de scripts de pnpm. Los informes históricos conservan sus comandos originales.
