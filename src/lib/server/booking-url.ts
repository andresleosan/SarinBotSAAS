import 'server-only';
import { isIP } from 'node:net';
import { HttpError } from './http';

export function getCanonicalBookingUrl(slug: string, origin = process.env.SARIN_PUBLIC_BOOKING_ORIGIN): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 70) throw new HttpError(400, 'El enlace del negocio no es válido.');
  const fail = () => new HttpError(503, 'El enlace de reservas aún no está configurado. Contacta a administración.', 'BOOKING_ORIGIN_UNAVAILABLE');
  if (!origin || /[\x00-\x20\x7f]/.test(origin)) throw fail();
  let url: URL;
  try { url = new URL(origin); } catch { throw fail(); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fail();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const demo = process.env.NODE_ENV !== 'production' && process.env.FIREBASE_ADMIN_PROJECT_ID?.startsWith('demo-');
  if (url.protocol === 'http:' && loopback && demo) return `${url.origin}/b/${slug}`;
  const authority = /^https:\/\/([^/]+)/i.exec(origin)?.[1];
  const reserved = ['localhost', 'example.com', 'example.net', 'example.org'];
  if (url.protocol !== 'https:' || !authority || authority.includes(':') || isIP(hostname) || !hostname.includes('.') || reserved.some(host => hostname === host || hostname.endsWith(`.${host}`)) || /\.(test|invalid|example|localhost|workers\.dev|vercel\.app|netlify\.app)$/.test(hostname) || (hostname.endsWith('.pages.dev') && hostname !== 'sarinbotsaas.pages.dev')) throw fail();
  return `${url.origin}/b/${slug}`;
}
