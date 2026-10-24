import type { BookingCapability } from '@/lib/booking-subject';
import { normalizeBusinessLocation } from '@/lib/business-location';
import { businessConfigSchema, type BusinessConfig } from '@/lib/server/schemas';
import type { Business } from '@/types/firestore';

export type OwnerConfigurationSection = 'summary' | 'identity' | 'resources' | 'services' | 'schedule' | 'assistant' | 'review' | 'logo';
export type OwnerConfigurationPhase = 'idle' | 'checking' | 'saving' | 'uncertain' | 'external-change' | 'saved' | 'error';
export type ConfigurationIssue = { path: string; section: OwnerConfigurationSection; message: string };
export type ConfigurationDifference = { section: OwnerConfigurationSection; path: string; before: unknown; after: unknown };

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) as Pick<T, K>;
}

/** Project an editable value without parsing: incomplete manual drafts must survive. */
function project(config: BusinessConfig): BusinessConfig {
  return {
    ...pick(config, ['name', 'category', 'slug', 'phoneWhatsApp', 'tone', 'customRules']),
    ...(config.socialLinks !== undefined ? { socialLinks: config.socialLinks.map(link => pick(link, ['platform', 'url'])) } : {}),
    ...(config.location !== undefined ? { location: config.location === null ? null : {
      ...pick(config.location, ['mode', 'instructions']),
      ...(config.location.mode === 'at_business' ? pick(config.location, ['address']) : {}),
    } } : {}),
    intakeFields: config.intakeFields.map(field => pick(field, ['key', 'label', 'required'])),
    resources: config.resources.map(resource => pick(resource, ['id', 'name', 'active'])),
    services: config.services.map(service => ({ ...pick(service, ['id', 'name', 'description', 'category', 'durationMinutes', 'bufferMinutes', 'price']), resourceIds: [...service.resourceIds] })),
    weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, index) => {
      const day = config.weeklySchedule[String(index) as keyof BusinessConfig['weeklySchedule']];
      return [index, { isOpen: day.isOpen, intervals: day.intervals.map(interval => pick(interval, ['start', 'end'])) }];
    })) as BusinessConfig['weeklySchedule'],
  };
}

export function createOwnerConfigurationDraft(business: Business): BusinessConfig {
  if (!business.sarinConfig.onboardingCompleted) {
    return {
      name: '', category: '', slug: '', phoneWhatsApp: '', socialLinks: [], location: null,
      tone: 'Cercano y profesional', customRules: '', intakeFields: [],
      resources: [{ id: 'principal', name: '', active: true }],
      services: [{ id: 'principal', name: '', durationMinutes: 30, bufferMinutes: 0, price: 0, resourceIds: ['principal'] }],
      weeklySchedule: {
        '0': { isOpen: false, intervals: [] },
        '1': { isOpen: false, intervals: [] },
        '2': { isOpen: false, intervals: [] },
        '3': { isOpen: false, intervals: [] },
        '4': { isOpen: false, intervals: [] },
        '5': { isOpen: false, intervals: [] },
        '6': { isOpen: false, intervals: [] },
      },
    };
  }
  return project({
    name: business.name, category: business.category, slug: business.slug, phoneWhatsApp: business.phoneWhatsApp,
    socialLinks: business.socialLinks ?? [], location: normalizeBusinessLocation(business.location) ?? null,
    tone: business.sarinConfig.tone, customRules: business.sarinConfig.customRules, intakeFields: business.sarinConfig.intakeFields,
    resources: business.resources, services: business.services, weeklySchedule: business.weeklySchedule as BusinessConfig['weeklySchedule'],
  });
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
    }
    return item;
  });
}

/** This is local comparison data, never an authority token or a logged identifier. */
export function configurationFingerprint(config: BusinessConfig): string {
  return stable(project(config));
}

export function configurationSectionForPath(path: string): OwnerConfigurationSection {
  switch (path.split('.')[0]) {
    case 'name': case 'category': case 'slug': case 'phoneWhatsApp': case 'socialLinks': case 'location': return 'identity';
    case 'resources': return 'resources';
    case 'services': return 'services';
    case 'weeklySchedule': return 'schedule';
    case 'tone': case 'customRules': case 'intakeFields': return 'assistant';
    default: return 'review';
  }
}

export function effectiveOwnerConfiguration(config: BusinessConfig, capability: BookingCapability): BusinessConfig {
  const effective = project(config);
  if (capability.dataMode === 'health' || capability.representedMinorsEnabled) effective.intakeFields = [];
  return effective;
}

export function validateOwnerConfiguration(config: BusinessConfig, capability: BookingCapability, section?: OwnerConfigurationSection): ConfigurationIssue[] {
  const effective = effectiveOwnerConfiguration(config, capability);
  const parsed = businessConfigSchema.safeParse(effective);
  if (parsed.success) return [];
  const issues: ConfigurationIssue[] = [];
  const add = (path: string, message: string) => {
    if (!issues.some(issue => issue.path === path && issue.message === message)) issues.push({ path, section: configurationSectionForPath(path), message });
  };
  for (const issue of parsed.error.issues) {
    if (issue.path.length) { add(issue.path.join('.'), issue.message); continue; }
    // The existing schema reports these relations at the root. Locate the
    // affected controls only after that schema has rejected the relation.
    if (issue.message === 'Hay identificadores repetidos.') {
      for (const [path, ids] of [
        ['resources', effective.resources.map(resource => resource.id)],
        ['services', effective.services.map(service => service.id)],
        ['intakeFields', effective.intakeFields.map(field => field.key)],
      ] as const) {
        if (new Set(ids).size !== ids.length) add(path, issue.message);
      }
    } else if (issue.message === 'El servicio referencia un recurso desconocido.') {
      effective.services.forEach((service, index) => {
        if (service.resourceIds.some(id => !effective.resources.some(resource => resource.id === id))) add(`services.${index}.resourceIds`, issue.message);
      });
    } else add('', issue.message);
  }
  return section && section !== 'review' ? issues.filter(issue => issue.section === section) : issues;
}

export function configurationDifferences(before: BusinessConfig, after: BusinessConfig): ConfigurationDifference[] {
  const differences: ConfigurationDifference[] = [];
  const visit = (left: unknown, right: unknown, path: string) => {
    if (stable(left) === stable(right)) return;
    if (left && right && typeof left === 'object' && typeof right === 'object' && Array.isArray(left) === Array.isArray(right)) {
      const a = left as Record<string, unknown>; const b = right as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], path ? `${path}.${key}` : key);
    } else differences.push({ path, section: configurationSectionForPath(path), before: left, after: right });
  };
  visit(project(before), project(after), '');
  return differences;
}

export function mergeOwnerConfigurationProposal(current: BusinessConfig, proposal: BusinessConfig, permanentSlug: string | null): BusinessConfig {
  const previousServices = new Map(current.services.map(service => [service.id, service]));
  return project({
    ...proposal,
    slug: permanentSlug ?? proposal.slug,
    socialLinks: proposal.socialLinks === undefined ? current.socialLinks : proposal.socialLinks,
    location: proposal.location === undefined ? current.location : proposal.location,
    services: proposal.services.map(service => {
      const previous = previousServices.get(service.id);
      return {
        ...service,
        ...(service.description === undefined && previous?.description !== undefined ? { description: previous.description } : {}),
        ...(service.category === undefined && previous?.category !== undefined ? { category: previous.category } : {}),
      };
    }),
  });
}
