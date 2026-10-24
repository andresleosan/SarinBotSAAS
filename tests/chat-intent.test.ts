import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ complete: vi.fn(), provider: 'deepseek' }));
vi.mock('@/lib/sarin/engine', () => ({ completeChat: state.complete }));
vi.mock('@/lib/server/provider-settings', () => ({ getAiProviderSelection: async () => ({ provider: state.provider }) }));
import { interpretChat } from '@/lib/server/chat-intent';
import { privateBusinessDraft } from '@/lib/server/businesses';
import { businessConfigSchema } from '@/lib/server/schemas';
const business = { ...privateBusinessDraft({ uid: 'owner' }, 1000), services: [{ id: 'technical', name: 'Programación de audífonos', durationMinutes: 30, bufferMinutes: 0, price: 50000, resourceIds: ['one'] }], resources: [{ id: 'one', name: 'Uno', active: true }] };
const input = { mode: 'sarin_client' as const, message: 'Consulta', business, state: { version: 0, selection: {}, updatedAt: 0, expiresAt: 86400000 }, requestId: 'synthetic-request', actorUid: 'client' };
const call = (args: unknown) => ({ role: 'assistant', content: 'Untrusted free text never shown', tool_calls: [{ id: 'one', type: 'function', function: { name: 'interpretar_solicitud', arguments: JSON.stringify(args) } }] });
const configurationDraft = {
  name: 'Negocio sintético', category: 'Servicios', slug: 'demo-business', phoneWhatsApp: '+573001234567',
  tone: 'Claro', customRules: '', intakeFields: [], services: business.services, resources: business.resources,
  weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), { isOpen: false, intervals: [] }])),
};
const rememberedInput = { ...input, message: '¿Qué incluye el servicio desconocido X?', state: { ...input.state, selection: { serviceId: 'technical', resourceId: 'one', proposalId: 'old-proposal' } } };
const twoServiceInput = { ...rememberedInput, business: { ...business,
  services: [...business.services, { ...business.services[0], id: 'other', name: 'Otro servicio', resourceIds: ['two', 'inactive'] }],
  resources: [...business.resources, { id: 'two', name: 'Dos', active: true }, { id: 'inactive', name: 'Inactivo', active: false }],
} };
describe('closed business intent interpreter', () => {
  beforeEach(() => state.complete.mockReset());
  it('accepts explicit service_details with only the existing interpretation tool', async () => {
    state.complete.mockResolvedValue(call({ intent: 'service_details', selection: { serviceId: 'technical' } }));
    expect(await interpretChat(input)).toEqual({ intent: 'service_details', selection: { serviceId: 'technical' } });
    const tools = state.complete.mock.calls[0][1];
    expect(tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['interpretar_solicitud']);
    expect(tools[0].function.parameters.properties.intent.enum).toContain('service_details');
    expect(Object.keys(tools[0].function.parameters.properties)).toEqual(['intent', 'selection', 'configurationDraft']);
  });
  it('services keeps a remembered service without becoming details', async () => {
    state.complete.mockResolvedValue(call({ intent: 'services', selection: {} }));
    expect(await interpretChat(rememberedInput)).toEqual({ intent: 'services', selection: { serviceId: 'technical', resourceId: 'one' } });
  });
  it('multiple detail tool outputs remain a closed clarification', async () => {
    const output = call({ intent: 'service_details', selection: { serviceId: 'technical' } });
    state.complete.mockResolvedValue({ ...output, tool_calls: [...output.tool_calls, ...output.tool_calls] });
    expect(await interpretChat(input)).toEqual({ intent: 'clarify', selection: {} });
  });
  it('detailsMissingIdNeverReusesRememberedService', async () => {
    state.complete.mockResolvedValue(call({ intent: 'service_details', selection: {} }));
    expect(await interpretChat(rememberedInput)).toEqual({ intent: 'clarify', selection: rememberedInput.state.selection });
  });
  it('detailsUnknownIdNeverRescuesRememberedService', async () => {
    state.complete.mockResolvedValue(call({ intent: 'service_details', selection: { serviceId: 'unknown' } }));
    expect(await interpretChat(rememberedInput)).toEqual({ intent: 'clarify', selection: {} });
  });
  it('detailsDoesNotInheritIncompatibleResource', async () => {
    state.complete.mockResolvedValue(call({ intent: 'service_details', selection: { serviceId: 'other' } }));
    expect(await interpretChat(twoServiceInput)).toEqual({ intent: 'service_details', selection: { serviceId: 'other' } });
  });
  it('detailsDropsUnrequestedResourceEvenForSameService', async () => {
    state.complete.mockResolvedValue(call({ intent: 'service_details', selection: { serviceId: 'technical' } }));
    expect(await interpretChat(twoServiceInput)).toEqual({ intent: 'service_details', selection: { serviceId: 'technical' } });
  });
  it.each([
    { resourceId: 'two', expected: { intent: 'service_details', selection: { serviceId: 'other', resourceId: 'two' } } },
    { resourceId: 'one', expected: { intent: 'clarify', selection: {} } },
    { resourceId: 'unknown', expected: { intent: 'clarify', selection: {} } },
    { resourceId: 'inactive', expected: { intent: 'clarify', selection: {} } },
  ])('detailsExplicitResourceMustBeActiveAndCompatible: $resourceId', async ({ resourceId, expected }) => {
    state.complete.mockResolvedValue(call({ intent: 'service_details', selection: { serviceId: 'other', resourceId } }));
    expect(await interpretChat(twoServiceInput)).toEqual(expected);
  });
  it('malformed explicit detail resource keeps schema fallback', async () => {
    state.complete.mockResolvedValue(call({ intent: 'service_details', selection: { serviceId: 'other', resourceId: '../bad' } }));
    expect(await interpretChat(twoServiceInput)).toEqual({ intent: 'clarify', selection: twoServiceInput.state.selection });
  });
  it.each(['booking', 'availability'])('%s still inherits and validates resources', async intent => {
    state.complete.mockResolvedValue(call({ intent, selection: { serviceId: 'technical' } }));
    expect(await interpretChat(twoServiceInput)).toEqual({ intent, selection: { serviceId: 'technical', resourceId: 'one' } });
    state.complete.mockResolvedValue(call({ intent, selection: { serviceId: 'other' } }));
    expect(await interpretChat(twoServiceInput)).toEqual({ intent: 'clarify', selection: {} });
  });
  it('detailsNeverReturnsConfigurationDraft', async () => {
    expect(businessConfigSchema.safeParse(configurationDraft).success).toBe(true);
    state.complete.mockResolvedValue(call({ intent: 'service_details', selection: { serviceId: 'technical' }, configurationDraft }));
    expect(await interpretChat({ ...input, mode: 'sarin_onboarding' })).toEqual({ intent: 'service_details', selection: { serviceId: 'technical' } });
    await expect(interpretChat(input)).rejects.toMatchObject({ status: 403 });
  });
  it('missing detail ID drops an onboarding draft while retaining the prior selection', async () => {
    state.complete.mockResolvedValue(call({ intent: 'service_details', selection: {}, configurationDraft }));
    expect(await interpretChat({ ...rememberedInput, mode: 'sarin_onboarding' })).toEqual({ intent: 'clarify', selection: rememberedInput.state.selection });
  });
  it('configure_business still retains its valid onboarding draft', async () => {
    state.complete.mockResolvedValue(call({ intent: 'configure_business', selection: {}, configurationDraft }));
    expect(await interpretChat({ ...input, mode: 'sarin_onboarding' })).toEqual({ intent: 'configure_business', selection: {}, configurationDraft });
  });
  it.each([
    { intent: 'faq', selection: {} },
    { intent: 'service_details', selection: { serviceId: 'technical' }, answer: 'Invented FAQ' },
  ])('unknown intents or extra fields never produce FAQ or action', async args => {
    state.complete.mockResolvedValue(call(args));
    expect(await interpretChat(rememberedInput)).toEqual({ intent: 'clarify', selection: rememberedInput.state.selection });
  });
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
