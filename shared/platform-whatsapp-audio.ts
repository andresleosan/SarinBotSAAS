export interface AudioDescriptor { id: string; link: string; sha256: string; mimeType: string }

/** Sarin acceptance policy over optional provider strings. No fetch or byte validation. */
export function validatePlatformAudioDescriptor(input: unknown): AudioDescriptor | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>, keys = ['id', 'link', 'sha256', 'mimeType'];
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) return null;
  const { id, link, sha256, mimeType } = value;
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,31}(?![\s\S])/.test(id)
    || typeof link !== 'string' || link.length > 4096 || link.includes('#') || /[^\x21-\x7e]/.test(link)
    || typeof sha256 !== 'string' || !/^[A-Za-z0-9+/]{43}=(?![\s\S])/.test(sha256)
    || typeof mimeType !== 'string' || !/^audio\/ogg(?: *; *codecs=(?:opus|"opus"))?(?![\s\S])/i.test(mimeType)) return null;
  // A 32-byte standard-base64 digest has exactly two unused zero pad bits.
  if ('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(sha256[42]) % 4 !== 0) return null;
  const expected = 'https://api.ycloud.com/v2/whatsapp/media/download/' + id;
  if (link !== expected && !link.startsWith(expected + '?')) return null;
  try {
    const url = new URL(link);
    if (url.origin !== 'https://api.ycloud.com' || url.username || url.password || url.port || url.hash || url.pathname !== '/v2/whatsapp/media/download/' + id) return null;
    const seen = new Set<string>();
    for (const [key, value] of url.searchParams) {
      if (!['sig', 'payload'].includes(key) || seen.has(key) || !value || value.length > 2048) return null;
      seen.add(key);
    }
    // Empty query delimiters or segments are not signed parameter values.
    if (link.includes('?') && (link.endsWith('?') || link.slice(link.indexOf('?') + 1).split('&').some(part => !/^(sig|payload)=.+$/.test(part)))) return null;
  } catch { return null; }
  const descriptor = { id, link, sha256, mimeType: 'audio/ogg; codecs=opus' };
  return JSON.stringify(descriptor).length <= 4096 ? descriptor : null;
}
