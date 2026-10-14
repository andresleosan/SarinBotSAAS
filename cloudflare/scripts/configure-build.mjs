import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publicBuildArguments } from '../src/router.ts';

// Deliberately reads no env files and no account credentials. CI or an explicit
// Node --env-file option provides only the public Firebase build configuration.
export function configureBuild(environment = process.env, destination = new URL('../wrangler.build.json', import.meta.url)) {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  config.containers[0].image_vars = publicBuildArguments(environment);
  writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { configureBuild(); console.log('Configuración de build preparada con cuatro valores públicos. No se ha desplegado.'); }
  catch (error) { console.error(error instanceof Error ? error.message : 'No se pudo preparar el build.'); process.exitCode = 1; }
}
