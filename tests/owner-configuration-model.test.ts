import { describe, expect, it } from 'vitest';
import type { Business } from '@/types/firestore';
import type { BusinessConfig } from '@/lib/server/schemas';
import type { BookingCapability } from '@/lib/booking-subject';
import { businessConfigSchema } from '@/lib/server/schemas';
import {
  configurationDifferences, configurationFingerprint, configurationSectionForPath,
  createOwnerConfigurationDraft, effectiveOwnerConfiguration,
  mergeOwnerConfigurationProposal, validateOwnerConfiguration,
} from '@/lib/owner-configuration';

const general: BookingCapability = { configured: true, revision: 1, dataMode: 'general', representedMinorsEnabled: false };
function config(): BusinessConfig {
  return {
    name: 'Negocio sintético', category: 'Servicios', slug: 'negocio-demo', phoneWhatsApp: '573001234567',
    socialLinks: [{ platform: 'website', url: 'https://example.test/' }],
    location: { mode: 'at_business', address: 'Dirección sintética' }, tone: 'Claro', customRules: 'Solo información',
    intakeFields: [{ key: 'pregunta_estable', label: 'Preferencia general', required: false }],
    resources: [{ id: 'principal', name: 'Persona', active: true }],
    services: [{ id: 'servicio', name: 'Servicio', description: 'Detalle', category: 'Categoría', durationMinutes: 30, bufferMinutes: 5, price: 20000, resourceIds: ['principal'] }],
    weeklySchedule: { '0': { isOpen: false, intervals: [] }, '1': { isOpen: false, intervals: [] }, '2': { isOpen: false, intervals: [] }, '3': { isOpen: false, intervals: [] }, '4': { isOpen: false, intervals: [] }, '5': { isOpen: false, intervals: [] }, '6': { isOpen: false, intervals: [] } },
  };
}
function business(completed = true): Business {
  const c = config();
  return { ...c, location: c.location ?? undefined, id: 'demo', ownerUid: 'owner', ownerEmail: 'owner@example.test', timezone: 'America/Bogota', createdAt: 1,
    subscription: { status: 'active', trialEndsAt: 0, currentPeriodEndsAt: 9999999999999 },
    sarinConfig: { onboardingCompleted: completed, tone: c.tone, customRules: c.customRules, intakeFields: c.intakeFields } };
}

