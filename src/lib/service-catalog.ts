import type { TenantService } from '@/types/firestore';

export const SERVICE_DESCRIPTION_MAX_LENGTH = 300;
export const SERVICE_CATEGORY_MAX_LENGTH = 60;

function catalogText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length <= maxLength ? text : undefined;
}

/** Explicit field list also protects anonymous profiles from malformed historic data. */
export function serviceCatalogMetadata(service: Pick<TenantService, 'description' | 'category'>): Pick<TenantService, 'description' | 'category'> {
  const description = catalogText(service.description, SERVICE_DESCRIPTION_MAX_LENGTH);
  const category = catalogText(service.category, SERVICE_CATEGORY_MAX_LENGTH);
  return { ...(description ? { description } : {}), ...(category ? { category } : {}) };
}

/** Omission by older clients or AI drafts preserves text; an explicit empty string clears it. */
export function preserveServiceCatalogMetadata(next: readonly TenantService[], previous: readonly TenantService[]): TenantService[] {
  const byId = new Map(previous.map(service => [service.id, service]));
  return next.map(service => {
    const prior = byId.get(service.id);
    // Keep explicit clears during draft merging; only the public projection omits empty text.
    const description = catalogText(prior?.description, SERVICE_DESCRIPTION_MAX_LENGTH);
    const category = catalogText(prior?.category, SERVICE_CATEGORY_MAX_LENGTH);
    return {
      ...service,
      ...(service.description === undefined && description !== undefined ? { description } : {}),
      ...(service.category === undefined && category !== undefined ? { category } : {}),
    };
  });
}
