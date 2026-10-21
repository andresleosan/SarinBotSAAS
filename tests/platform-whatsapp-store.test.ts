import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => { throw new Error('Default backend forbidden in synthetic tests'); } }));
import { applyPlatformWhatsAppConnectionControl as control, getPlatformWhatsAppStatus as status, platformWhatsAppConnectionControlSchema as schema,
  platformWhatsAppControlIdentity as controlIdentity, normalizePlatformWhatsAppConnection as normalize, isPlatformWhatsAppControlReplay as replay,
  assertPlatformWhatsAppNow, platformWhatsAppConversationControlSchema } from '@/lib/server/platform-whatsapp-store';
import { audit, configure, connection, connectionPath, memoryStore, now, scope } from './platform-whatsapp-test-fixtures';

beforeEach(configure); afterEach(() => vi.unstubAllEnvs());
describe('platform connection controls and status', () => {
  it('matches the frozen control SHA vector after schema ordering, independently of caller property order', () => {
    const parsed = schema.parse({ action: 'pause', requestId: 'demo-pause', expectedRevision: 0 });
    // Captured from pinned 9243.a; no derivation helper computes the expectation.
    expect(controlIdentity('demo-admin', 'demo-pause', parsed)).toEqual({
      id: 'control_3868af28f3e1653a7109aeb2ddbf9ccd0b5f0b503be3d617e3afd53c6caf31be',
      fingerprint: '2da270829b77d3b51556ae4c840f18bcbb8f711e949ed26f0b268a7f02078f02',
    });
    expect(controlIdentity('demo-admin', 'demo-pause', schema.parse({ expectedRevision: 0, action: 'pause', requestId: 'demo-pause' }))).toEqual(controlIdentity('demo-admin', 'demo-pause', parsed));
  });
  it('represents absent configuration without writes and preserves default backend initialization', async () => {
    vi.stubEnv('PLATFORM_WHATSAPP_WABA_ID', '');
    const store = memoryStore();
    expect(await status(store.db, now)).toMatchObject({ configured: false, scope: null, providerConnection: 'unverified', presentationState: 'not_configured', audit: [] });
    expect(store.seen).toHaveLength(1); expect(store.rows.size).toBe(0);
    await expect(status(undefined, -1)).rejects.toThrow('Default backend forbidden');
  });
  it('returns secret-free top-level unverified status without persisting a default connection', async () => {
    const store = memoryStore(), result = await status(store.db, now);
    expect(result).toMatchObject({ configured: true, scope, providerConnection: 'unverified', presentationState: 'configured_unverified', connectionRevision: 0, aiEnabled: false, sendEnabled: false, audit: [] });
    for (const field of ['paused', 'config', 'signingSecret', 'contentKey']) expect(result).not.toHaveProperty(field);
    expect(store.rows.size).toBe(0);
    expect(store.seen.at(-1)).toEqual({ action: 'read', read: { kind: 'query', path: 'platformWhatsAppEvents', filters: [{ field: 'phoneNumberId', op: '==', value: scope.phoneNumberId }, { field: 'state', op: '==', value: 'connection_control' }], order: [{ field: 'updatedAt', direction: 'desc' }], limit: 51 } });
  });
  it('registers a disconnected connection without resuming it and resumes explicitly even with receive off', async () => {
    const store = memoryStore();
    await control({ action: 'disconnect', expectedRevision: 0, requestId: 'demo-disconnect' }, 'demo-admin', store.db, now);
    const saved = await control({ ...scope, action: 'record_connected', expectedRevision: 1, requestId: 'demo-connect' }, 'demo-admin', store.db, now + 1);
    expect(saved).toMatchObject({ connectionRevision: 2, providerConnection: 'connected', pausedReason: 'manual', presentationState: 'paused', connectedBy: 'demo-admin' });
    expect(store.rows.get(connectionPath)).toMatchObject({ paused: true, connectedRevision: 2 });
    vi.stubEnv('PLATFORM_WHATSAPP_RECEIVE_ENABLED', 'false');
    expect(await control({ action: 'resume', expectedRevision: 2, requestId: 'demo-resume' }, 'demo-admin', store.db, now + 2)).toMatchObject({ connectionRevision: 3, presentationState: 'automation_blocked', pausedReason: null });
    vi.stubEnv('PLATFORM_WHATSAPP_RECEIVE_ENABLED', 'true');
    expect((await status(store.db, now + 2)).presentationState).toBe('automation_blocked');
  });
  it.each([
    [connection({ providerConnection: 'disconnected', paused: true, pausedReason: 'disconnected' }), 'disconnected'],
    [connection({ paused: true, pausedReason: 'manual' }), 'paused'],
    [connection({ providerConnection: 'connected' }), 'automation_blocked'],
    [connection({ providerConnection: 'connected', lastSignedInboundAt: 0 }), 'receiving_human'],
    [connection({ providerConnection: 'connected', lastHumanEchoAt: 0 }), 'receiving_human'],
  ])('preserves presentation precedence %#', async (value, state) => {
    const store = memoryStore(); store.seed(connectionPath, value);
    expect((await status(store.db, now)).presentationState).toBe(state);
  });
  it('replays before checking revision and returns current status without another write', async () => {
    const store = memoryStore(), input = { action: 'pause', expectedRevision: 0, requestId: 'demo-pause' };
    store.loseNextResponse(); await control(input, 'demo-admin', store.db, now);
    await control({ ...input, requestId: 'demo-second', expectedRevision: 1 }, 'demo-admin', store.db, now + 1);
    const before = structuredClone([...store.rows]);
    expect((await control(input, 'demo-admin', store.db, now + 2)).connectionRevision).toBe(2);
    expect([...store.rows]).toEqual(before);
    await expect(control({ ...input, action: 'disconnect' }, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 409 });
    await expect(control({ ...input, requestId: 'demo-stale' }, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 409 });
  });
  it('rejects corrupted connections, mismatched scope and invalid expired audit before revision handling', async () => {
    expect(() => normalize(null, scope, now)).toThrow(); expect(() => normalize(undefined, null, now)).toThrow();
    expect(() => normalize(connection({ wabaId: '99999' }), scope, now)).toThrow();
    expect(() => replay({ expiresAt: 0 }, 'a'.repeat(64), now)).toThrow();
    const old = audit({ receivedAt: now - 2_592_000_000, updatedAt: now - 2_592_000_000, expiresAt: now });
    expect(replay(old, 'wrong', now)).toBe(false);
    expect(() => replay(audit(), 'wrong', now)).toThrow();
  });
  it('bounds, filters then revision-sorts the 51 audit rows before connectedBy resolution', async () => {
    const store = memoryStore(); store.seed(connectionPath, connection({ providerConnection: 'connected', connectedRevision: 9 }));
    for (let index = 0; index < 53; index++) store.seed(`platformWhatsAppEvents/control_${index}`, audit({ receivedAt: now - index, updatedAt: now - index, expiresAt: now - index + 2_592_000_000, resultRevision: index, action: index === 9 ? 'record_connected' : 'pause' }));
    store.seed('platformWhatsAppEvents/control_bad', { ...audit(), extra: true });
    store.seed('platformWhatsAppEvents/control_scope', audit({ wabaId: '99999' }));
    const result = await status(store.db, now);
    expect(result.audit).toHaveLength(49); expect(result.audit[0].revision).toBe(48);
    expect(result.connectedBy).toBe('demo-admin');
    expect((await status(store.db, now + 2_592_000_000)).connectedBy).toBeNull();
  });
  it.each([-1, 0.1, NaN, Infinity, 8_640_000_000_000_000 - 2_592_000_000 + 1])('rejects invalid now %s', value => {
    expect(() => assertPlatformWhatsAppNow(value)).toThrow('Fecha no válida.');
  });
  it('accepts now endpoints and strict controls while rejecting hidden flags and allowing explicit bot mode', () => {
    assertPlatformWhatsAppNow(0); assertPlatformWhatsAppNow(8_640_000_000_000_000 - 2_592_000_000);
    expect(schema.safeParse({ action: 'pause', expectedRevision: 0, requestId: 'demo-valid', paused: true }).success).toBe(false);
    expect(schema.safeParse({ action: 'pause', expectedRevision: 0, requestId: 'demo-valid\n' }).success).toBe(false);
    expect(platformWhatsAppConversationControlSchema.safeParse({ conversationId: 'a'.repeat(64), mode: 'bot', expectedRevision: 0, requestId: 'demo-valid' }).success).toBe(true);
    expect(platformWhatsAppConversationControlSchema.safeParse({ conversationId: 'a'.repeat(64), mode: 'unknown', expectedRevision: 0, requestId: 'demo-valid' }).success).toBe(false);
    for (const actor of ['', '😀'.repeat(65), null]) expect(() => controlIdentity(actor as string, 'demo-valid', {})).toThrow('Actor no válido.');
    expect(controlIdentity(' ', 'demo-valid', {}).id).toMatch(/^control_[a-f0-9]{64}$/);
  });
  it('requires connected and configured state for resume and exact configured scope for record_connected', async () => {
    const store = memoryStore();
    await expect(control({ action: 'resume', expectedRevision: 0, requestId: 'demo-resume' }, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 409 });
    await expect(control({ ...scope, wabaId: '99999', action: 'record_connected', expectedRevision: 0, requestId: 'demo-connect' }, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 409 });
    await expect(control({ action: 'pause', expectedRevision: -1, requestId: 'demo-invalid' }, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 400 });
    expect(store.rows.size).toBe(0);
  });
  it('rejects a max-safe revision record structurally before optimistic control and does not write', async () => {
    // Shared record integers stop at Date's maximum, below MAX_SAFE_INTEGER.
    const store = memoryStore(); store.seed(connectionPath, connection({ connectionRevision: Number.MAX_SAFE_INTEGER }));
    await expect(control({ action: 'pause', expectedRevision: Number.MAX_SAFE_INTEGER, requestId: 'demo-maximum' }, 'demo-admin', store.db, now)).rejects.toMatchObject({ status: 503 });
    expect(store.seen.some(c => c.action === 'commit')).toBe(false);
  });
  it('reuses an expired request only as a new revision and preserves disconnected pause reason', async () => {
    const store = memoryStore(); await control({ action: 'disconnect', expectedRevision: 0, requestId: 'demo-disconnect' }, 'demo-admin', store.db, now);
    expect(await control({ action: 'pause', expectedRevision: 1, requestId: 'demo-disconnect' }, 'demo-admin', store.db, now + 2_592_000_000)).toMatchObject({ connectionRevision: 2, providerConnection: 'disconnected', pausedReason: 'disconnected' });
    expect((await status(store.db, now + 2_592_000_000)).audit).toHaveLength(1);
  });
  it('caps valid audit output at 50 after the bounded read', async () => {
    const store = memoryStore();
    for (let index = 0; index < 55; index++) store.seed(`platformWhatsAppEvents/control_${index}`, audit({ resultRevision: index }));
    const result = await status(store.db, now); expect(result.audit).toHaveLength(50);
    expect(result.audit.every((value, index, rows) => index === 0 || rows[index - 1].revision >= value.revision)).toBe(true);
  });
});
