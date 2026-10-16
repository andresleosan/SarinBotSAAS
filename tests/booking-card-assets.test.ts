import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { buildBookingCardAssets } from '@/lib/client/booking-card-assets';
import type { BookingCardDetails } from '@/lib/booking-card';
const details: BookingCardDetails = { businessId: 'business', slug: 'barberia-norte', businessName: 'Barbería Norte', phoneWhatsApp: '573001234567', socialLinks: [{ platform: 'website', url: 'https://do-not-fetch.example' }], bookingUrl: 'https://sarinbotsaas.pages.dev/b/barberia-norte', logoSha256: null };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwL8AAAAASUVORK5CYII=', 'base64');
const qrSvg = `<svg xmlns="http://www.w3.org/2000/svg" data-booking-url="${details.bookingUrl}" viewBox="0 0 37 37"><path fill="#fff" d="M0 0h37v37H0z"/><path fill="#000" d="M4 4h29v29H4z"/></svg>`;
const state = { font: vi.fn(), fetch: vi.fn(), revoked: vi.fn(), toBlob: vi.fn() };
beforeEach(() => {
  state.font.mockReset().mockResolvedValue({}); state.fetch.mockReset(); state.revoked.mockReset();
  state.toBlob.mockReset().mockImplementation((callback: (blob: Blob) => void) => callback(new Blob([png], { type: 'image/png' })));
  vi.stubGlobal('FontFace', class { load = state.font; });
  const context = { fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), measureText: (text: string) => ({ width: text.length * 25 }) };
  vi.stubGlobal('document', { fonts: { add: vi.fn() }, createElement: () => ({ width: 0, height: 0, getContext: () => context, toBlob: state.toBlob }) });
  vi.stubGlobal('DOMParser', class { parseFromString() { return { documentElement: { localName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg', getAttribute: () => details.bookingUrl }, querySelector: () => null, querySelectorAll: () => [] }; } });
  vi.stubGlobal('Image', class { width = 512; height = 512; set src(_value: string) {} decode() { return Promise.resolve(); } });
  vi.stubGlobal('fetch', state.fetch);
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:synthetic'; } static revokeObjectURL = state.revoked; });
});
afterEach(() => vi.unstubAllGlobals());
describe('printable booking assets', () => {
  it('pdf_contains_same_png_at_a6_size and never fetches social URLs', async () => {
    const assets = await buildBookingCardAssets({ details, qrSvg, signal: new AbortController().signal });
    expect(Buffer.from(await assets.png.arrayBuffer())).toEqual(png);
    expect(await assets.qrSvg.text()).toBe(qrSvg);
    const pdf = await PDFDocument.load(await assets.pdf.arrayBuffer());
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(105 * 72 / 25.4, 5);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(148 * 72 / 25.4, 5);
    const images = pdf.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(state.fetch).not.toHaveBeenCalled(); expect(state.revoked).toHaveBeenCalled();
  });
  it('aborts_on_font_logo_or_signal_failure and does not export a partial card', async () => {
    state.font.mockRejectedValueOnce(new Error('Fuente no disponible'));
    await expect(buildBookingCardAssets({ details, qrSvg, signal: new AbortController().signal })).rejects.toThrow(/fuente/i);
    expect(state.toBlob).not.toHaveBeenCalled();
    state.fetch.mockResolvedValue(new Response('<html>redirected</html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(buildBookingCardAssets({ details: { ...details, logoSha256: 'a'.repeat(64) }, qrSvg, signal: new AbortController().signal })).rejects.toThrow(/logo/i);
    expect(state.fetch).toHaveBeenCalledWith(`/api/public/businesses/${details.slug}/logo/${'a'.repeat(64)}`, expect.objectContaining({ redirect: 'error', credentials: 'omit' }));
    expect(state.toBlob).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(buildBookingCardAssets({ details, qrSvg, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('discards work aborted while the font is loading', async () => {
    let resolve!: (value: unknown) => void;
    state.font.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const building = buildBookingCardAssets({ details, qrSvg, signal: controller.signal });
    controller.abort(); resolve({});
    await expect(building).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.toBlob).not.toHaveBeenCalled();
  });
});
