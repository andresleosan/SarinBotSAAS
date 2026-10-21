import { AudioError } from '../../shared/platform-whatsapp-audio-protocol.ts';

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const invalid = (): never => { throw new AudioError('invalid_audio'); };
const limit = (): never => { throw new AudioError('limit'); };
const begins = (bytes: Uint8Array, text: string) => bytes.length >= text.length && [...text].every((c, i) => bytes[i] === c.charCodeAt(0));
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index << 24; for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ ((crc & 0x80000000) ? 0x04c11db7 : 0); return crc >>> 0;
});
function checksum(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0; for (let i = start; i < end; i++) crc = (crc << 8) ^ table[((crc >>> 24) ^ (i >= start + 22 && i < start + 26 ? 0 : bytes[i])) & 255]; return crc >>> 0;
}

/** RFC6716 section 3 framing, including zero-byte frames; no codec decoding. */
export function opusPacketSamples(packet: Uint8Array): number {
  if (!packet.length || packet.length > 65536) invalid();
  const config = packet[0] >>> 3, code = packet[0] & 3;
  const frameSamples = config >= 16 ? 120 << (config & 3) : config >= 12 ? 480 << (config & 1) : (config & 3) === 3 ? 2880 : 480 << (config & 3);
  let cursor = 1, end = packet.length, count = code === 0 ? 1 : 2;
  const size = () => { if (cursor >= end) return invalid(); const first = packet[cursor++]; if (first < 252) return first; if (cursor >= end) return invalid(); return first + 4 * packet[cursor++]; };
  const frame = (length: number) => { if (length < 0 || length > 1275) invalid(); };
  if (code === 0) frame(end - cursor);
  else if (code === 1) { if ((end - cursor) % 2) invalid(); frame((end - cursor) / 2); }
  else if (code === 2) { const first = size(); frame(first); frame(end - cursor - first); }
  else {
    if (cursor >= end) invalid(); const control = packet[cursor++]; count = control & 63;
    if (!count || count * frameSamples > 5760) invalid();
    if (control & 64) {
      let padding = 0, octet: number;
      do { if (cursor >= end) invalid(); octet = packet[cursor++]; padding += octet === 255 ? 254 : octet; } while (octet === 255);
      end -= padding; if (end < cursor) invalid();
    }
    if (control & 128) {
      let used = 0; for (let i = 0; i < count - 1; i++) { const length = size(); frame(length); used += length; }
      frame(end - cursor - used);
    } else { if ((end - cursor) % count) invalid(); frame((end - cursor) / count); }
  }
  if (count * frameSamples > 5760) invalid(); return count * frameSamples;
}

/** Single complete mono/stereo stream. Granules use the Opus 48kHz clock. */
export function verifiedOpusSamples(bytes: Uint8Array, check: () => void = () => {}): number {
  if (bytes.length > MAX_AUDIO_BYTES) limit();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0, sequence = 0, serial = -1, packets = 0, pending = 0, preSkip = 0;
  let decoded = 0, lastSamples = 0, previousGranule = 0, granuleOffset = -1, ended = false, completeAudioPage = false;
  let parts: Uint8Array[] = [];
  while (offset < bytes.length) {
    check();
    if (ended || offset + 27 > bytes.length || !begins(bytes.subarray(offset), 'OggS') || bytes[offset + 4] !== 0) invalid();
    const flags = bytes[offset + 5], count = bytes[offset + 26], body = offset + 27 + count;
    if (flags > 7 || body > bytes.length || !!(flags & 1) !== (pending > 0) || (sequence === 0 ? flags !== 2 : !!(flags & 2)) || view.getUint32(offset + 18, true) !== sequence) invalid();
    const pageSerial = view.getUint32(offset + 14, true); if (sequence === 0) serial = pageSerial; if (pageSerial !== serial) invalid();
    let end = body; for (let i = 0; i < count; i++) end += bytes[offset + 27 + i];
    if (end > bytes.length || checksum(bytes, offset, end) !== view.getUint32(offset + 22, true)) invalid();
    const raw = view.getBigUint64(offset + 6, true), unset = raw === 0xffffffffffffffffn;
    if (!unset && raw > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
    const granule = unset ? -1 : Number(raw), before = packets;
    if (count === 0) {
      if (flags !== 4 || !unset || pending || packets < 3 || granuleOffset < 0 || previousGranule - granuleOffset <= preSkip || end !== bytes.length) invalid();
      ended = true; offset = end; sequence++; continue;
    }
    let at = body;
    for (let i = 0; i < count; i++) {
      const size = bytes[offset + 27 + i]; parts.push(bytes.subarray(at, at + size)); pending += size; at += size;
      if (pending > 65536) invalid(); if (size === 255) continue;
      const packet = new Uint8Array(pending); let cursor = 0; for (const part of parts) { packet.set(part, cursor); cursor += part.length; }
      const data = new DataView(packet.buffer);
      if (packets === 0) {
        if (sequence !== 0 || count !== 1 || packet.length !== 19 || !begins(packet, 'OpusHead') || packet[8] !== 1 || ![1, 2].includes(packet[9]) || packet[18] !== 0) invalid(); preSkip = data.getUint16(10, true);
      } else if (packets === 1) {
        if (!begins(packet, 'OpusTags') || packet.length < 16 || i !== count - 1) invalid();
        let tag = 12 + data.getUint32(8, true); if (tag + 4 > packet.length) invalid();
        const comments = data.getUint32(tag, true); tag += 4; if (comments > 16384) invalid();
        for (let n = 0; n < comments; n++) { if (tag + 4 > packet.length) invalid(); tag += 4 + data.getUint32(tag, true); if (tag > packet.length) invalid(); }
      } else {
        lastSamples = opusPacketSamples(packet); decoded += lastSamples; if (decoded - preSkip > 120 * 48000 + 5760) limit();
      }
      packets++; pending = 0; parts = [];
    }
    const completed = packets > before;
    if (packets <= 2) { if (granule !== (completed ? 0 : -1)) invalid(); }
    else if (!completed) { if (granule !== -1) invalid(); }
    else {
      if (granuleOffset < 0) {
        const initial = granule - decoded;
        if (initial === 0 || initial === preSkip) granuleOffset = initial;
        else if ((flags & 4) && initial < 0) granuleOffset = 0;
        else invalid();
      }
      const position = granule - granuleOffset;
      if (granule < previousGranule || position > decoded || (!(flags & 4) && position !== decoded) || ((flags & 4) && position <= decoded - lastSamples)) invalid();
      previousGranule = granule;
    }
    completeAudioPage = completed && packets >= 3 && pending === 0 && flags === 0;
    if (flags & 4) { if (packets < 3 || pending || granule - granuleOffset <= preSkip || end !== bytes.length) invalid(); ended = true; }
    offset = end; sequence++;
  }
  const completeOffsetEof = preSkip > 0 && granuleOffset === preSkip && completeAudioPage && previousGranule - granuleOffset === decoded;
  if ((!ended && !completeOffsetEof) || pending) invalid();
  const samples = previousGranule - granuleOffset - preSkip; if (samples <= 0) invalid(); if (samples > 120 * 48000) limit(); return samples;
}
