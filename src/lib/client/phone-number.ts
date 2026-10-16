import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

export interface PhoneCountry {
  country: CountryCode;
  name: string;
  callingCode: string;
}

export interface SplitWhatsAppNumber {
  country: CountryCode | '';
  nationalNumber: string;
  callingCode: string;
}

const countryNames = new Intl.DisplayNames(['es'], { type: 'region' });
export const PHONE_COUNTRIES: readonly PhoneCountry[] = getCountries()
  .map(country => ({ country, name: countryNames.of(country) ?? country, callingCode: getCountryCallingCode(country) }))
  .sort((left, right) => left.name.localeCompare(right.name, 'es'));

// Formatting only: retain letters, extensions and leading zeroes so invalid
// input remains visible and cannot silently become a different phone number.
export function normalizeNationalNumber(value: string): string {
  return value.replace(/[\s().-]/g, '');
}

export function isInternationalPhoneInput(value: string): boolean {
  return /^(?:\+|00)/.test(normalizeNationalNumber(value));
}

function internationalNumber(value: string): string {
  const clean = normalizeNationalNumber(value);
  if (!clean) return '';
  if (clean.startsWith('00')) return '+' + clean.slice(2);
  return clean.startsWith('+') ? clean : '+' + clean;
}

// Use for stored international values (legacy values can omit '+') or an
// explicit +/00 paste. Plain national typing must not go through this parser.
export function splitWhatsAppNumber(value: string, preferredCountry: CountryCode = 'CO'): SplitWhatsAppNumber {
  const number = internationalNumber(value);
  if (!number) return { country: preferredCountry, nationalNumber: '', callingCode: getCountryCallingCode(preferredCountry) };
  const fallback: SplitWhatsAppNumber = { country: '', nationalNumber: number, callingCode: '' };
  if (!/^\+[1-9]\d*$/.test(number)) return fallback;

  const parsed = parsePhoneNumberFromString(number, { extract: false });
  if (parsed?.isNonGeographic()) return fallback;
  const digits = number.slice(1);
  const callingCode = parsed?.countryCallingCode
    ?? PHONE_COUNTRIES.find(item => digits.startsWith(item.callingCode))?.callingCode;
  if (!callingCode) return fallback;
  const candidates = PHONE_COUNTRIES.filter(item => item.callingCode === callingCode);
  const country = parsed?.country
    ?? candidates.find(item => item.country === preferredCountry)?.country
    ?? (candidates.length === 1 ? candidates[0].country : undefined);
  if (!country) return fallback;

  // The parser may normalize national trunk prefixes. Only use its country
  // identification; slice the original digits to preserve every stored digit.
  return { country, nationalNumber: digits.slice(callingCode.length), callingCode };
}

// The country and national field are already split. In particular, never
// interpret leading national digits as a second international calling code.
export function composeWhatsAppNumber(country: CountryCode | '', nationalNumber: string): string {
  const national = normalizeNationalNumber(nationalNumber);
  if (!national) return '';
  return country ? '+' + getCountryCallingCode(country) + national : internationalNumber(national);
}
