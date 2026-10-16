import { constants } from 'node:fs';
import { copyFile, lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultOutput = fileURLToPath(new URL('../landing/out/', import.meta.url));
const source = fileURLToPath(new URL('../pages-gateway/worker.mjs', import.meta.url));
const routes = JSON.stringify({ version: 1, include: ['/*'], exclude: [] }, null, 2) + '\n';

async function existing(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function packagePagesGateway({ enabled = false, outputDirectory = defaultOutput } = {}) {
  if (!enabled) return { enabled: false };
  const directory = await existing(outputDirectory);
  const index = await existing(join(outputDirectory, 'index.html'));
  if (!directory?.isDirectory() || directory.isSymbolicLink() || !index?.isFile() || index.isSymbolicLink()) throw new Error('Primero genera una exportación landing válida.');
  const workerFile = join(outputDirectory, '_worker.js');
  const routesFile = join(outputDirectory, '_routes.json');
  const worker = await readFile(source);
  // Validate both destinations before writing either; preserve unrelated artifacts.
  for (const [file, content] of [[workerFile, worker], [routesFile, Buffer.from(routes)]]) {
    const previous = await existing(file);
    if (previous && (previous.isSymbolicLink() || !previous.isFile() || !(await readFile(file)).equals(content))) throw new Error('El destino contiene un worker o manifiesto ajeno; no se sobrescribió.');
  }
  if (!(await existing(workerFile))) await copyFile(source, workerFile, constants.COPYFILE_EXCL);
  if (!(await existing(routesFile))) await writeFile(routesFile, routes, { flag: 'wx' });
  if (!(await readFile(workerFile)).equals(worker)) throw new Error('El worker empaquetado no coincide con la fuente revisada.');
  return { enabled: true };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const argumentsList = process.argv.slice(2);
    if (argumentsList.some(argument => argument !== '--enable')) throw new Error('Usa únicamente --enable para preparar el gateway.');
    const result = await packagePagesGateway({ enabled: argumentsList.includes('--enable') });
    console.log(result.enabled ? 'Gateway Pages empaquetado sin secretos; no se ha publicado.' : 'Gateway desactivado; no se modificó el artefacto.');
  } catch {
    console.error('No se pudo empaquetar el gateway Pages. Revisa la exportación y los destinos locales.');
    process.exitCode = 1;
  }
}
