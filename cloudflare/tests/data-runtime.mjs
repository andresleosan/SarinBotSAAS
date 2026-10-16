import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Test-only Workerd + real local D1/R2, without network or account credentials. */
export async function createDataTestRuntime() {
  const require = createRequire(import.meta.url);
  const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
  const { build } = wranglerRequire('esbuild');
  const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), contents: `
      import {executeDataCommand, DataError} from './src/data.ts';
      export default { async fetch(request, env) {
        try { return Response.json(await executeDataCommand(await request.json(), env)); }
        catch (error) { return Response.json({code:error instanceof DataError ? error.code : 'DATA_UNAVAILABLE', error:'Storage unavailable'}, {status:error instanceof DataError ? error.status : 503}); }
      }};
    ` }, bundle: true, write: false, format: 'esm', platform: 'browser',
  });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-13', d1Databases: { SARIN_DB: 'sarin-data-test' }, r2Buckets: { SARIN_FILES: 'sarin-files-test' } }));
  try {
    const db = await mf.getD1Database('SARIN_DB');
    const bucket = await mf.getR2Bucket('SARIN_FILES');
    const schema = readFileSync(new URL('../migrations/0001_data.sql', import.meta.url), 'utf8');
    await db.exec(schema.replace(/^--.*$/gm, '').replace(/\r?\n/g, ' '));
    return { db, bucket, dispose: () => mf.dispose(), fetch: command => mf.dispatchFetch('http://sarin-data.test/execute', { method: 'POST', body: JSON.stringify(command) }) };
  } catch (error) { await mf.dispose(); throw error; }
}
