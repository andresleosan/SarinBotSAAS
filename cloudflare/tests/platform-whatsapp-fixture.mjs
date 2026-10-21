import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { executeDataCommand } from '../src/data.ts';

const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler/package.json'))('miniflare');
const schema = readFileSync(new URL('../migrations/0001_data.sql', import.meta.url), 'utf8');
export const now = 3_000_000_000;
export const scope = { version: 1, provider: 'ycloud', purpose: 'platform_support', wabaId: '123456', phoneE164: '+573001234567', phoneNumberId: '654321' };
const digest = 'a'.repeat(64);
const cipher = { version: 1, iv: 'A'.repeat(16), tag: 'A'.repeat(22) + '==', data: 'AAAA' };
export const event = (receivedAt = now - 86_400_000, extra = {}) => ({
  ...scope, recordType: 'event', state: 'body_present', connectionRevision: 7, conversationId: digest,
  kind: 'incoming_text', occurredAt: receivedAt, canonicalIdentity: digest, fingerprint: digest,
  receivedAt, expiresAt: receivedAt + 2_592_000_000, bodyExpiresAt: receivedAt + 86_400_000, content: { ...cipher }, ...extra,
});
export const conversation = (extra = {}) => ({
  ...scope, recordType: 'conversation', state: 'body_present', mode: 'review', revision: 9,
  updatedAt: 2_900_000_000, lastInboundAt: 2_900_000_000, lastHumanAt: null, conflictAt: null,
  previewOccurredAt: 2_913_600_000, previewReceivedAt: 2_913_600_000, bodyExpiresAt: now,
  expiresAt: 5_505_600_000, canonicalIdentity: digest, contactContent: { ...cipher }, ...extra,
});
export const set = (path, data) => ({ op: 'set', path, data });
export const read = path => ({ action: 'read', read: { kind: 'document', path } });
export const commit = (revision, writes) => ({ action: 'commit', expectedRevision: revision, requestId: crypto.randomUUID(), writes });
export async function fixture(context) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("synthetic")}}', compatibilityDate: '2026-10-13', d1Databases: { SARIN_DB: 'platform-retention-test' } }));
  context.after(() => mf.dispose());
  const env = { SARIN_DB: await mf.getD1Database('SARIN_DB'), SARIN_FILES: new Proxy({}, { get() { throw new Error('Retention must not access R2'); } }) };
  await env.SARIN_DB.exec(schema.replace(/^--.*$/gm, '').replace(/\r?\n/g, ' '));
  return env;
}
export async function seed(env, writes) {
  const { revision } = await executeDataCommand(read('serverSettings/platform_whatsapp'), env);
  return executeDataCommand(commit(revision, writes), env);
}
export async function get(env, path) { return (await executeDataCommand(read(path), env)).documents[0]?.data; }

// Inspect statements while executing the actual migration, SQL, codec and CAS.
export function observeDatabase(env, batch) {
  const database = env.SARIN_DB;
  const descriptions = new WeakMap();
  function wrap(statement, sql, values = []) {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...parameters) => wrap(target.bind(...parameters), sql, parameters);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    descriptions.set(proxy, { statement, sql, values });
    return proxy;
  }
  return { ...env, SARIN_DB: {
    prepare: sql => wrap(database.prepare(sql), sql),
    batch: statements => {
      const entries = statements.map(statement => descriptions.get(statement));
      return batch(entries, () => database.batch(entries.map(entry => entry.statement)), database);
    },
  } };
}
