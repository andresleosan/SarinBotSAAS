export type AdminPath = '/admin' | '/admin/assistant';
export type AdminModule = 'summary' | 'businesses' | 'access' | 'intelligence' | 'billing' | 'attention';
export type AdminSection = 'overview' | 'list' | 'booking-policy' | 'receipts' | 'invitations' | 'provider' | 'business-budget' | 'platform-budget' | 'usage' | 'business-whatsapp' | 'settings' | 'query' | 'payments' | 'platform-whatsapp' | 'web-support';
export type AdminDestination = { module: AdminModule; section?: AdminSection };
export type AdminLocation = {
  path: AdminPath;
  module: AdminModule;
  section: AdminSection;
  focusPayment: string | null;
  proposalId: string | null;
  supportThread: string | null;
  targetId: string | null;
  error: string | null;
  key: string;
};
export type WorkspaceNavItem = { id: string; label: string; href: string };

type ModuleDefinition = { id: AdminModule; label: string; sections: { id: AdminSection; label: string }[] };
const modules: ModuleDefinition[] = [
  { id: 'summary', label: 'Resumen', sections: [{ id: 'overview', label: 'Resumen' }] },
  { id: 'businesses', label: 'Negocios', sections: [
    { id: 'list', label: 'Negocios y suscripciones' },
    { id: 'booking-policy', label: 'Política de datos de reservas' },
  ] },
  { id: 'access', label: 'Pagos y acceso', sections: [
    { id: 'receipts', label: 'Comprobantes' }, { id: 'invitations', label: 'Invitaciones' },
  ] },
  { id: 'intelligence', label: 'IA y canales', sections: [
    { id: 'provider', label: 'Proveedor de IA' },
    { id: 'business-budget', label: 'Presupuesto de IA de negocios' },
    { id: 'platform-budget', label: 'Presupuesto de IA de Sarin' },
    { id: 'usage', label: 'Uso de IA' },
    { id: 'business-whatsapp', label: 'WhatsApp de negocios' },
  ] },
  { id: 'attention', label: 'Asistente y atención', sections: [
    { id: 'query', label: 'Consulta' }, { id: 'payments', label: 'Revisión de pagos' },
    { id: 'platform-whatsapp', label: 'WhatsApp de Sarin' },
    { id: 'business-whatsapp', label: 'Conversaciones de negocios' },
    { id: 'web-support', label: 'Soporte web' },
  ] },
  { id: 'billing', label: 'Facturación de Sarin', sections: [{ id: 'settings', label: 'Configuración de facturación' }] },
];
const navigationError = 'No pudimos abrir esa sección. Elige una tarea del menú';
const recordId = /^[A-Za-z0-9_-]{1,128}$/;
const proposalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const supportUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fullMatch(pattern: RegExp, value: string): boolean {
  // JavaScript's $ can match before a final newline; require the whole value.
  return pattern.exec(value)?.[0] === value;
}

function definition(module: string): ModuleDefinition | undefined {
  return modules.find(item => item.id === module);
}

function location(value: Omit<AdminLocation, 'key'>): AdminLocation {
  return { ...value, key: JSON.stringify([
    value.path, value.module, value.section, value.focusPayment,
    value.proposalId, value.supportThread, value.targetId, value.error,
  ]) };
}

