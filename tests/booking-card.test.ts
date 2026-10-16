import { describe, expect, it } from 'vitest';
import { getBookingCardLayout, type BookingCardDetails } from '@/lib/booking-card';
const details: BookingCardDetails = { businessId: 'business', slug: 'barberia-norte', businessName: 'Barbería Norte', phoneWhatsApp: '573001234567', socialLinks: [], bookingUrl: 'https://sarinbotsaas.pages.dev/b/barberia-norte', logoSha256: null };
describe('selected Agenda clara card', () => {
  it('renders_selected_agenda_clara_template within the A6 safe area and keeps the QR fixed', () => {
    const layout = getBookingCardLayout(details);
    expect(layout).toMatchObject({ width: 1241, height: 1749, background: '#ffffff', qr: { x: 325, y: 835, width: 591, height: 591 } });
    expect(layout.texts.map(box => box.text).join(' ')).toContain('Escanea y agenda tu cita');
    expect(layout.texts.map(box => box.text).join(' ')).toContain('Reservas con Sarin');
    expect(JSON.stringify(layout)).not.toMatch(/example\.com|@instagram|Oscura|Cálida/);
    for (const box of [...layout.texts, layout.logo, layout.qr]) {
      expect(box.x).toBeGreaterThanOrEqual(59); expect(box.x + box.width).toBeLessThanOrEqual(1182);
      expect(box.y).toBeGreaterThanOrEqual(59); expect(box.y + box.height).toBeLessThanOrEqual(1690);
    }
  });
  it('fits_long_accented_and_unbroken_names without dropping characters or moving the QR', () => {
    for (const businessName of ['Peluquería y Estética María José '.repeat(4).slice(0, 120).trim(), 'W'.repeat(120), 'Á'.repeat(120), 'M'.repeat(70), 'a'.repeat(70)]) {
      const value = { ...details, businessName, socialLinks: [{ platform: 'website' as const, url: 'https://negocio.example/reservas?sede=norte' }, { platform: 'instagram' as const, url: 'https://instagram.com/negocio' }, { platform: 'facebook' as const, url: 'https://facebook.com/negocio' }] };
      const layout = getBookingCardLayout(value);
      const lines = layout.texts.filter(box => box.y >= 365 && box.y < 680);
      expect(lines.length).toBeLessThanOrEqual(5);
      expect(lines.map(box => box.text).join('').replace(/\s/g, '')).toBe(businessName.replace(/\s/g, ''));
      expect(lines.every(box => box.fontSize >= 11 * 300 / 72)).toBe(true);
      expect(lines.every(box => box.y + box.height <= 680)).toBe(true);
      expect(layout.qr).toEqual(getBookingCardLayout(details).qr);
      expect(layout.texts.filter(box => box.y >= 1520 && box.y < 1650)).toHaveLength(3);
      expect(layout.texts.some(box => box.text.startsWith('Instagram · @negocio'))).toBe(true);
    }
  });
});
