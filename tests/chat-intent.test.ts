import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ complete: vi.fn(), provider: 'deepseek' }));
vi.mock('@/lib/sarin/engine', () => ({ completeChat: state.complete }));
vi.mock('@/lib/server/provider-settings', () => ({ getAiProviderSelection: async () => ({ provider: state.provider }) }));
import { interpretChat } from '@/lib/server/chat-intent';
import { privateBusinessDraft } from '@/lib/server/businesses';
const business = { ...privateBusinessDraft({ uid: 'owner' }, 1000), services: [{ id: 'technical', name: 'Programación de audífonos', durationMinutes: 30, bufferMinutes: 0, price: 50000, resourceIds: ['one'] }], resources: [{ id: 'one', name: 'Uno', active: true }] };
const input = { mode: 'sarin_client' as const, message: 'Consulta', business, state: { version: 0, selection: {}, updatedAt: 0, expiresAt: 86400000 }, requestId: 'synthetic-request', actorUid: 'client' };
const call = (args: unknown) => ({ role: 'assistant', content: 'Untrusted free text never shown', tool_calls: [{ id: 'one', type: 'function', function: { name: 'interpretar_solicitud', arguments: JSON.stringify(args) } }] });
describe('closed business intent interpreter', () => {
  beforeEach(() => state.complete.mockReset());
  it('accepts a technical legitimate service with only one read-only interpretation tool', async () => {
    state.complete.mockResolvedValue(call({ intent: 'price', selection: { serviceId: 'technical' } }));
    expect(await interpretChat(input)).toEqual({ intent: 'price', selection: { serviceId: 'technical' } });
    expect(state.complete.mock.calls[0][1].map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['interpretar_solicitud']);
    expect(state.complete.mock.calls[0][2].provider).toBe('deepseek');
  });
  it.each([{ content: 'Write an essay' }, call({ intent: 'price', selection: { serviceId: 'another-tenant' } }), call({ intent: 'services', selection: {}, tenantId: 'evil' })])('uses a fixed clarification for malformed output', async response => {
    state.complete.mockResolvedValue(response);
    expect((await interpretChat(input)).intent).toBe('clarify');
  });
  it('rejects owner operations in client mode and never exposes model text', async () => {
    state.complete.mockResolvedValue(call({ intent: 'owner_agenda', selection: {} }));
    await expect(interpretChat(input)).rejects.toMatchObject({ status: 403 });
    state.complete.mockResolvedValue(call({ intent: 'out_of_scope', selection: {} }));
    expect(JSON.stringify(await interpretChat(input))).not.toContain('Untrusted free text');
  });
  it.each(['owner_agenda', 'owner_usage', 'owner_block'])('does not expose copilot intent %s through onboarding', async intent => {
    state.complete.mockResolvedValue(call({ intent, selection: {} }));
    await expect(interpretChat({ ...input, mode: 'sarin_onboarding', actorUid: 'owner' })).rejects.toMatchObject({ status: 403 });
  });
});
