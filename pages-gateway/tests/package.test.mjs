import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packagePagesGateway } from '../../scripts/package-pages-gateway.mjs';

test('packaging requires explicit enable and copies only reviewed worker bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sarin-pages-gateway-'));
  const outputDirectory = join(directory, 'out');
  await mkdir(outputDirectory);
  await writeFile(join(outputDirectory, 'index.html'), '<h1>Landing</h1>');
  await writeFile(join(directory, '.env.production'), 'DO_NOT_COPY=synthetic');
  assert.deepEqual(await packagePagesGateway({ outputDirectory }), { enabled: false });
  await assert.rejects(access(join(outputDirectory, '_worker.js')));
  assert.deepEqual(await packagePagesGateway({ enabled: true, outputDirectory }), { enabled: true });
  assert.equal(await readFile(join(outputDirectory, '_worker.js'), 'utf8'), await readFile(new URL('../worker.mjs', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(await readFile(join(outputDirectory, '_routes.json'), 'utf8')), { version: 1, include: ['/*'], exclude: [] });
  await assert.rejects(access(join(outputDirectory, '.env.production')));
  assert.deepEqual(await packagePagesGateway({ enabled: true, outputDirectory }), { enabled: true });
});

test('packaging refuses an absent landing export or an unrelated worker', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'sarin-pages-gateway-'));
  await assert.rejects(packagePagesGateway({ enabled: true, outputDirectory }), /landing/i);
  await writeFile(join(outputDirectory, 'index.html'), '<h1>Landing</h1>');
  await writeFile(join(outputDirectory, '_worker.js'), 'user-owned worker');
  await assert.rejects(packagePagesGateway({ enabled: true, outputDirectory }), /worker/i);
  assert.equal(await readFile(join(outputDirectory, '_worker.js'), 'utf8'), 'user-owned worker');
});
