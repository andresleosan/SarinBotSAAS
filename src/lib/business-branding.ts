import { z } from 'zod';

export type BusinessSocialPlatform = 'instagram' | 'facebook' | 'tiktok' | 'website';
export interface BusinessSocialLink { platform: BusinessSocialPlatform; url: string; }
export interface BusinessLogo { sha256: string; }
const linksSchema = z.array(z.object({ platform: z.enum(['instagram', 'facebook', 'tiktok', 'website']), url: z.string().min(1).max(512) }).strict()).max(3);
const hosts = { instagram: 'instagram.com', facebook: 'facebook.com', tiktok: 'tiktok.com' };
export const businessSocialLinksSchema = linksSchema.superRefine((value, context) => {
  try { normalizeBusinessSocialLinks(value); }
  catch { context.addIssue({ code: 'custom', message: 'Revisa los enlaces de contacto.' }); }
});

export function normalizeBusinessSocialLinks(value: unknown): BusinessSocialLink[] {
  const links = linksSchema.parse(value);
  if (new Set(links.map(link => link.platform)).size !== links.length) throw new Error('Selecciona cada red una sola vez.');
  return links.map(link => {
    const authority = /^https:\/\/([^/?#]+)/i.exec(link.url)?.[1];
    if (!authority || /[\x00-\x20\x7f]/.test(link.url) || authority.includes(':') || authority.includes('@')) throw new Error('Usa un enlace HTTPS sin puerto ni credenciales.');
    const url = new URL(link.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname.includes('.')) throw new Error('Enlace de contacto no válido.');
    if (link.platform !== 'website') {
      if (![hosts[link.platform], `www.${hosts[link.platform]}`].includes(url.hostname)) throw new Error('El enlace no corresponde a la red seleccionada.');
      const facebookId = link.platform === 'facebook' && url.pathname === '/profile.php' ? url.searchParams.get('id') : null;
      if (link.platform === 'facebook' && url.pathname === '/profile.php' && (!facebookId || !/^\d{1,30}$/.test(facebookId) || url.searchParams.getAll('id').length !== 1)) throw new Error('El perfil de Facebook necesita un identificador válido.');
      url.search = '';
      if (facebookId) url.searchParams.set('id', facebookId);
    }
    return { platform: link.platform, url: url.href };
  });
}
export function businessSocialLabel(link: BusinessSocialLink): string {
  const url = new URL(link.url);
  if (link.platform === 'website') return url.hostname.replace(/^www\./, '');
  if (link.platform === 'facebook' && url.pathname === '/profile.php') return `Facebook · ${url.searchParams.get('id')}`;
  let name = url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname;
  try { name = decodeURIComponent(name).replace(/[\x00-\x1f\x7f]/g, ''); } catch { /* Keep the encoded public path. */ }
  return `@${name.replace(/^@/, '')}`;
}
