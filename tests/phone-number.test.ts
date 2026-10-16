import { describe, expect, it } from 'vitest';
import { getCountries } from 'libphonenumber-js/min';
import {
  PHONE_COUNTRIES,
  composeWhatsAppNumber,
  isInternationalPhoneInput,
  normalizeNationalNumber,
  splitWhatsAppNumber,
} from '@/lib/client/phone-number';

describe('WhatsApp country and national number fields', () => {
  it('offers every supported country with a Spanish label and calling code', () => {
    expect(new Set(PHONE_COUNTRIES.map(item => item.country))).toEqual(new Set(getCountries()));
    expect(PHONE_COUNTRIES).toContainEqual({ country: 'ES', name: 'España', callingCode: '34' });
    expect(PHONE_COUNTRIES).toContainEqual({ country: 'CO', name: 'Colombia', callingCode: '57' });
  });

  it('defaults only an empty field to the preferred country', () => {
    expect(splitWhatsAppNumber('')).toEqual({ country: 'CO', nationalNumber: '', callingCode: '57' });
    expect(splitWhatsAppNumber('', 'ES')).toEqual({ country: 'ES', nationalNumber: '', callingCode: '34' });
  });

  it.each([
    ['+573001234567', 'CO', '3001234567', '57'],
    ['573001234567', 'CO', '3001234567', '57'],
    ['+34 612 34 56 78', 'ES', '612345678', '34'],
    ['00 34 612-345-678', 'ES', '612345678', '34'],
    ['+1 (416) 555-0123', 'CA', '4165550123', '1'],
    ['+1 (202) 555-0123', 'US', '2025550123', '1'],
    ['+39 02 1234 5678', 'IT', '0212345678', '39'],
  ] as const)('splits stored or pasted %s without changing its digits', (value, country, nationalNumber, callingCode) => {
    expect(splitWhatsAppNumber(value)).toEqual({ country, nationalNumber, callingCode });
    expect(composeWhatsAppNumber(country, nationalNumber)).toBe(`+${callingCode}${nationalNumber}`);
  });

  it('uses the preferred country for an ambiguous shared calling code without changing the number', () => {
    expect(splitWhatsAppNumber('+19999999999', 'CA')).toEqual({ country: 'CA', nationalNumber: '9999999999', callingCode: '1' });
  });

  it.each(['+999123456789', '999123456789', '+80012345678', '0080012345678'])('keeps %s whole in international fallback mode', (value) => {
    const expected = value.includes('800') ? '+80012345678' : '+999123456789';
    const split = splitWhatsAppNumber(value);
    expect(split).toEqual({ country: '', nationalNumber: expected, callingCode: '' });
    expect(composeWhatsAppNumber(split.country, split.nationalNumber)).toBe(expected);
  });

  it('preserves unusual legacy digits instead of enforcing strict country validity', () => {
    const split = splitWhatsAppNumber('+57001234567');
    expect(split).toEqual({ country: 'CO', nationalNumber: '001234567', callingCode: '57' });
    expect(composeWhatsAppNumber(split.country, split.nationalNumber)).toBe('+57001234567');
  });

  it('treats plain digits as national while editing, even when they resemble a foreign prefix', () => {
    expect(isInternationalPhoneInput('314 123 4567')).toBe(false);
    expect(normalizeNationalNumber('314 123-4567')).toBe('3141234567');
    expect(composeWhatsAppNumber('CO', '314 123-4567')).toBe('+573141234567');
  });

  it.each(['+57 (300) 123-4567', '00 57 (300) 123-4567'])('accepts an explicit international paste without duplicating the selected code: %s', (value) => {
    expect(isInternationalPhoneInput(value)).toBe(true);
    const pasted = splitWhatsAppNumber(value, 'ES');
    expect(composeWhatsAppNumber(pasted.country, pasted.nationalNumber)).toBe('+573001234567');
  });

  it('does not remove an Italian leading zero during national editing', () => {
    expect(normalizeNationalNumber('02 1234 5678')).toBe('0212345678');
    expect(composeWhatsAppNumber('IT', '02 1234 5678')).toBe('+390212345678');
  });

  it('keeps extensions and invalid characters visible instead of silently concatenating digits', () => {
    expect(normalizeNationalNumber('300 123 4567 ext. 9')).toBe('3001234567ext9');
    expect(composeWhatsAppNumber('CO', '300 123 4567 ext. 9')).toBe('+573001234567ext9');
    expect(splitWhatsAppNumber('+573001234567 ext. 9')).toEqual({ country: '', nationalNumber: '+573001234567ext9', callingCode: '' });
  });

  it('does not turn an empty national field into a saved calling code or truncate a long value', () => {
    expect(composeWhatsAppNumber('CO', '')).toBe('');
    expect(composeWhatsAppNumber('', '')).toBe('');
    expect(composeWhatsAppNumber('CO', '3001234567890123456')).toBe('+573001234567890123456');
  });
});
