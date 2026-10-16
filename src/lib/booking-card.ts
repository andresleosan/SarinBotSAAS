import { businessSocialLabel, businessSocialPlatformLabels, normalizeBusinessSocialLinks, type BusinessSocialLink } from '@/lib/business-branding';

export interface BookingCardDetails { businessId: string; slug: string; businessName: string; phoneWhatsApp: string; socialLinks: BusinessSocialLink[]; bookingUrl: string; logoSha256: string | null; }
export interface CardBox { x: number; y: number; width: number; height: number; }
export interface CardTextBox extends CardBox { text: string; fontSize: number; color: string; }
export interface BookingCardLayout { width: 1241; height: 1749; background: string; logo: CardBox; qr: CardBox; texts: CardTextBox[]; }
const graphemes = (text: string) => [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
const widthOf = (char: string, size: number) => size * (/\s/.test(char) ? 0.4 : /[MW@#%]/.test(char) ? 1 : 0.78);
function wrap(text: string, size: number): string[] {
  const remaining = graphemes(text);
  const lines: string[] = [];
  while (remaining.length) {
    let count = 0, width = 0, lastSpace = -1;
    while (count < remaining.length && width + widthOf(remaining[count], size) <= 1123) {
      width += widthOf(remaining[count], size);
      if (/\s/.test(remaining[count])) lastSpace = count;
      count++;
    }
    if (count < remaining.length && lastSpace > 0) count = lastSpace;
    if (!count) throw new Error('No pudimos ajustar el nombre del negocio.');
    lines.push(remaining.splice(0, count).join('').trim());
    while (remaining.length && /\s/.test(remaining[0])) remaining.shift();
  }
  return lines;
}
export function getBookingCardLayout(details: BookingCardDetails): BookingCardLayout {
  const name = details.businessName.trim().replace(/[\x00-\x1f\x7f]/g, ' ');
  if (!name || name.length > 120) throw new Error('Revisa el nombre guardado del negocio.');
  const links = normalizeBusinessSocialLinks(details.socialLinks);
  let fontSize = 22 * 300 / 72;
  const minimum = 11 * 300 / 72;
  let lines = wrap(name, fontSize);
  while ((lines.length > 4 || lines.length * fontSize * 1.14 > 300) && fontSize > minimum) { fontSize = Math.max(minimum, fontSize - 1); lines = wrap(name, fontSize); }
  if (lines.length > 5) throw new Error('No pudimos ajustar el nombre del negocio.');
  const lineHeight = fontSize * 1.14;
  const top = 365 + (300 - lines.length * lineHeight) / 2;
  const textBox = (text: string, y: number, size: number, height: number, color = '#162344'): CardTextBox => ({ text, x: 59, y, width: 1123, height, fontSize: size, color });
  const texts = lines.map((text, index) => textBox(text, top + index * lineHeight, fontSize, lineHeight));
  texts.push(textBox('Escanea y agenda tu cita', 724, 53, 70));
  if (details.phoneWhatsApp) texts.push(textBox(`+${details.phoneWhatsApp.replace(/^\+/, '')}`, 1475, 38, 48));
  links.forEach((link, index) => {
    const label = `${businessSocialPlatformLabels[link.platform]} · ${businessSocialLabel(link)}`;
    const parts = graphemes(label);
    texts.push(textBox(parts.length > 53 ? `${parts.slice(0, 52).join('')}…` : label, 1532 + index * 39, 31, 38, '#52617d'));
  });
  texts.push(textBox('Reservas con Sarin', 1658, 26, 32, '#315ff3'));
  return { width: 1241, height: 1749, background: '#ffffff', logo: { x: 513, y: 125, width: 215, height: 215 }, qr: { x: 325, y: 835, width: 591, height: 591 }, texts };
}
