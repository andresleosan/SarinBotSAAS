import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseLocalArguments } from './lib/local-development.mjs';
import { assertEmulatorInventory, assertJourneyUrl, journeyEnvironment } from './lib/local-journey.mjs';

// Opt-in integration against existing loopback services only. Never starts a
// service, reads an env file, accepts a project/URL/token or contacts an LLM.
try {
  const options = parseLocalArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Uso: pnpm run test:journey [--port 3030]\nRequiere dev:local activo: Next en loopback, Auth 9099, Firestore 8080 y hub 4400.\nNode 24 y dependencias instaladas. Usa el proyecto demo-sarin-bot; no necesita Firebase real ni Ollama.\nCrea cuentas/datos sintéticos por corrida y verifica su limpieza; conserva cuentas sembradas y datos manuales.');
  } else {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Este ensayo requiere Node.js 24.');
    const env = journeyEnvironment(process.env, options.port, randomUUID());
    const checkedFetch = (url) => fetch(assertJourneyUrl(url, options.port), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    const [auth, firestore, hub, unauthorized] = await Promise.all([
      checkedFetch('http://127.0.0.1:9099/'), checkedFetch('http://127.0.0.1:8080/'),
      checkedFetch('http://127.0.0.1:4400/emulators'), checkedFetch(`http://127.0.0.1:${options.port}/api/businesses`),
    ]);
    if (!auth.ok || !(await auth.json()).authEmulator?.ready || !firestore.ok || !hub.ok || unauthorized.status !== 401) throw new Error('Los servicios locales no corresponden al ensayo. Inicia pnpm run dev:local y comprueba --port.');
    assertEmulatorInventory(await hub.json());
    console.log('Servicios oficiales en loopback confirmados. Ejecutando el recorrido real sin inferencia.');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const child = spawn(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'scripts/journey.vitest.config.mts', '--reporter=verbose'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    process.exitCode = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => done(code ?? 1)); });
  }
} catch {
  // Network/SDK errors can include request headers. Report only a fixed local
  // diagnostic; the fixture reports each verified phase without token/data dumps.
  console.error('No se pudo ejecutar el ensayo local. Revisa Node 24, dev:local activo, el puerto y sus emuladores loopback; no se inició ningún servicio.');
  process.exitCode = 1;
}
