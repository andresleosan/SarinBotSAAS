import { z } from 'zod';

export const BUSINESS_LOCATION_ADDRESS_MAX_LENGTH = 200;
export const BUSINESS_LOCATION_INSTRUCTIONS_MAX_LENGTH = 500;

export type BusinessLocation =
  | { mode: 'at_business'; address?: string; instructions?: string }
  | { mode: 'at_client' | 'online'; instructions?: string };

// Validate controls before trimming so a forbidden character cannot disappear
// at the boundary. Instructions support ordinary plain-text tabs and newlines.
const addressSchema = z.string().regex(/^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]*$/, 'Escribe la dirección en una sola línea.').trim().max(BUSINESS_LOCATION_ADDRESS_MAX_LENGTH);
const instructionsSchema = z.string().regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]*$/, 'Las indicaciones contienen caracteres no permitidos.').trim().max(BUSINESS_LOCATION_INSTRUCTIONS_MAX_LENGTH);

export const businessLocationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('at_business'), address: addressSchema.optional(), instructions: instructionsSchema.optional() }).strict(),
  z.object({ mode: z.literal('at_client'), instructions: instructionsSchema.optional() }).strict(),
  z.object({ mode: z.literal('online'), instructions: instructionsSchema.optional() }).strict(),
]).overwrite(location => ({
  mode: location.mode,
  ...(location.mode === 'at_business' && location.address ? { address: location.address } : {}),
  ...(location.instructions ? { instructions: location.instructions } : {}),
}));

/** Historic malformed values never become part of a public projection. */
export function normalizeBusinessLocation(input: unknown): BusinessLocation | undefined {
  const parsed = businessLocationSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

/** A navigation link only: no lookup, browser location, API key, or request. */
export function googleMapsLocationUrl(location: BusinessLocation): string | undefined {
  const normalized = normalizeBusinessLocation(location);
  if (normalized?.mode !== 'at_business' || !normalized.address) return undefined;
  try {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalized.address)}`;
  } catch {
    // A malformed historic Unicode string cannot become a navigation link.
    return undefined;
  }
}
