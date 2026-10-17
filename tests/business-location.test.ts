import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { businessConfigSchema } from '@/lib/server/schemas';
import { googleMapsLocationUrl } from '@/lib/business-location';
import type { BusinessLocation } from '@/lib/business-location';

const config = {
  name: 'Negocio de prueba', slug: 'negocio-prueba', category: 'Servicios', phoneWhatsApp: '573001234567',
  resources: [{ id: 'one', name: 'Uno', active: true }],
  services: [{ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 0, price: 20000, resourceIds: ['one'] }],
  intakeFields: [],
  weeklySchedule: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isOpen: true, intervals: [{ start: '09:00', end: '17:00' }] }])),
};

describe('business location configuration', () => {
  it.each([
    [{ mode: 'at_business', address: '  Calle 10 # 5-20  ', instructions: '  Segundo piso.\nToca el timbre.  ' }, { mode: 'at_business', address: 'Calle 10 # 5-20', instructions: 'Segundo piso.\nToca el timbre.' }],
    [{ mode: 'at_business', address: '   ', instructions: '\n  ' }, { mode: 'at_business' }],
    [{ mode: 'at_client', instructions: '  Confirma tu dirección al reservar.  ' }, { mode: 'at_client', instructions: 'Confirma tu dirección al reservar.' }],
    [{ mode: 'online', instructions: '' }, { mode: 'online' }],
  ])('normalizes a selected service mode and omits empty optional text', (location, expected) => {
    expect(businessConfigSchema.parse({ ...config, location }).location).toEqual(expected);
  });

  it('accepts absent location and an explicit removal without manufacturing a location', () => {
    expect(businessConfigSchema.parse(config)).not.toHaveProperty('location');
    expect(businessConfigSchema.parse({ ...config, location: null }).location).toBeNull();
  });

  it('allows trimmed text at its address and instructions limits', () => {
    expect(businessConfigSchema.parse({ ...config, location: { mode: 'at_business', address: ` ${'a'.repeat(200)} `, instructions: ` ${'i'.repeat(500)} ` } }).location)
      .toEqual({ mode: 'at_business', address: 'a'.repeat(200), instructions: 'i'.repeat(500) });
  });

  it.each([
    { mode: 'other' }, {}, 'Calle 10', [],
    { mode: 'at_business', address: 'a'.repeat(201) },
    { mode: 'online', instructions: 'i'.repeat(501) },
    { mode: 'at_client', address: 'Calle 10' },
    { mode: 'online', url: 'https://meeting.example.test/private' },
    { mode: 'at_business', instructions: 'ok', internalNote: 'private' },
    { mode: 'at_business', address: 12 },
    { mode: 'online', instructions: null },
  ])('rejects malformed location requests and unknown fields: %j', (location) => {
    expect(businessConfigSchema.safeParse({ ...config, location }).success).toBe(false);
  });

  it.each(['\n', '\r', '\t', '\u0085', '\u2028', '\u2029', '\u0000', '\u001b', '\u007f'])('rejects non-single-line addresses containing %j', (character) => {
    expect(businessConfigSchema.safeParse({ ...config, location: { mode: 'at_business', address: `Calle${character}10` } }).success).toBe(false);
  });

  it.each(['\n', '\r', '\u2028', '\u2029'])('rejects a line break at the end of an address before trimming it: %j', (character) => {
    expect(businessConfigSchema.safeParse({ ...config, location: { mode: 'at_business', address: `Calle 10${character}` } }).success).toBe(false);
  });

  it.each(['\u0000', '\u0008', '\u000b', '\u000c', '\u001b', '\u007f', '\u0085', '\u009f'])('rejects forbidden controls in instructions containing %j', (character) => {
    expect(businessConfigSchema.safeParse({ ...config, location: { mode: 'online', instructions: `${character}texto${character}` } }).success).toBe(false);
  });

  it('keeps plain text instructions and supports multiline text without introducing an external URL field', () => {
    expect(businessConfigSchema.parse({ ...config, location: { mode: 'online', instructions: 'Primera línea.\r\n\t<script>texto literal</script>' } }).location)
      .toEqual({ mode: 'online', instructions: 'Primera línea.\r\n\t<script>texto literal</script>' });
    expect(() => z.toJSONSchema(businessConfigSchema)).not.toThrow();
  });
});

describe('business location maps link', () => {
  it('encodes the complete address as a query on the fixed Google Maps search URL', () => {
    expect(googleMapsLocationUrl({ mode: 'at_business', address: '  Calle 10 # 5-20, Bogotá & sede?x=1  ' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Calle%2010%20%23%205-20%2C%20Bogot%C3%A1%20%26%20sede%3Fx%3D1');
  });

  it('keeps URL-looking address text inside the Google query instead of accepting a custom destination', () => {
    expect(googleMapsLocationUrl({ mode: 'at_business', address: 'https://untrusted.example.test/?q=a&x=b' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=https%3A%2F%2Funtrusted.example.test%2F%3Fq%3Da%26x%3Db');
  });

  it.each([
    { mode: 'at_business' }, { mode: 'at_business', address: '  ' },
    { mode: 'at_client', instructions: 'Calle 10' }, { mode: 'online', instructions: 'https://meeting.example.test' },
    { mode: 'at_business', address: 'Calle\n10' }, { mode: 'at_business', address: 'a'.repeat(201) },
    { mode: 'at_business', address: '\ud800' },
  ])('does not generate links for absent, inapplicable, or malformed addresses: %j', (location) => {
    expect(() => googleMapsLocationUrl(location as BusinessLocation)).not.toThrow();
    expect(googleMapsLocationUrl(location as BusinessLocation)).toBeUndefined();
  });
});
