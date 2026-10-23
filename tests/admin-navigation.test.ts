import { describe, expect, it } from 'vitest';
import {
  adminConsoleReadPath, buildAdminHref, getAdminNavigationItems, getAdminSectionItems,
  resolveAdminLocation, type AdminModule, type AdminPath, type AdminSection,
} from '@/lib/admin-navigation';

const message = 'No pudimos abrir esa sección. Elige una tarea del menú';
const proposal = '12345678-1234-4123-8123-123456789abc';
const thread = 'abcdef12-3456-4789-abcd-123456789abc';
const sections: [AdminModule, AdminSection, string][] = [
  ['summary', 'overview', '/admin?module=summary&section=overview'],
  ['businesses', 'list', '/admin?module=businesses&section=list'],
  ['businesses', 'booking-policy', '/admin?module=businesses&section=booking-policy'],
  ['access', 'receipts', '/admin?module=access&section=receipts'],
  ['access', 'invitations', '/admin?module=access&section=invitations'],
  ['intelligence', 'provider', '/admin?module=intelligence&section=provider'],
  ['intelligence', 'business-budget', '/admin?module=intelligence&section=business-budget'],
  ['intelligence', 'platform-budget', '/admin?module=intelligence&section=platform-budget'],
  ['intelligence', 'usage', '/admin?module=intelligence&section=usage'],
  ['intelligence', 'business-whatsapp', '/admin?module=intelligence&section=business-whatsapp'],
  ['billing', 'settings', '/admin?module=billing&section=settings'],
  ['attention', 'query', '/admin/assistant?section=query'],
  ['attention', 'payments', '/admin/assistant?section=payments'],
  ['attention', 'platform-whatsapp', '/admin/assistant?section=platform-whatsapp'],
  ['attention', 'business-whatsapp', '/admin/assistant?section=business-whatsapp'],
  ['attention', 'web-support', '/admin/assistant?section=web-support'],
];
const defaults: [AdminModule, AdminSection, string][] = [
  ['summary', 'overview', '/admin?module=summary&section=overview'],
  ['businesses', 'list', '/admin?module=businesses&section=list'],
  ['access', 'receipts', '/admin?module=access&section=receipts'],
  ['intelligence', 'provider', '/admin?module=intelligence&section=provider'],
  ['attention', 'query', '/admin/assistant?section=query'],
  ['billing', 'settings', '/admin?module=billing&section=settings'],
];

function resolve(href: string) {
  const url = new URL(href, 'https://local.invalid');
  return resolveAdminLocation(url.pathname as AdminPath, url.search, url.hash);
}

function expectFallback(href: string) {
  const path = href.startsWith('/admin/assistant') ? '/admin/assistant' : '/admin';
  expect(resolve(href)).toEqual({
    ...resolveAdminLocation(path, '', ''), error: message,
    key: expect.any(String),
  });
}

