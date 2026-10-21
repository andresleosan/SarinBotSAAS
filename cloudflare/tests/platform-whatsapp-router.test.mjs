import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeEnvironment } from '../src/router.ts';

const baseline = {
  FIREBASE_ADMIN_PROJECT_ID: 'synthetic-project', FIREBASE_ADMIN_CLIENT_EMAIL: 'synthetic@example.test', FIREBASE_ADMIN_PRIVATE_KEY: 'synthetic',
  SUPERADMIN_UID: 'synthetic', SARIN_TUNNEL_URL: 'https://engine.alsdevstudio.com/v1/chat/completions', OLLAMA_MAIN_MODEL: 'synthetic', CF_ACCESS_CLIENT_ID: 'synthetic', CF_ACCESS_CLIENT_SECRET: 'synthetic',
};
const names = [
  'PLATFORM_WHATSAPP_RECEIVE_ENABLED', 'PLATFORM_WHATSAPP_RETENTION_ENABLED', 'PLATFORM_WHATSAPP_AI_ENABLED', 'PLATFORM_WHATSAPP_SEND_ENABLED',
  'PLATFORM_YCLOUD_WEBHOOK_SECRET', 'PLATFORM_WHATSAPP_CONTENT_KEY', 'PLATFORM_WHATSAPP_WABA_ID', 'PLATFORM_WHATSAPP_PHONE_E164', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID',
  'PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED', 'PLATFORM_YCLOUD_DIAGNOSTIC_RUN_ID', 'PLATFORM_YCLOUD_DIAGNOSTIC_EXPIRES_AT', 'PLATFORM_YCLOUD_DIAGNOSTIC_SENDER', 'PLATFORM_YCLOUD_DIAGNOSTIC_NONCE',
];
test('forwards fourteen original platform strings unchanged without Worker validation or defaults', () => {
  const values = Object.fromEntries(names.map((key, i) => [key, `  synthetic arbitrary ${i}  `]));
  const result = runtimeEnvironment({ ...baseline, ...values, PLATFORM_UNLISTED: 'private', SARIN_PUBLIC_BOOKING_ORIGIN: 'https://synthetic.example', PILOT_AI_BUDGET_ENFORCED: 'false' });
  for (const key of names) assert.equal(result[key], values[key]);
  assert.equal(result.PLATFORM_UNLISTED, undefined);
  assert.equal(result.SARIN_PUBLIC_BOOKING_ORIGIN, 'https://synthetic.example');
  assert.equal(result.PILOT_AI_BUDGET_ENFORCED, 'false');
  for (const key of names) assert.equal(runtimeEnvironment(baseline)[key], undefined);
});
test('omits blank and nonstring platform values and preserves identity, backend and engine rejection', () => {
  for (const value of ['', ' \t\n', true, false, 1, null, undefined, {}]) {
    const result = runtimeEnvironment({ ...baseline, ...Object.fromEntries(names.map(key => [key, value])) });
    for (const key of names) assert.equal(Object.hasOwn(result, key), false);
  }
  for (const override of [
    { SUPERADMIN_UID: '' }, { FIREBASE_ADMIN_PRIVATE_KEY: '' }, { FIREBASE_ADMIN_PROJECT_ID: 'demo-synthetic' },
    { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' }, { SARIN_DATA_BACKEND: 'other' }, { SARIN_MAINTENANCE: 'TRUE' }, { PILOT_AI_BUDGET_ENFORCED: 'yes' },
    { SARIN_TUNNEL_URL: 'https://synthetic.example/v1/chat/completions' }, { SARIN_TUNNEL_URL: 'http://engine.alsdevstudio.com/v1/chat/completions' },
    { SARIN_TUNNEL_URL: 'https://engine.alsdevstudio.com:8443/v1/chat/completions' }, { SARIN_TUNNEL_URL: 'https://engine.alsdevstudio.com/v1/chat/completions?private=1' },
    { FIREBASE_ADMIN_CREDENTIAL_MODE: 'adc', GOOGLE_APPLICATION_CREDENTIALS: 'synthetic-path' },
  ]) assert.throws(() => runtimeEnvironment({ ...baseline, PLATFORM_WHATSAPP_RETENTION_ENABLED: 'true', ...override }));
});
