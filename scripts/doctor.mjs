import { parseDoctorFlags, runDoctor } from './lib/doctor.mjs';

const help = `Sarin Doctor — diagnóstico local sin Firebase

Uso: npm run doctor -- [--engine] [--generate] [--vision]

Sin opciones: revisa configuración local y Node.js 24, sin conexiones ni inferencia.
  --engine    Hace un GET /v1/models (máximo 8 segundos); no genera texto.
  --generate  Hace una inferencia de texto sintético (máximo 120 segundos).
  --vision    Hace una inferencia con una imagen sintética local (máximo 120 segundos).
  --help      Muestra esta ayuda.

Firebase se comprueba solo por presencia de variables; no se validan credenciales reales.
Los datos, secretos, direcciones y respuestas de modelos no se imprimen.
Cada opción de inferencia hace una sola petición, sin reintentos.
Las variables se cargan desde .env.local mediante el comando npm; no se aceptan secretos como argumentos.
Los pendientes de Firebase permiten continuar el trabajo local; los errores terminan con código 1.`;

try {
  const parsed = parseDoctorFlags(process.argv.slice(2));
  if (parsed.help) console.log(help);
  else {
    const report = await runDoctor({ env: process.env, nodeVersion: process.version, flags: parsed.flags });
    console.log('Sarin Doctor — Firebase: solo presencia de variables; no se validaron credenciales reales.');
    for (const check of report.checks) console.log(`[${check.status.toUpperCase()}] ${check.check}: ${check.message}`);
    process.exitCode = report.exitCode;
  }
} catch {
  // Unknown arguments may themselves contain secrets. Never echo them or an error stack.
  console.error('No se pudo ejecutar el diagnóstico. Revisa las opciones con --help y usa Node.js 24 LTS.');
  process.exitCode = 1;
}