export function resolveAdminLocation(path: AdminPath, search: string, hash: string): AdminLocation {
  const safePath: AdminPath = path === '/admin/assistant' ? path : '/admin';
  const fallback = (error: string | null = navigationError) => location({
    path: safePath, module: safePath === '/admin' ? 'summary' : 'attention',
    section: safePath === '/admin' ? 'overview' : 'query',
    focusPayment: null, proposalId: null, supportThread: null, targetId: null, error,
  });
  if (path !== '/admin' && path !== '/admin/assistant') return fallback();
  const params = new URLSearchParams(search);
  for (const key of ['module', 'section', 'focusPayment', 'paymentAction', 'support']) {
    if (params.getAll(key).length > 1) return fallback();
  }
  if (path === '/admin/assistant' && params.has('module')) return fallback();
  const selected = definition(params.get('module') ?? (path === '/admin' ? 'summary' : 'attention'));
  if (!selected || (path === '/admin' && selected.id === 'attention')) return fallback();
  const section = params.get('section') ?? selected.sections[0].id;
  let module = selected.id;
  let activeSection = section as AdminSection;
  let focusPayment: string | null = null;
  let proposalId: string | null = null;
  let supportThread: string | null = null;
  let targetId: string | null = null;
  const targetParameters = ['focusPayment', 'paymentAction', 'support'].filter(key => params.has(key));
  if (targetParameters.length > 1) return fallback();

  if (params.has('focusPayment')) {
    const id = params.get('focusPayment')!;
    if (path !== '/admin' || !fullMatch(recordId, id)) return fallback();
    focusPayment = id;
    module = 'access'; activeSection = 'receipts'; targetId = `payment-${id}`;
  }
  if (params.has('paymentAction')) {
    const id = params.get('paymentAction')!;
    if (path !== '/admin/assistant' || !fullMatch(proposalUuid, id)) return fallback();
    proposalId = id;
    module = 'attention'; activeSection = 'payments';
  }
  if (params.has('support')) {
    const id = params.get('support')!;
    if (path !== '/admin/assistant' || !fullMatch(supportUuid, id)) return fallback();
    supportThread = id;
    module = 'attention'; activeSection = 'web-support'; targetId = 'soporte-web';
  }

  const anchor = hash.startsWith('#') ? hash.slice(1) : hash;
  if (anchor.startsWith('payment-')) {
    const id = anchor.slice('payment-'.length);
    if (path !== '/admin' || !fullMatch(recordId, id) || (focusPayment !== null && focusPayment !== id)) return fallback();
    focusPayment = id;
    module = 'access'; activeSection = 'receipts'; targetId = anchor;
  } else if (anchor.startsWith('business-')) {
    const id = anchor.slice('business-'.length);
    if (path !== '/admin' || !fullMatch(recordId, id) || targetParameters.length > 0) return fallback();
    module = 'businesses'; activeSection = 'list'; targetId = anchor;
  } else if (anchor === 'soporte-web') {
    if (path !== '/admin/assistant' || proposalId !== null) return fallback();
    module = 'attention'; activeSection = 'web-support'; targetId = anchor;
  }
  // Validated records own their context, even when an old visual section remains.
  if (targetId === null && proposalId === null && !selected.sections.some(item => item.id === section)) return fallback();
  return location({ path, module, section: activeSection, focusPayment, proposalId, supportThread, targetId, error: null });
}

export function buildAdminHref(destination: AdminDestination): string {
  const selected = definition(destination.module);
  const section = destination.section ?? selected?.sections[0].id;
  if (!selected || !selected.sections.some(item => item.id === section)) throw new Error('Invalid administrative destination');
  return destination.module === 'attention'
    ? `/admin/assistant?section=${section}`
    : `/admin?module=${destination.module}&section=${section}`;
}

export function adminConsoleReadPath(focusPayment: string | null): string {
  if (focusPayment === null) return '/api/admin';
  if (!fullMatch(recordId, focusPayment)) throw new Error('Invalid focused payment');
  return `/api/admin?focusPayment=${encodeURIComponent(focusPayment)}`;
}

export function getAdminNavigationItems(): WorkspaceNavItem[] {
  return modules.map(({ id, label }) => ({ id, label, href: buildAdminHref({ module: id }) }));
}

export function getAdminSectionItems(module: AdminModule): WorkspaceNavItem[] {
  const selected = definition(module);
  if (!selected) throw new Error('Invalid administrative module');
  return selected.sections.map(({ id, label }) => ({ id, label, href: buildAdminHref({ module, section: id }) }));
}