describe('owner configuration model', () => {
  it('creates unpublished defaults instead of exposing provisioned business placeholders', () => {
    const draft = createOwnerConfigurationDraft(business(false));
    expect(draft).toMatchObject({ name: '', slug: '', category: '', phoneWhatsApp: '', tone: 'Cercano y profesional', customRules: '', intakeFields: [], socialLinks: [], location: null,
      resources: [{ id: 'principal', name: '', active: true }], services: [{ id: 'principal', name: '', durationMinutes: 30, bufferMinutes: 0, price: 0, resourceIds: ['principal'] }] });
    expect(Object.values(draft.weeklySchedule)).toHaveLength(7);
    expect(Object.values(draft.weeklySchedule).every(day => !day.isOpen && day.intervals.length === 0)).toBe(true);
    expect(configurationFingerprint(draft)).toContain('principal');
  });

  it('projects and clones configured values without private business fields', () => {
    const original = business();
    const draft = createOwnerConfigurationDraft(original);
    expect(draft).toEqual(config());
    draft.resources[0].name = 'Modificado';
    draft.intakeFields[0].label = 'Otro';
    expect(original.resources[0].name).toBe('Persona');
    expect(original.sarinConfig.intakeFields[0].label).toBe('Preferencia general');
    expect(draft).not.toHaveProperty('ownerEmail');
    expect(draft).not.toHaveProperty('subscription');
  });

  it('stepValidationDoesNotRequireFutureSteps', () => {
    const draft = config(); draft.services[0].name = ''; draft.resources[0].name = '';
    expect(validateOwnerConfiguration(draft, general, 'identity')).toEqual([]);
    expect(validateOwnerConfiguration(draft, general, 'review').map(issue => issue.section)).toContain('services');
  });

  it('reviewFindsHiddenInvalidResourceReference', () => {
    const draft = config(); draft.services[0].resourceIds = ['missing'];
    expect(validateOwnerConfiguration(draft, general, 'review')).toContainEqual({ path: 'services.0.resourceIds', section: 'services', message: 'El servicio referencia un recurso desconocido.' });
    expect(validateOwnerConfiguration(draft, general, 'identity')).toEqual([]);
  });

  it('maps duplicate identifiers to each real collection and schema fields to their sections', () => {
    const draft = config();
    draft.resources.push({ ...draft.resources[0] }); draft.services.push({ ...draft.services[0] }); draft.intakeFields.push({ ...draft.intakeFields[0] });
    draft.phoneWhatsApp = 'invalid'; draft.weeklySchedule['1'] = { isOpen: true, intervals: [{ start: '15:00', end: '14:00' }] };
    const issues = validateOwnerConfiguration(draft, general);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'resources', section: 'resources' }), expect.objectContaining({ path: 'services', section: 'services' }),
      expect.objectContaining({ path: 'intakeFields', section: 'assistant' }), expect.objectContaining({ path: 'phoneWhatsApp', section: 'identity' }),
      expect.objectContaining({ path: 'weeklySchedule.1.intervals.0', section: 'schedule' }),
    ]));
    expect(configurationSectionForPath('location.address')).toBe('identity');
    expect(configurationSectionForPath('customRules')).toBe('assistant');
    expect(configurationSectionForPath('unknown')).toBe('review');
  });

  it('allows seven closed days using the existing schema', () => {
    expect(businessConfigSchema.safeParse(config()).success).toBe(true);
    expect(validateOwnerConfiguration(config(), general)).toEqual([]);
  });

  it('proposalOmissionPreservesMetadataAndExplicitClears', () => {
    const prior = config(); const proposal = config();
    delete proposal.socialLinks; delete proposal.location; delete proposal.services[0].description; delete proposal.services[0].category;
    proposal.services[0].price = 25000;
    const merged = mergeOwnerConfigurationProposal(prior, proposal, prior.slug);
    expect(merged).toMatchObject({ location: prior.location, socialLinks: prior.socialLinks, resources: prior.resources, weeklySchedule: prior.weeklySchedule,
      services: [{ id: 'servicio', price: 25000, description: 'Detalle', category: 'Categoría', resourceIds: ['principal'] }] });
    proposal.location = null; proposal.socialLinks = []; proposal.services[0].description = ''; proposal.services[0].category = '';
    expect(mergeOwnerConfigurationProposal(prior, proposal, prior.slug)).toMatchObject({ location: null, socialLinks: [], services: [{ description: '', category: '' }] });
    expect(prior.services[0].price).toBe(20000);
  });

  it('configuredSlugCannotChange and matches metadata by service ID after reorder', () => {
    const prior = config(); prior.services.push({ ...prior.services[0], id: 'segundo', description: 'Segundo detalle' });
    const proposal = config(); proposal.slug = 'otro-enlace'; proposal.services = [...prior.services].reverse().map(({ description: _description, category: _category, ...service }) => service);
    const merged = mergeOwnerConfigurationProposal(prior, proposal, prior.slug);
    expect(merged.slug).toBe('negocio-demo');
    expect(merged.services.map(service => service.description)).toEqual(['Segundo detalle', 'Detalle']);
    expect(mergeOwnerConfigurationProposal(prior, proposal, null).slug).toBe('otro-enlace');
  });

  it('fingerprintIgnoresLogoAndSubscription and object key order while preserving array order', () => {
    const c = config();
    const extras = { ...c, logo: { sha256: 'secret' }, subscription: { status: 'suspended' }, ownerEmail: 'private@example.test' };
    expect(configurationFingerprint(extras)).toBe(configurationFingerprint(c));
    const reversedKeys = Object.fromEntries(Object.entries(c).reverse()) as BusinessConfig;
    expect(configurationFingerprint(reversedKeys)).toBe(configurationFingerprint(c));
    c.resources.push({ id: 'second', name: 'Otra persona', active: true });
    expect(configurationFingerprint({ ...c, resources: [...c.resources].reverse() })).not.toBe(configurationFingerprint(c));
    const before = config(); const after = { ...before, services: [{ ...before.services[0], price: 25000 }] };
    expect(configurationDifferences(before, after)).toEqual([{ section: 'services', path: 'services.0.price', before: 20000, after: 25000 }]);
    expect(configurationDifferences(before, { ...before, logo: 'ignored' } as BusinessConfig)).toEqual([]);
  });

  it('questionIdsSurviveReviewAndRetry', () => {
    const draft = config();
    validateOwnerConfiguration(draft, general, 'review'); validateOwnerConfiguration(draft, general, 'review');
    expect(effectiveOwnerConfiguration(draft, general).intakeFields).toEqual([{ key: 'pregunta_estable', label: 'Preferencia general', required: false }]);
    expect(mergeOwnerConfigurationProposal(draft, draft, draft.slug).intakeFields[0].key).toBe('pregunta_estable');
  });

  it.each([{ ...general, dataMode: 'health' as const }, { ...general, representedMinorsEnabled: true }])('healthOrMinorsExcludesRestrictedIntake without erasing historical tone/rules', capability => {
    const draft = config(); draft.intakeFields = [{ key: 'historical', label: '', required: true }];
    const effective = effectiveOwnerConfiguration(draft, capability);
    expect(effective.intakeFields).toEqual([]);
    expect(effective).toMatchObject({ tone: 'Claro', customRules: 'Solo información' });
    expect(validateOwnerConfiguration(draft, capability)).toEqual([]);
    expect(draft.intakeFields).toHaveLength(1);
    expect(validateOwnerConfiguration(draft, general).some(issue => issue.section === 'assistant')).toBe(true);
  });
});
