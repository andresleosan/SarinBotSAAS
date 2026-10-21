import { describe, expect, it } from 'vitest';
import { validatePlatformAudioDescriptor as validate } from '../shared/platform-whatsapp-audio';

const audio = () => ({ id: '123456789', link: 'https://api.ycloud.com/v2/whatsapp/media/download/123456789', sha256: Buffer.alloc(32, 7).toString('base64'), mimeType: 'audio/ogg' });
describe('closed local audio descriptor policy', () => {
  it.each(['', '?sig=opaque%2Bbytes', '?payload=opaque', '?payload=one&sig=two'])('preserves opaque allowed URL %s and normalizes Ogg MIME', query => {
    const input = { ...audio(), link: audio().link + query };
    const result = validate(input);
    expect(result).toEqual({ ...input, mimeType: 'audio/ogg; codecs=opus' }); expect(result).not.toBe(input);
  });
  it.each(['audio/ogg', 'AUDIO/OGG', 'audio/ogg; codecs=opus', 'audio/ogg;codecs="opus"', 'audio/ogg ; codecs=Opus'])('accepts Ogg/Opus spelling %s', mimeType => {
    expect(validate({ ...audio(), mimeType })?.mimeType).toBe('audio/ogg; codecs=opus');
  });
  it.each([
    { id: '0' }, { id: '01' }, { id: '1'.repeat(33) }, { id: '123456789\n' }, { id: 123456789 },
    { sha256: 'A'.repeat(42) + 'B=' }, { sha256: Buffer.alloc(31).toString('base64') }, { sha256: audio().sha256 + '\n' },
    { mimeType: 'audio/mp4' }, { mimeType: 'audio/ogg; codecs=vorbis' }, { mimeType: 'audio/mpeg' }, { mimeType: 'audio/ogg\n' }, { mimeType: 'audio/ogg; codecs=opus; x=1' },
    { extra: true }, { mimeType: undefined },
  ])('rejects invalid closed fields %j', patch => { expect(validate({ ...audio(), ...patch })).toBeNull(); });
  it.each([
    'http://api.ycloud.com/v2/whatsapp/media/download/123456789',
    'https://api.ycloud.com:443/v2/whatsapp/media/download/123456789',
    'https://user@api.ycloud.com/v2/whatsapp/media/download/123456789',
    'https://api.ycloud.com.evil.invalid/v2/whatsapp/media/download/123456789',
    'https://api.ycloud.com/v2/whatsapp/media/download/123456788',
    'https://api.ycloud.com/v2/whatsapp/media/download/123456789#fragment',
    'https://api.ycloud.com/v2/whatsapp/media/../media/download/123456789',
    audio().link + '?sig=a#', audio().link + '?redirect=https://evil.invalid', audio().link + '?sig=', audio().link + '?sig=a&sig=b',
    audio().link + '?payload=a&payload=b', audio().link + '?sig=' + 'a'.repeat(2049), audio().link + '\n',
  ])('rejects unsupported URL %s', link => { expect(validate({ ...audio(), link })).toBeNull(); });
  it('enforces canonical hash pad bits and descriptor serialization bounds', () => {
    const hash = audio().sha256;
    expect(validate({ ...audio(), sha256: hash.slice(0, -2) + 'd=' })).toBeNull();
    expect(validate({ ...audio(), link: audio().link + '?sig=' + 'a'.repeat(2000) + '&payload=' + 'b'.repeat(2000) })).toBeNull();
    for (const value of [null, [], 7, 'audio']) expect(validate(value)).toBeNull();
  });
});