describe('administrative navigation', () => {
  it.each(sections)('resolves and builds the allowed %s/%s section', (module, section, href) => {
    expect(resolve(href)).toMatchObject({ module, section, error: null, focusPayment: null, proposalId: null, supportThread: null, targetId: null });
    expect(buildAdminHref({ module, section })).toBe(href);
    expect(getAdminSectionItems(module)).toContainEqual({ id: section, label: expect.any(String), href });
  });

  it.each(defaults)('defaults %s to %s', (module, section, href) => {
    const input = module === 'attention' ? '/admin/assistant' : `/admin?module=${module}`;
    expect(resolve(input)).toMatchObject({ module, section, error: null });
    expect(buildAdminHref({ module })).toBe(href);
  });

  it('offers six named modules and only their allowed sections', () => {
    const items = getAdminNavigationItems();
    expect(items.map(item => [item.id, item.label, item.href])).toEqual([
      ['summary', 'Resumen', '/admin?module=summary&section=overview'],
      ['businesses', 'Negocios', '/admin?module=businesses&section=list'],
      ['access', 'Pagos y acceso', '/admin?module=access&section=receipts'],
      ['intelligence', 'IA y canales', '/admin?module=intelligence&section=provider'],
      ['attention', 'Asistente y atención', '/admin/assistant?section=query'],
      ['billing', 'Facturación de Sarin', '/admin?module=billing&section=settings'],
    ]);
    for (const [module] of defaults) {
      expect(getAdminSectionItems(module).map(item => item.id)).toEqual(sections.filter(row => row[0] === module).map(row => row[1]));
    }
    items[0].href = '/changed';
    expect(getAdminNavigationItems()[0].href).toBe('/admin?module=summary&section=overview');
    const children = getAdminSectionItems('summary');
    children[0].href = '/changed';
    expect(getAdminSectionItems('summary')[0].href).toBe('/admin?module=summary&section=overview');
  });

  it.each([
    '/admin?module=', '/admin?section=', '/admin?module=unknown', '/admin?section=unknown',
    '/admin?module=summary&module=summary', '/admin?section=overview&section=overview',
    '/admin?module=businesses&section=receipts', '/admin?module=attention',
    '/admin/assistant?module=attention', '/admin/assistant?module=',
    '/admin/assistant?section=overview', '/admin/assistant?section=query&section=query',
    '/admin?focusPayment=', '/admin?focusPayment=../payment', '/admin?focusPayment=a%20b',
    '/admin?focusPayment=a&focusPayment=a', '/admin#payment-', '/admin#business-',
    '/admin/assistant?paymentAction=', '/admin/assistant?support=',
    '/admin/assistant?paymentAction=bad', '/admin/assistant?support=bad',
    `/admin/assistant?paymentAction=${proposal}&paymentAction=${proposal}`,
    `/admin/assistant?support=${thread}&support=${thread}`,
    `/admin?paymentAction=${proposal}`, `/admin?support=${thread}`,
    '/admin/assistant?focusPayment=old-payment', '/admin/assistant#payment-old-payment',
    '/admin/assistant#business-demo', '/admin#soporte-web',
    '/admin?module=unknown&focusPayment=old-payment',
  ])('invalidOrDuplicateNavigationFallsBack: %s', href => expectFallback(href));

  it.each([
    ['/admin?module=summary&section=overview&focusPayment=old-payment#payment-old-payment', 'access', 'receipts'],
    ['/admin?module=billing&section=settings#business-demo', 'businesses', 'list'],
    [`/admin/assistant?section=query&paymentAction=${proposal}`, 'attention', 'payments'],
    [`/admin/assistant?section=payments&support=${thread}`, 'attention', 'web-support'],
    ['/admin/assistant?section=query#soporte-web', 'attention', 'web-support'],
    ['/admin?module=businesses&section=receipts&focusPayment=old-payment', 'access', 'receipts'],
    ['/admin?section=unknown#business-demo', 'businesses', 'list'],
    ['/admin?section=#payment-old-payment', 'access', 'receipts'],
    [`/admin/assistant?section=unknown&paymentAction=${proposal}`, 'attention', 'payments'],
    [`/admin/assistant?section=overview&support=${thread}`, 'attention', 'web-support'],
    ['/admin/assistant?section=#soporte-web', 'attention', 'web-support'],
  ])('validRecordOverridesVisualSelection: %s', (href, module, section) => {
    expect(resolve(href)).toMatchObject({ module, section, error: null });
  });

  it.each([
    '/admin?focusPayment=a#payment-b', '/admin?focusPayment=a#business-demo',
    `/admin/assistant?paymentAction=${proposal}&support=${thread}`,
    `/admin/assistant?paymentAction=${proposal}#soporte-web`,
    `/admin/assistant?support=${thread}#payment-old-payment`,
  ])('contradictoryRecordTargetsAreRejected: %s', href => expectFallback(href));

  it('hashPaymentDerivesFocusedRead', () => {
    const location = resolve('/admin#payment-old-payment');
    expect(location).toMatchObject({ module: 'access', section: 'receipts', focusPayment: 'old-payment', targetId: 'payment-old-payment', error: null });
    expect(adminConsoleReadPath(location.focusPayment)).toBe('/api/admin?focusPayment=old-payment');
    expect(adminConsoleReadPath('old-payment')).toBe('/api/admin?focusPayment=old-payment');
    expect(resolve('/admin?focusPayment=old-payment')).toMatchObject({ targetId: 'payment-old-payment' });
  });

  it('unsupportedBusinessFocusDoesNotInventApi', () => {
    const location = resolve('/admin#business-demo');
    expect(location).toMatchObject({ module: 'businesses', section: 'list', targetId: 'business-demo', focusPayment: null, error: null });
    expect(adminConsoleReadPath(location.focusPayment)).toBe('/api/admin');
    expect(resolve('/admin?focusBusiness=demo')).toMatchObject({ module: 'summary', section: 'overview', error: null });
  });

  it('supportRequiresV4', () => {
    expect(resolve(`/admin/assistant?support=${thread}#soporte-web`)).toMatchObject({ section: 'web-support', supportThread: thread, targetId: 'soporte-web', error: null });
    expect(resolve('/admin/assistant#soporte-web')).toMatchObject({ section: 'web-support', supportThread: null, targetId: 'soporte-web', error: null });
    for (const value of [thread.replace('-4789-', '-1789-'), thread.toUpperCase(), thread.replace('-abcd-', '-7bcd-')]) {
      expectFallback(`/admin/assistant?support=${value}`);
    }
  });

  it('paymentActionPreservesCurrentUuidContract', () => {
    for (const version of '12345678') {
      const id = `12345678-1234-${version}123-8123-123456789abc`;
      expect(resolve(`/admin/assistant?paymentAction=${id}`)).toMatchObject({ module: 'attention', section: 'payments', proposalId: id, targetId: null, error: null });
    }
    for (const id of [proposal.toUpperCase(), proposal.replace('-4123-', '-0123-'), proposal.replace('-8123-', '-c123-')]) {
      expectFallback(`/admin/assistant?paymentAction=${id}`);
    }
  });

  it('builderDropsOldTargets', () => {
    const incoming = resolve(`/admin/assistant?paymentAction=${proposal}`);
    expect(buildAdminHref({ ...incoming, module: 'attention', section: 'query' })).toBe('/admin/assistant?section=query');
    expect(buildAdminHref({ ...resolve('/admin?focusPayment=old-payment#payment-old-payment'), module: 'businesses', section: 'list' })).toBe('/admin?module=businesses&section=list');
    expect(() => buildAdminHref({ module: 'businesses', section: 'receipts' })).toThrow();
    expect(() => buildAdminHref({ module: 'unknown' as AdminModule })).toThrow();
  });

  it('unknownQueryNeverReachesAdminApi', () => {
    const location = resolve('/admin?module=access&section=receipts&receiptId=private&unknown=secret#unrelated');
    expect(location).toMatchObject({ module: 'access', section: 'receipts', error: null });
    expect(adminConsoleReadPath(location.focusPayment)).toBe('/api/admin');
    expect(location.key).not.toMatch(/private|secret|unknown|unrelated/);
    expect(resolve('/admin?focusPayment=old-payment&unknown=secret').key).toBe(resolve('/admin#payment-old-payment').key);
    expect(resolve('/admin').key).toBe(resolve('/admin?unknown=secret#unrelated').key);
    expect(resolve('/admin?module=businesses').key).not.toBe(resolve('/admin').key);
    expect(resolve('/admin?module=bad').key).not.toBe(resolve('/admin').key);
  });

  it('rejects malicious runtime paths and invalid focused reads locally', () => {
    expect(resolveAdminLocation('https://malicious.invalid/admin' as AdminPath, '', '')).toMatchObject({ path: '/admin', module: 'summary', section: 'overview', error: message });
    for (const path of ['/admin/../api/admin', '//malicious.invalid/admin', '/admin/assistant/extra']) {
      expect(resolveAdminLocation(path as AdminPath, '', '')).toMatchObject({ path: '/admin', error: message });
    }
    for (const id of ['', '../payment', 'a&receiptId=private', 'a'.repeat(129), 'a\n']) {
      expect(() => adminConsoleReadPath(id)).toThrow();
      expectFallback(`/admin?focusPayment=${encodeURIComponent(id)}`);
    }
    expect(adminConsoleReadPath('a'.repeat(128))).toBe(`/api/admin?focusPayment=${'a'.repeat(128)}`);
    expect(resolve(`/admin?focusPayment=${'a'.repeat(128)}`)).toMatchObject({ error: null });
    expectFallback(`/admin#business-${'a'.repeat(129)}`);
  });
});
