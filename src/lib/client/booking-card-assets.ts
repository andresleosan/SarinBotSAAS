"use client";

import { getBookingCardLayout, type BookingCardDetails } from '@/lib/booking-card';

const check = (signal: AbortSignal) => signal.throwIfAborted();
async function loadImage(blob: Blob, signal: AbortSignal): Promise<HTMLImageElement> {
  check(signal);
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const abort = () => { image.src = ''; };
  signal.addEventListener('abort', abort, { once: true });
  try {
    image.src = url;
    await image.decode(); check(signal);
    return image;
  } catch (error) { check(signal); throw new Error('No pudimos cargar una imagen de la tarjeta. Actualiza y reintenta.', { cause: error });
  } finally { signal.removeEventListener('abort', abort); URL.revokeObjectURL(url); }
}
async function logoBlob(details: BookingCardDetails, signal: AbortSignal): Promise<Blob | null> {
  if (!details.logoSha256) return null;
  if (!/^[a-f0-9]{64}$/.test(details.logoSha256) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(details.slug)) throw new Error('El logo guardado no es válido.');
  const response = await fetch(`/api/public/businesses/${details.slug}/logo/${details.logoSha256}`, { signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
  check(signal);
  if (!response.ok || response.redirected || response.headers.get('Content-Type')?.split(';')[0].trim() !== 'image/webp' || Number(response.headers.get('Content-Length') ?? 0) > 256 * 1024) throw new Error('No pudimos cargar el logo. Actualiza y vuelve a intentar.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('El logo no está disponible.');
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); check(signal);
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) { await reader.cancel(); throw new Error('El logo es demasiado grande.'); }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  if (size < 12) throw new Error('El logo no es válido.');
  return new Blob(chunks, { type: 'image/webp' });
}
function validateQr(qrSvg: string, bookingUrl: string) {
  const document = new DOMParser().parseFromString(qrSvg, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg' || root.getAttribute('data-booking-url') !== bookingUrl || document.querySelector('parsererror')) throw new Error('El QR cambió. Vuelve a preparar la tarjeta.');
  for (const node of document.querySelectorAll('*')) {
    if (!['svg', 'path', 'title'].includes(node.localName)) throw new Error('El QR no es válido.');
    for (const attribute of node.attributes) if (/^on/i.test(attribute.name) || /href|style|filter/i.test(attribute.name)) throw new Error('El QR no es válido.');
  }
}
export async function buildBookingCardAssets({ details, qrSvg, signal }: { details: BookingCardDetails; qrSvg: string; signal: AbortSignal }): Promise<{ png: Blob; pdf: Blob; qrSvg: Blob }> {
  check(signal);
  const layout = getBookingCardLayout(details);
  validateQr(qrSvg, details.bookingUrl);
  try {
    const font = await new FontFace('SarinCardDM', 'url(/fonts/dm-sans-latin.woff2)', { weight: '100 1000' }).load();
    check(signal); document.fonts.add(font);
  } catch (error) { check(signal); throw new Error('No pudimos cargar la fuente de la tarjeta. Reintenta.', { cause: error }); }
  const logo = await logoBlob(details, signal); check(signal);
  const qrBlob = new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' });
  const [qrImage, logoImage] = await Promise.all([loadImage(qrBlob, signal), logo ? loadImage(logo, signal) : Promise.resolve(null)]);
  check(signal);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width; canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Tu navegador no pudo preparar la tarjeta.');
  context.fillStyle = layout.background; context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = '#315ff3'; context.fillRect(59, 59, 1123, 8);
  if (logoImage) context.drawImage(logoImage, layout.logo.x, layout.logo.y, layout.logo.width, layout.logo.height);
  else {
    context.fillStyle = '#edf1ff'; context.beginPath(); context.arc(620.5, 232.5, 107.5, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#315ff3'; context.font = '600 85px SarinCardDM'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(details.businessName.trim().split(/\s+/).slice(0, 2).map(word => [...word][0]).join('').toLocaleUpperCase('es'), 620.5, 232.5, 190);
  }
  context.textAlign = 'center'; context.textBaseline = 'top';
  for (const box of layout.texts) {
    context.fillStyle = box.color;
    context.font = `${box.y < 800 ? '600' : '400'} ${box.fontSize}px SarinCardDM`;
    let value = box.text;
    if (box.y >= 1520 && box.y < 1650) {
      while (context.measureText(value).width > box.width && value.length > 1) value = `${[...value.replace(/…$/, '')].slice(0, -1).join('')}…`;
    }
    context.fillText(value, box.x + box.width / 2, box.y, box.width);
  }
  context.imageSmoothingEnabled = false;
  context.drawImage(qrImage, layout.qr.x, layout.qr.y, layout.qr.width, layout.qr.height);
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No pudimos generar la imagen de la tarjeta.')), 'image/png'));
  check(signal);
  const bytes = await png.arrayBuffer(); check(signal);
  const { PDFDocument } = await import('pdf-lib'); check(signal);
  const documentPdf = await PDFDocument.create(); check(signal);
  const embedded = await documentPdf.embedPng(bytes); check(signal);
  const width = 105 * 72 / 25.4, height = 148 * 72 / 25.4;
  documentPdf.addPage([width, height]).drawImage(embedded, { x: 0, y: 0, width, height });
  const pdfBytes = await documentPdf.save(); check(signal);
  return { png, pdf: new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }), qrSvg: qrBlob };
}
