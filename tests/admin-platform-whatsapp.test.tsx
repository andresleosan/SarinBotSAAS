import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPlatformWhatsApp } from '@/components/admin-platform-whatsapp';
import { conversationFixture, deferred, inboxFixture, statusFixture } from './platform-whatsapp-ui-fixtures';
import type { PlatformWhatsAppStatus } from '@/types/platform-whatsapp';

const auth = vi.hoisted(() => ({ user: null as null | { uid: string; getIdToken: () => Promise<string> } }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: auth.user } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const accessMessage = 'La sesión o sus permisos dejaron de ser válidos. Se borró la información privada de esta vista. Vuelve a iniciar sesión para consultar.';

describe('private platform WhatsApp workspace through the real API client and poller', () => {
  let renderer: ReactTestRenderer | undefined;
  let page: EventTarget & { visibilityState: string };
  let browser: EventTarget;
  let now: number;
  let status: PlatformWhatsAppStatus;
  let inbox: ReturnType<typeof inboxFixture>;
  let transport: ReturnType<typeof vi.fn<(path: string, init: RequestInit) => Promise<Response>>>;
  const root = () => renderer!.root;
  const content = () => text(root());
  const button = (label: string) => root().findAllByType('button').find(node => text(node) === label)!;
  const writes = () => transport.mock.calls.filter(([, init]) => init.method === 'PATCH');
  const reads = () => transport.mock.calls.filter(([, init]) => init.method !== 'PATCH');
  const body = (index = 0) => JSON.parse(String(writes()[index][1].body));
  async function mount(scope: string | null = 'owner-a') { await act(async () => { renderer = create(createElement(AdminPlatformWhatsApp, { scope })); }); }
  async function click(label: string) { await act(async () => button(label).props.onClick()); }
  async function event(target: EventTarget, name: string) { await act(async () => target.dispatchEvent(new Event(name))); }
  async function fill(values: string[]) { await act(async () => { root().findAllByType('input').forEach((input, index) => input.props.onChange({ target: { value: values[index] } })); }); }
  beforeEach(() => {
    now = 0; vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => now);
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' }); browser = new EventTarget();
    vi.stubGlobal('document', page); vi.stubGlobal('window', browser);
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('No persistent storage'); }, setItem: () => { throw Error('No persistent storage'); }, clear: () => { throw Error('No historical purge'); } });
    vi.stubGlobal('sessionStorage', { getItem: () => { throw Error('No persistent storage'); }, setItem: () => { throw Error('No persistent storage'); }, clear: () => { throw Error('No historical purge'); } });
    auth.user = { uid: 'owner-a', getIdToken: async () => 'synthetic-token' };
    status = statusFixture(); inbox = inboxFixture();
    transport = vi.fn(async path => response(path.endsWith('/status') ? status : inbox));
    vi.stubGlobal('fetch', transport);
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount()); renderer = undefined;
    vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
  });

  it('shows a named sign-in section without requesting private data when no UID exists', async () => {
    await mount(null);
    expect(content()).toContain('Inicia sesión con permisos de administración para consultar esta bandeja privada.');
    expect(root().findByType('section').props['aria-label']).toBe('WhatsApp de SarinBot');
    expect(transport).not.toHaveBeenCalled();
  });
  it('starts both GETs concurrently with the same signal and only displays the completed snapshot', async () => {
    const connection = deferred<Response>(); const list = deferred<Response>();
    transport.mockImplementation(path => path.endsWith('/status') ? connection.promise : list.promise);
    await mount(); expect(reads()).toHaveLength(2);
    expect(reads().map(([path]) => path)).toEqual(['/api/admin/platform-whatsapp/status', '/api/admin/platform-whatsapp/conversations']);
    expect(reads()[0][1].signal).toBe(reads()[1][1].signal);
    expect(reads()[0][1].cache).toBe('no-store');
    expect(new Headers(reads()[0][1].headers).get('Authorization')).toBe('Bearer synthetic-token');
    expect(content()).toContain('Consultando WhatsApp de SarinBot…');
    expect(button('Actualizar bandeja de SarinBot').props.disabled).toBe(false);
    await act(async () => list.resolve(response(inbox)));
    expect(content()).not.toContain('Consulta sintética');
    expect(content()).not.toContain('Sin consultas de SarinBot en esta lectura.');
    await act(async () => connection.resolve(response(status)));
    expect(content()).toContain('Consulta sintética'); expect(content()).toContain('Recepción para atención humana');
  });
  it.each(['status', 'conversations'])('retains the complete confirmed snapshot on a partial %s failure', async endpoint => {
    await mount(); status = statusFixture({ connectionRevision: 99, presentationState: 'disconnected' }); inbox = inboxFixture([]);
    transport.mockImplementation(async path => path.endsWith('/' + endpoint) ? response({ error: 'Fallo sintético' }, 503) : response(path.endsWith('/status') ? status : inbox));
    await click('Actualizar bandeja de SarinBot');
    expect(content()).toContain('Consulta sintética'); expect(content()).toContain('Recepción para atención humana');
    expect(content()).toContain('Fallo sintético Se conserva el último estado confirmado; actualiza para comprobar cambios.');
    expect(content()).not.toContain('Sin consultas de SarinBot en esta lectura.');
  });
  it('shows an initial failure without claiming an empty inbox and recovers on manual refresh', async () => {
    transport.mockImplementation(async () => response({ error: 'Sin lectura' }, 503)); await mount();
    expect(content()).toContain('Sin lectura'); expect(content()).not.toContain('Sin consultas'); expect(content()).not.toContain('último estado confirmado');
    transport.mockImplementation(async path => response(path.endsWith('/status') ? status : inboxFixture([], true)));
    await click('Actualizar bandeja de SarinBot');
    expect(content()).toContain('Se muestra una lista parcial por el límite de lectura. Puede haber más consultas fuera de esta vista.');
    expect(content()).toContain('Sin consultas de SarinBot en esta lectura. Esto no confirma que WhatsApp esté conectado.');
  });
  it.each([401, 403])('latches access loss from GET %s and aborts a pending PATCH without late resurrection', async code => {
    await mount(); await fill(['111111', '+573000000001', '222222']);
    const patch = deferred<Response>(); transport.mockImplementation((path, init) => init.method === 'PATCH' ? patch.promise : Promise.resolve(response({ error: 'Access lost' }, code)));
    await click('Tomar conversación'); const signal = writes()[0][1].signal!;
    await event(browser, 'focus'); expect(signal.aborted).toBe(true);
    expect(content()).toContain(accessMessage); expect(content()).not.toContain('Consulta sintética');
    expect(root().findAllByType('input')).toHaveLength(0); expect(button('Actualizar bandeja de SarinBot').props.disabled).toBe(true);
    const count = reads().length; await act(async () => patch.resolve(response({ conversation: conversationFixture({ mode: 'human' }) })));
    await event(browser, 'focus'); await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(reads()).toHaveLength(count); expect(content()).not.toContain('Cambio guardado');
  });
  it.each([401, 403])('latches access loss from PATCH %s and masks the old snapshot permanently', async code => {
    await mount(); const stale = button('Tomar conversación').props.onClick;
    transport.mockResolvedValueOnce(response({ error: 'Denied' }, code)); await click('Tomar conversación');
    expect(content()).toContain(accessMessage); expect(content()).not.toContain('+573000000002');
    await act(async () => stale()); expect(writes()).toHaveLength(1);
  });
  it('stops before fetch when identity changes during token retrieval', async () => {
    const token = deferred<string>(); auth.user = { uid: 'owner-a', getIdToken: () => token.promise }; await mount();
    auth.user = { uid: 'owner-b', getIdToken: async () => 'other-synthetic-token' };
    await act(async () => token.resolve('old-synthetic-token'));
    expect(transport).not.toHaveBeenCalled(); expect(content()).toContain(accessMessage);
  });
  it('remounts by UID and ignores old GET responses that ignore abort', async () => {
    const old = deferred<Response>(); transport.mockImplementation(() => old.promise); await mount();
    const signal = reads()[0][1].signal!;
    auth.user = { uid: 'owner-b', getIdToken: async () => 'next-token' };
    transport.mockImplementation(async path => response(path.endsWith('/status') ? statusFixture({ connectionRevision: 20 }) : inboxFixture([])));
    await act(async () => renderer!.update(createElement(AdminPlatformWhatsApp, { scope: 'owner-b' })));
    expect(signal.aborted).toBe(true); expect(content()).toContain('Revisión 20');
    await act(async () => old.resolve(response(inbox)));
    expect(content()).not.toContain('Consulta sintética'); expect(content()).toContain('Revisión 20');
  });
  it('aborts PATCH on UID remount and prevents old success/permission state reaching the new account', async () => {
    await mount(); const old = deferred<Response>(); transport.mockImplementationOnce(() => old.promise); await click('Tomar conversación');
    const signal = writes()[0][1].signal!; auth.user = { uid: 'owner-b', getIdToken: async () => 'next-token' }; inbox = inboxFixture([]);
    await act(async () => renderer!.update(createElement(AdminPlatformWhatsApp, { scope: 'owner-b' })));
    expect(signal.aborted).toBe(true); await act(async () => old.resolve(response({ error: 'Old permission loss' }, 403)));
    expect(content()).not.toContain(accessMessage); expect(content()).not.toContain('Cambio guardado'); expect(content()).toContain('Sin consultas');
  });
  it('expires the preview locally at equality without another GET', async () => {
    await mount(); now = 9_999; await act(async () => vi.advanceTimersByTimeAsync(9_999)); expect(content()).toContain('Consulta sintética');
    now = 10_000; await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(content()).not.toContain('Consulta sintética'); expect(content()).toContain('Contacto vencido'); expect(reads()).toHaveLength(2);
  });
  it('waits fifteen seconds after both reads settle, cancels hidden reads and refreshes when visible', async () => {
    const initial = deferred<Response>();
    transport.mockImplementation(path => path.endsWith('/conversations') ? initial.promise : Promise.resolve(response(status)));
    await mount(); await act(async () => vi.advanceTimersByTimeAsync(40_000)); expect(reads()).toHaveLength(2);
    await act(async () => initial.resolve(response(inboxFixture([]))));
    transport.mockImplementation(() => new Promise(() => {}));
    await act(async () => vi.advanceTimersByTimeAsync(14_999)); expect(reads()).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(reads()).toHaveLength(4);
    const signal = reads()[2][1].signal!; page.visibilityState = 'hidden'; await event(page, 'visibilitychange');
    expect(signal.aborted).toBe(true); await act(async () => vi.advanceTimersByTimeAsync(45_000)); expect(reads()).toHaveLength(4);
    page.visibilityState = 'visible'; await event(page, 'visibilitychange'); expect(reads()).toHaveLength(6);
  });
  it.each(['status', 'conversations'])('an isolated %s access failure clears partial content and prevents later successful reads from restoring access', async endpoint => {
    const other = deferred<Response>();
    transport.mockImplementation(path => path.endsWith('/' + endpoint) ? Promise.resolve(response({ error: 'Denied' }, 403)) : other.promise);
    await mount(); expect(content()).toContain(accessMessage);
    await act(async () => other.resolve(response(endpoint === 'status' ? inbox : status)));
    expect(content()).toContain(accessMessage); expect(content()).not.toContain('Consulta sintética');
    expect(root().findAllByType('article')).toHaveLength(0);
  });
  it('ignores an old GET permission failure after a newer full refresh has succeeded', async () => {
    await mount(); const oldStatus = deferred<Response>(), oldList = deferred<Response>();
    transport.mockImplementation(path => path.endsWith('/status') ? oldStatus.promise : oldList.promise);
    await click('Actualizar bandeja de SarinBot');
    transport.mockImplementation(async path => response(path.endsWith('/status') ? statusFixture({ connectionRevision: 12 }) : inbox));
    await click('Actualizar bandeja de SarinBot');
    await act(async () => { oldStatus.resolve(response({ error: 'Stale denied' }, 401)); oldList.resolve(response(inboxFixture([]))); });
    expect(content()).toContain('Revisión 12'); expect(content()).not.toContain(accessMessage); expect(content()).not.toContain('Stale denied');
  });
  it('treats a plain status-bearing rejection as irreversible access loss', async () => {
    auth.user = { uid: 'owner-a', getIdToken: async () => { throw { status: 403 }; } };
    await mount(); expect(content()).toContain(accessMessage); expect(transport).not.toHaveBeenCalled();
    expect(root().findAllByProps({ role: 'alert' }).some(node => text(node) === accessMessage)).toBe(true);
  });
  it('spends GET latency before displaying content', async () => {
    const list = deferred<Response>(); transport.mockImplementation(path => path.endsWith('/conversations') ? list.promise : Promise.resolve(response(status)));
    await mount(); now = 10_001; await act(async () => list.resolve(response(inbox)));
    expect(content()).toContain('Contacto vencido'); expect(content()).not.toContain('Consulta sintética');
  });
  it.each(['blur', 'focus', 'visibilitychange'])('clears previews on %s and rejects plaintext from an older PATCH epoch', async name => {
    await mount(); const patch = deferred<Response>(); transport.mockImplementation((path, init) => init.method === 'PATCH' ? patch.promise : new Promise(() => {}));
    await click('Tomar conversación'); const signal = writes()[0][1].signal!;
    await event(name === 'visibilitychange' ? page : browser, name);
    expect(signal.aborted).toBe(false); expect(content()).not.toContain('Consulta sintética');
    await act(async () => patch.resolve(response({ conversation: conversationFixture({ mode: 'human', revision: 8 }) })));
    expect(content()).toContain('Atención humana · Revisión 8'); expect(content()).toContain('Cambio guardado. Se muestra el estado confirmado.');
    expect(content()).not.toContain('+573000000002');
  });
  it('blur does not abort an in-flight GET but its old epoch cannot repopulate plaintext', async () => {
    const connection = deferred<Response>(), list = deferred<Response>();
    transport.mockImplementation(path => path.endsWith('/status') ? connection.promise : list.promise); await mount();
    const signal = reads()[0][1].signal!; await event(browser, 'blur'); expect(signal.aborted).toBe(false);
    await act(async () => { connection.resolve(response(status)); list.resolve(response(inbox)); });
    expect(content()).toContain('Recepción para atención humana'); expect(content()).toContain('Contacto vencido');
  });
  it('cleans timers/listeners and aborts requests on unmount, even when responses ignore abort', async () => {
    const removePage = vi.spyOn(page, 'removeEventListener'), removeWindow = vi.spyOn(browser, 'removeEventListener');
    await mount(); const patch = deferred<Response>(); transport.mockImplementationOnce(() => patch.promise); await click('Tomar conversación');
    const signal = writes()[0][1].signal!; const count = transport.mock.calls.length;
    await act(async () => renderer!.unmount()); renderer = undefined;
    expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    expect(removePage.mock.calls.map(([name]) => name)).toContain('visibilitychange');
    expect(removeWindow.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining(['focus', 'blur']));
    await act(async () => patch.resolve(response({ conversation: conversationFixture() })));
    await event(browser, 'focus'); expect(transport).toHaveBeenCalledTimes(count);
  });
  it('submits one PATCH with confirmed revision/new UUID and waits for confirmation without optimism', async () => {
    await mount(); const patch = deferred<Response>(); transport.mockImplementationOnce(() => patch.promise);
    const take = button('Tomar conversación').props.onClick; await act(async () => { take(); take(); });
    expect(writes()).toHaveLength(1); expect(body()).toEqual({ conversationId: 'a'.repeat(64), mode: 'human', expectedRevision: 7, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(content()).toContain('Necesita revisión · Revisión 7'); expect(content()).toContain('Guardando cambio…'); expect(content()).not.toContain('Cambio guardado');
    expect(button('Actualizar bandeja de SarinBot').props.disabled).toBe(true);
    expect(root().findAllByType('button').every(control => control.props.disabled)).toBe(true);
    expect(root().findAllByType('input').every(input => input.props.disabled)).toBe(true);
    await act(async () => patch.resolve(response({ conversation: conversationFixture({ mode: 'human', revision: 8 }) })));
    expect(content()).toContain('Atención humana · Revisión 8'); expect(content()).toContain('Cambio guardado. Se muestra el estado confirmado.');
    expect(reads()).toHaveLength(2);
    expect(root().findAllByProps({ role: 'status' }).some(node => text(node) === 'Cambio guardado. Se muestra el estado confirmado.')).toBe(true);
    transport.mockResolvedValueOnce(response({ conversation: conversationFixture({ mode: 'review', revision: 9 }) }));
    await click('Marcar para revisión'); expect(body(1).expectedRevision).toBe(8); expect(body(1).requestId).not.toBe(body().requestId);
  });
  it('invalidates an older GET at mutation start and permits focus reads during a pending PATCH', async () => {
    await mount(); const staleStatus = deferred<Response>(), staleList = deferred<Response>(), patch = deferred<Response>();
    transport.mockImplementation((path, init) => init.method === 'PATCH' ? patch.promise : path.endsWith('/status') ? staleStatus.promise : staleList.promise);
    await click('Actualizar bandeja de SarinBot'); const signal = reads()[2][1].signal!;
    await click('Tomar conversación'); expect(signal.aborted).toBe(true);
    await act(async () => { staleStatus.resolve(response(statusFixture({ connectionRevision: 99 }))); staleList.resolve(response(inboxFixture([]))); });
    expect(content()).toContain('Necesita revisión · Revisión 7'); expect(content()).not.toContain('Revisión 99');
    const count = reads().length; await event(browser, 'focus'); expect(reads()).toHaveLength(count + 2);
    await act(async () => patch.resolve(response({ conversation: conversationFixture({ mode: 'human', revision: 8 }) })));
    expect(content()).toContain('Atención humana · Revisión 8');
  });
  it('replaces only status and only existing conversations without insertion or reordering', async () => {
    inbox = inboxFixture([conversationFixture(), conversationFixture({ id: 'b'.repeat(64), customerPhone: 'second-synthetic-contact' })]);
    await mount(); transport.mockResolvedValueOnce(response(statusFixture({ connectionRevision: 5, presentationState: 'paused', pausedReason: 'manual' })));
    await click('Pausar recepción'); expect(body()).toMatchObject({ action: 'pause', expectedRevision: 4 });
    expect(root().findAllByType('article').map(article => text(article.findByType('h3')))).toEqual(['+573000000002', 'second-synthetic-contact']);
    transport.mockResolvedValueOnce(response({ conversation: conversationFixture({ id: 'c'.repeat(64), customerPhone: 'unknown-contact' }) }));
    await click('Tomar conversación'); expect(root().findAllByType('article')).toHaveLength(2); expect(content()).not.toContain('unknown-contact');
    expect(content()).toContain('Recepción pausada');
  });
  it('blocks after 409 through a failed refresh and only unlocks after both reads succeed', async () => {
    await mount(); transport.mockImplementation(async (_path, init) => response({ error: init.method === 'PATCH' ? 'Conflicto' : 'Refresh failed' }, init.method === 'PATCH' ? 409 : 503));
    await click('Tomar conversación'); expect(writes()).toHaveLength(1); expect(reads()).toHaveLength(4);
    expect(content()).toContain('Otra sesión cambió el estado. Se consulta la revisión actual antes de volver a intentar.');
    expect(button('Tomar conversación').props.disabled).toBe(true); expect(button('Actualizar bandeja de SarinBot').props.disabled).toBe(false);
    expect(root().findAllByType('input').every(input => input.props.disabled)).toBe(true);
    await act(async () => button('Tomar conversación').props.onClick()); expect(writes()).toHaveLength(1);
    const list = deferred<Response>(); transport.mockImplementation(path => path.endsWith('/status') ? Promise.resolve(response(statusFixture({ connectionRevision: 10 }))) : list.promise);
    await click('Actualizar bandeja de SarinBot'); expect(button('Tomar conversación').props.disabled).toBe(true);
    await act(async () => list.resolve(response(inboxFixture([conversationFixture({ revision: 22 })]))));
    expect(button('Tomar conversación').props.disabled).toBe(false);
    transport.mockResolvedValueOnce(response({ conversation: conversationFixture({ mode: 'human', revision: 23 }) }));
    await click('Tomar conversación'); expect(body(1).expectedRevision).toBe(22); expect(body(1).requestId).not.toBe(body().requestId);
  });
  it.each([400, 404, 503])('preserves confirmed state without retrying PATCH on %s', async code => {
    await mount(); transport.mockResolvedValueOnce(response({ error: 'Cambio rechazado' }, code)); await click('Tomar conversación');
    expect(content()).toContain('Cambio rechazado Se conserva el último estado confirmado; actualiza para comprobar cambios.');
    expect(content()).toContain('Necesita revisión · Revisión 7'); expect(button('Tomar conversación').props.disabled).toBe(false);
    expect(writes()).toHaveLength(1); expect(reads()).toHaveLength(2);
  });
  it('requires literal manual values, keeps them through success, and records connection without resuming', async () => {
    status = statusFixture({ presentationState: 'paused', pausedReason: 'manual' }); await mount();
    expect(root().findAllByType('input').map(input => input.props.value)).toEqual(['', '', '']);
    expect(button('Registrar conexión verificada').props.disabled).toBe(true);
    await fill(['111111 ', '+573000000001', '222222']); expect(button('Registrar conexión verificada').props.disabled).toBe(true);
    await act(async () => root().findByType('form').props.onSubmit({ preventDefault() {} })); expect(writes()).toHaveLength(0);
    await fill(['111111', '+573000000001', '222222']); expect(button('Registrar conexión verificada').props.disabled).toBe(false);
    transport.mockResolvedValueOnce(response({ ...status, connectionRevision: 5 }));
    await act(async () => root().findByType('form').props.onSubmit({ preventDefault() {} }));
    expect(body()).toEqual({ action: 'record_connected', expectedRevision: 4, wabaId: '111111', phoneE164: '+573000000001', phoneNumberId: '222222', requestId: expect.any(String) });
    expect(root().findAllByType('input').map(input => input.props.value)).toEqual(['111111', '+573000000001', '222222']);
    expect(content()).toContain('Recepción pausada'); expect(writes()).toHaveLength(1);
  });
  it.each([
    ['Reanudar recepción', 'resume', { pausedReason: 'manual', receiveEnabled: false }],
    ['Registrar desconexión', 'disconnect', {}],
  ] as [string, string, Partial<PlatformWhatsAppStatus>][])('sends %s as a local status command using the connection revision', async (label, action, overrides) => {
    status = statusFixture(overrides); await mount();
    transport.mockResolvedValueOnce(response(statusFixture({ ...overrides, connectionRevision: 5 })));
    await click(label);
    expect(writes()[0][0]).toBe('/api/admin/platform-whatsapp/status');
    expect(body()).toEqual({ action, expectedRevision: 4, requestId: expect.any(String) });
    expect(reads()).toHaveLength(2); expect(content()).toContain('Necesita revisión · Revisión 7');
  });
  it.each([
    [{ configured: false }, false, true, false],
    [{ scope: null }, true, true, true],
    [{ presentationState: 'paused', pausedReason: 'manual', receiveEnabled: false }, true, false, false],
    [{ providerConnection: 'disconnected', pausedReason: 'disconnected' }, true, true, true],
    [{ providerConnection: 'unverified', pausedReason: 'manual' }, false, true, false],
    [{ pausedReason: null }, false, true, false],
  ] as [Partial<PlatformWhatsAppStatus>, boolean, boolean, boolean][])('preserves exact connection disabled predicates for %j', async (overrides, pause, resume, disconnect) => {
    status = statusFixture(overrides); await mount();
    expect(button('Pausar recepción').props.disabled).toBe(pause); expect(button('Reanudar recepción').props.disabled).toBe(resume); expect(button('Registrar desconexión').props.disabled).toBe(disconnect);
    if (status.scope) { await fill(['111111', '+573000000001', '222222']); expect(button('Registrar conexión verificada').props.disabled).toBe(!status.configured); }
    else expect(root().findAllByType('form')).toHaveLength(0);
  });
  it.each([
    ['not_configured', 'Sin configurar'], ['configured_unverified', 'Sin verificar'], ['receiving_human', 'Recepción para atención humana'],
    ['automation_blocked', 'Recepción no disponible'], ['paused', 'Recepción pausada'], ['disconnected', 'Desconexión registrada'],
  ] as const)('presents %s with its frozen title', async (presentationState, title) => {
    status = statusFixture({ presentationState }); await mount(); expect(content()).toContain(title);
    expect(content()).toContain('IA deshabilitada · Envío deshabilitado. Una bandeja vacía no confirma la conexión.');
  });
  it('preserves semantic names, controlled labels, dates, focus targets and responsive wrapping without exposing contacts in aria', async () => {
    const date = vi.spyOn(Date.prototype, 'toLocaleString'); await mount();
    expect(root().findByType('section').props['aria-labelledby']).toBe('platform-whatsapp-title');
    expect(root().findByType('h2').props.id).toBe('platform-whatsapp-title');
    expect(root().findByType('article').props['aria-label']).toBe('Consulta de SarinBot');
    expect(root().findAllByType('ul')).toHaveLength(1); expect(root().findAllByType('li')).toHaveLength(1);
    expect(root().findAllByType('dt').map(text)).toEqual(['Última recepción firmada', 'Última respuesta del titular registrada', 'Verificación manual registrada', 'Estado consultado']);
    expect(date).toHaveBeenCalledWith('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
    expect(content()).toContain('Sin registro · Colombia');
    expect(root().findAllByType('label').map(text)).toEqual(['ID de WABAConfigurado: 111111', 'Teléfono internacionalConfigurado: +573000000001', 'ID del númeroConfigurado: 222222']);
    for (const input of root().findAllByType('input')) { expect(input.props.autoComplete).toBe('off'); expect(input.props.type).toBeUndefined(); expect(input.props.pattern).toBeUndefined(); expect(input.props.required).toBeUndefined(); expect(input.props.className).toContain('focus:ring-2'); }
    for (const control of root().findAllByType('button')) { expect(control.props.className).toContain('min-h-11'); expect(control.props.type).toBe(text(control) === 'Registrar conexión verificada' ? 'submit' : 'button'); }
    expect(button('Actualizar bandeja de SarinBot').props.className).toContain('focus-visible:outline-2');
    expect(root().findByType('article').findByType('h3').props.className).toContain('break-all');
    expect(root().findAllByType('p').find(node => text(node).includes('Consulta sintética'))!.props.className).toContain('whitespace-pre-wrap break-words');
    expect(root().findAll(node => typeof node.props.className === 'string' && node.props.className.includes('flex flex-col gap-2 sm:flex-row sm:flex-wrap')).length).toBeGreaterThan(0);
    expect(root().findAllByType('a')).toHaveLength(0); expect(root().findAllByType('select')).toHaveLength(0);
    expect(content()).toContain('Las conversaciones de negocios y sus controles comerciales están en la sección siguiente. Aquí no se envían mensajes ni se activa un bot.');
  });
  it('shows nullable and unavailable content without confusing either with an empty inbox', async () => {
    inbox = inboxFixture([conversationFixture({ customerPhone: null, lastMessage: null }), conversationFixture({ id: 'b'.repeat(64), contentAvailable: false })]); await mount();
    expect(content()).toContain('Contacto no disponible'); expect(content()).toContain('Sin texto disponible.');
    expect(content()).toContain('Contacto vencido'); expect(content()).toContain('Contenido vencido o no disponible. El texto y el contacto se conservan como máximo 24 horas.');
    expect(content()).not.toContain('Sin consultas de SarinBot');
  });
});
