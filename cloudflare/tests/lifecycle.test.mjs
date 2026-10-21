import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as runtime from '../src/router.ts';

test('background startup does not create or wake a container when both WhatsApp flags are off', async () => {
  const get = () => assert.fail('Disabled background work must not acquire a container.');
  await runtime.wakeBackgroundSingleton({}, get);
  await runtime.wakeBackgroundSingleton({ WHATSAPP_ENABLED: 'false', WHATSAPP_RETENTION_ENABLED: 'false' }, get);
  await runtime.wakeBackgroundSingleton({ WHATSAPP_ENABLED: true, WHATSAPP_RETENTION_ENABLED: 'TRUE' }, get);
  await runtime.wakeBackgroundSingleton({ WHATSAPP_ENABLED: 'true', SARIN_MAINTENANCE: 'true' }, get);
});

test('either explicit background flag starts the same singleton without an application request', async () => {
  for (const env of [{ WHATSAPP_ENABLED: 'true' }, { WHATSAPP_RETENTION_ENABLED: 'true' }, { WHATSAPP_ENABLED: 'true', WHATSAPP_RETENTION_ENABLED: 'true' }]) {
    const names = [];
    let starts = 0;
    await runtime.wakeBackgroundSingleton(env, name => {
      names.push(name);
      return { startAndWaitForPorts: async () => { starts++; } };
    });
    assert.deepEqual(names, ['sarin-global-app']);
    assert.equal(starts, 1);
    assert.equal(runtime.backgroundWorkEnabled(env), true);
  }
  assert.equal(runtime.backgroundWorkEnabled({ WHATSAPP_ENABLED: 'false', WHATSAPP_RETENTION_ENABLED: 'false' }), false);
});

test('a failed scheduled start makes one attempt and exposes no identity or transport details', async () => {
  let attempts = 0;
  await assert.rejects(runtime.wakeBackgroundSingleton({ WHATSAPP_RETENTION_ENABLED: 'true' }, () => ({
    startAndWaitForPorts: async () => { attempts++; throw new Error('private-token and internal-hostname'); },
  })), error => {
    assert.doesNotMatch(error.message, /private-token|internal-hostname/);
    return true;
  });
  assert.equal(attempts, 1);
});

test('installed SDK dispatches the virtual identity host through its registered handler', async (context) => {
  // Use the installed proxy implementation; only its platform-owned base classes
  // need substituting because Node cannot resolve the cloudflare:workers runtime.
  const platform = 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } export class WorkerEntrypoint extends DurableObject {}');
  const hooks = registerHooks({
    resolve(specifier, options, next) {
      if (specifier === 'cloudflare:workers') return { url: platform, shortCircuit: true };
      try { return next(specifier, options); }
      catch (error) {
        // The pinned SDK publishes extensionless relative ESM imports for Wrangler.
        if (specifier.startsWith('.') && options.parentURL?.includes('@cloudflare')) return next(`${specifier}.js`, options);
        throw error;
      }
    },
  });
  context.after(() => hooks.deregister());
  const networkFetch = globalThis.fetch;
  globalThis.fetch = async () => assert.fail('The internal identity request must never reach the Internet.');
  context.after(() => { globalThis.fetch = networkFetch; });
  const { ContainerProxy, SarinApp } = await import('../src/index.ts');
  const env = {
    SARIN_APP: { idFromName: name => ({ toString: () => name === 'sarin-global-app' ? 'singleton-id' : 'wrong-id' }) },
    SARIN_IDENTITY: { getByName: () => ({ mintToken: async () => ({ subject_token: 'synthetic-assertion' }) }) },
  };
  const proxy = new ContainerProxy({ props: { className: SarinApp.name, containerId: 'singleton-id', enableInternet: true, interceptAll: false } }, env);
  const response = await proxy.fetch(new Request('http://sarin-google.internal/token'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { subject_token: 'synthetic-assertion' });
  const dataEndpoint = await proxy.fetch(new Request('http://sarin-data.internal/execute'));
  assert.equal(dataEndpoint.status, 405);
  assert.equal((await dataEndpoint.json()).code, 'DATA_INVALID');

  const audioEndpoint = await proxy.fetch(new Request('http://sarin-audio.internal/transcribe'));
  assert.equal(audioEndpoint.status, 405);
  assert.deepEqual(await audioEndpoint.json(), { ok: false, reason: 'denied' });

  const metadata = await (await import('../src/index.ts')).default.fetch(new Request('https://sarinbotsaas.pages.dev/.well-known/openid-configuration'), { SARIN_MAINTENANCE: 'true' });
  assert.equal(metadata.status, 200);
});
