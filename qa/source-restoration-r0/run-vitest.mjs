import { startVitest } from 'vitest/node';
import { resolve } from 'node:path';

// Use the unchanged candidate vitest.config.mts and installed runner.
// Runner loading avoids Vite temporary writes through the dependency junction.
const context = await startVitest('test', [], {
  run: true,
  maxWorkers: 4,
  reporters: ['default', 'json'],
  outputFile: { json: resolve('qa/source-restoration-r0/vitest-results.json') },
  cache: false,
  fsModuleCachePath: resolve('qa/source-restoration-r0/cache/modules'),
}, {
  cacheDir: resolve('qa/source-restoration-r0/cache/vite'),
  configLoader: 'runner',
  envDir: false,
});
await context?.close();
