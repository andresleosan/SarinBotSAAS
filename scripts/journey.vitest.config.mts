import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  envDir: false,
  publicDir: false,
  resolve: { alias: {
    '@': fileURLToPath(new URL('../src', import.meta.url)),
    'server-only': fileURLToPath(new URL('../tests/server-only.ts', import.meta.url)),
  } },
  test: { environment: 'node', include: ['tests/local-journey.integration.test.ts'], testTimeout: 240000 },
});
