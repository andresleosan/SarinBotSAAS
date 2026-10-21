import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BusinessContactLinks, businessContactDigits } from '@/components/business-contact-links';

describe('published business contact links', () => {
  it.each([
    ['12345678', '12345678'], ['+12345678', '12345678'],
    ['123456789012345', '123456789012345'], ['+123456789012345', '123456789012345'],
  ])('renders callable and WhatsApp destinations for an exact valid phone %s', (phone, digits) => {
    expect(businessContactDigits(phone)).toBe(digits);
    const html = renderToStaticMarkup(createElement(BusinessContactLinks, { phone, className: 'synthetic-contact' }));
    expect(html).toContain(`href="tel:+${digits}" class="synthetic-contact">+${digits}</a>`);
    expect(html).toContain(`href="https://wa.me/${digits}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('class="synthetic-contact">Escribir por WhatsApp</a>');
  });

  it.each([null, undefined, 12345678, {}, '', '1234567', '1234567890123456', '02345678', '+02345678',
    ' 12345678', '12345678 ', '1234 5678', '1234-5678', '(12345678)', '++12345678',
    '12345678\n', '12345678\r\n', 'https://wa.me/12345678', '１２３４５６７８'])('does not turn malformed stored data into callable links: %j', phone => {
    expect(businessContactDigits(phone)).toBeNull();
    expect(renderToStaticMarkup(createElement(BusinessContactLinks, { phone }))).toBe('');
  });

  it('provides usable wrapping and keyboard focus styles when no class is supplied', () => {
    const html = renderToStaticMarkup(createElement(BusinessContactLinks, { phone: '12345678' }));
    expect(html.match(/min-h-11/g)).toHaveLength(2);
    expect(html.match(/\[overflow-wrap:anywhere\]/g)).toHaveLength(2);
    expect(html.match(/focus-visible:outline-2/g)).toHaveLength(2);
  });
});
