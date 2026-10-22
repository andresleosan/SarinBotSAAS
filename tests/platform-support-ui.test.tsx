import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HelpPage from '@/app/ayuda/page';
import { PlatformSupportChat, emptySupportMessages, mergeSupportPage, expireSupportMessages, mergeSupportList } from '@/components/platform-support-chat';
import { LEGAL_VERSION, PLATFORM_SUPPORT_LEGAL_VERSION } from '@/lib/legal';
import type { SupportPage } from '@/types/platform-support';

const fixture = vi.hoisted(() => ({ auth: {} as any, account: {} as any, support: {} as any, firebase: { currentUser: null as any } }));
vi.mock('@/components/auth-provider', () => ({ useAuth: () => fixture.auth }));
vi.mock('@/components/consent-panel', () => ({ useAccountConsent: () => fixture.account, ConsentPanel: () => null }));
vi.mock('@/hooks/useConsent', () => ({ useConsent: () => fixture.support }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: fixture.firebase }) }));
vi.mock('@/components/platform-whatsapp-link', () => ({ PlatformWhatsAppLink: () => null }));
vi.mock('@/components/sarin-brand', () => ({ SarinBrand: () => null }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const now = 1_800_000_000_000;
const id = (n: number) => n.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000';
const message = (sequence = 1, text: string | null = 'contenido privado sintético', ttl = 60_000) => ({ id: 'message-' + sequence, sequence, author: 'customer' as const, text, createdAt: now - 1000, expiresAt: now + ttl });
const page = (messages = [message()], cursor: string | null = 'follow', hasMore = false): SupportPage => ({ messages, cursor, hasMore, observedAt: Date.now(), revision: 1, notificationStates: messages.map(item => ({ messageId: item.id, state: 'blocked' })) });
const conversation = (n: number) => ({ id: id(n), revision: 1, lastSequence: 0, createdAt: now - 1000, expiresAt: now + 100_000 });
const consent = (scope: 'account' | 'platform_support', uid = 'alice') => {
  const documents = { scope, fingerprint: 'a'.repeat(64), version: scope === 'account' ? LEGAL_VERSION : PLATFORM_SUPPORT_LEGAL_VERSION };
  return { active: true, loading: false, error: null, withdrawalRequested: false, status: { active: true, revision: 1, documents, receipt: { uid, scope, action: 'accept', termsAccepted: true, dataAuthorized: true, revision: 1, requestId: id(99), occurredAt: now - 5000, documents } } };
};
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
let trees: ReactTestRenderer[], documentEvents: EventTarget & { visibilityState: string }, windowEvents: EventTarget;
let requests: Array<{ path: string; init: RequestInit }>, handler: (path: string, init: RequestInit) => unknown | Promise<unknown>;
const focus = vi.fn(), scroll = vi.fn();
const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => data });
async function settle() {
  for (let n = 0; n < 30; n++) await Promise.resolve();
  // WebCrypto runs outside the microtask queue and can outlast setImmediate in CI.
  if (vi.isMockFunction(crypto.subtle.digest)) {
    await Promise.all(vi.mocked(crypto.subtle.digest).mock.results.filter(result => result.type === 'return').map(result => result.value));
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  for (let n = 0; n < 30; n++) await Promise.resolve();
}
async function mount(props: { admin?: boolean; initialThread?: string | null } = {}, strict = false) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(strict ? <React.StrictMode><PlatformSupportChat {...props} /></React.StrictMode> : <PlatformSupportChat {...props} />, { createNodeMock: () => ({ focus, scrollIntoView: scroll }) }); await settle(); });
  trees.push(tree); return tree;
}
const output = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const buttons = (tree: ReactTestRenderer) => tree.root.findAllByType('button');
const named = (tree: ReactTestRenderer, name: string) => buttons(tree).find(item => item.children.join('') === name)!;
async function click(tree: ReactTestRenderer, name: string) { await act(async () => { const node = named(tree, name); expect(node).toBeDefined(); expect(node.props.disabled).not.toBe(true); node.props.onClick(); await settle(); }); }
async function draft(tree: ReactTestRenderer, text: string) { await act(async () => { tree.root.findByType('textarea').props.onChange({ target: { value: text } }); }); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); await settle(); }); }

beforeEach(() => {
  vi.spyOn(crypto.subtle, 'digest');
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] }); vi.setSystemTime(now);
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' }); windowEvents = new EventTarget();
  vi.stubGlobal('document', documentEvents); vi.stubGlobal('window', windowEvents);
  fixture.firebase.currentUser = { uid: 'alice', getIdToken: async () => 'synthetic-token' };
  fixture.auth = { user: fixture.firebase.currentUser, loading: false, signingOut: false, authEpoch: 1, isSuperadmin: false, isCurrentSession: (uid: string, epoch: number) => uid === fixture.firebase.currentUser?.uid && epoch === fixture.auth.authEpoch };
  fixture.account = consent('account'); fixture.support = consent('platform_support');
  trees = []; requests = []; focus.mockReset(); scroll.mockClear();
  handler = path => path.endsWith('/messages') || path.includes('/messages?') ? response(page()) : path.endsWith('/notifications') ? response({ configured: false, revision: 0, expiresAt: null }) : path.endsWith('/link') ? response({ available: true, current: { linkId: id(7), revision: 1, expiresAt: now + 60_000, maskedPhone: '••••1234' }, pending: null, revokeGeneration: id(8) }) : response({ conversations: [conversation(1)], cursor: null, hasMore: false, observedAt: Date.now() });
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => { requests.push({ path, init }); return handler(path, init); });
});
afterEach(async () => { await act(async () => { trees.forEach(tree => tree.unmount()); await settle(); }); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('private support entry and page merging', () => {
  it('offers private support from help', async () => {
    let tree!: ReactTestRenderer; await act(async () => { tree = create(<HelpPage />); }); trees.push(tree);
    expect(tree.root.findAllByType('a').some(node => node.props.href === '/soporte')).toBe(true);
  });
  it('deduplicates repeated pages, orders sequences and retains null expired stubs', () => {
    const first = mergeSupportPage(emptySupportMessages(), page([message(2), message(1, null)]), 0);
    const next = mergeSupportPage(first, page([message(2), message(1)]), 500);
    expect(next.items.map(item => item.sequence)).toEqual([1, 2]); expect(next.items[0].text).toBeNull();
  });
  it('rejects duplicate IDs in a page and conflicting sequences or text across pages', () => {
    expect(() => mergeSupportPage(emptySupportMessages(), page([message(), message()]), 0)).toThrow();
    const first = mergeSupportPage(emptySupportMessages(), page(), 0);
    expect(() => mergeSupportPage(first, page([{ ...message(), id: 'other' }]), 0)).toThrow();
    expect(() => mergeSupportPage(first, page([message(1, 'changed')]), 0)).toThrow();
  });
  it('expires exactly at the read-start monotonic deadline despite backward wall clock and repeated pages', async () => {
    const first = mergeSupportPage(emptySupportMessages(), page([message(1, 'private', 1000)]), 0);
    await vi.advanceTimersByTimeAsync(500); vi.setSystemTime(now - 100_000);
    const repeated = mergeSupportPage(first, { ...page([message(1, 'private', 1000)]), observedAt: now }, 500);
    expect(repeated.items[0].deadline).toBe(1000);
    await vi.advanceTimersByTimeAsync(500); expect(expireSupportMessages(repeated).items[0].text).toBeNull();
  });
  it('expires by wall clock at equality even when monotonic time has not advanced', () => {
    const first = mergeSupportPage(emptySupportMessages(), page([message(1, 'private', 1000)]), 0);
    vi.setSystemTime(now + 1000); expect(expireSupportMessages(first).items[0].text).toBeNull();
  });
  it('does not renew metadata TTL on a repeated list page', () => {
    const first = mergeSupportList({ items: [], cursor: null, catchingUp: false }, { conversations: [conversation(1)], cursor: 'list', hasMore: true, observedAt: now }, 0);
    const next = mergeSupportList(first, { conversations: [conversation(1)], cursor: null, hasMore: false, observedAt: now }, 1000);
    expect(next.items[0].deadline).toBe(100_000); expect(next.cursor).toBeNull();
  });
});

describe('authenticated incremental support UI', () => {
  it('waits for the real message digest before asserting an explicit send', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
      await delay(25);
      return nativeDigest(...args);
    });
    const original = handler;
    handler = (path, init) => init.method === 'POST' ? response({ id: 'sent', sequence: 2, revision: 2 }) : original(path, init);
    const tree = await mount({ initialThread: id(1) });
    await draft(tree, 'synthetic delayed digest');
    await click(tree, 'Enviar mensaje');
    expect(requests.filter(item => item.init.method === 'POST')).toHaveLength(1);
    expect(output(tree)).toContain('Mensaje confirmado en la web');
  });
  it('refreshes existing notification facts without another message or visibility reset', async () => {
    let state: SupportPage['notificationStates'][number]['state'] = 'pending';
    handler = path => path.includes('/messages') ? response(path.includes('?cursor=') ? page([], 'follow') : { ...page(), notificationStates: [{ messageId: 'message-1', state }] }) : response({ conversations: [], cursor: null, hasMore: false, observedAt: Date.now() });
    const tree = await mount({ initialThread: id(1) });
    expect(output(tree)).toContain('Pendiente');
    for (const [next, label] of [['accepted', 'Aceptado por el proveedor'], ['delivered', 'Entregado'], ['cancelled', 'Cancelado']] as const) {
      state = next; await advance(5000); expect(output(tree)).toContain(label);
      expect(tree.root.findByProps({ 'aria-label': 'Mensajes consultados' }).findAllByType('li')).toHaveLength(1);
    }
  });
  it('keeps reads, explicit sends and own recipient configuration usable after StrictMode replay', async () => {
    fixture.auth.isSuperadmin = true; const original = handler;
    handler = (path, init) => init.method === 'POST' ? response({ id: 'sent', sequence: 2, revision: 2 }) : init.method === 'PATCH' ? response({ revision: 1 }) : original(path, init);
    const tree = await mount({ admin: true, initialThread: id(1) }, true);
    expect(output(tree)).toContain('contenido privado sintético');
    await draft(tree, 'strict send'); await click(tree, 'Enviar mensaje');
    expect(output(tree)).toContain('Mensaje confirmado en la web');
    await act(async () => tree.root.findByType('input').props.onChange({ target: { checked: true } }));
    await click(tree, 'Guardar mi vinculación como destinatario');
    expect(output(tree)).toContain('Destinatario guardado');
  });
  it('focuses the confirmed composer only after its enabled commit', async () => {
    const pending = deferred<unknown>(), original = handler;
    handler = (path, init) => init.method === 'POST' ? pending.promise : original(path, init);
    const tree = await mount({ initialThread: id(1) }); const enabledFocus = vi.fn();
    focus.mockImplementation(() => { if (!tree.root.findByType('textarea').props.disabled) enabledFocus(); });
    await draft(tree, 'focus after confirmed'); await click(tree, 'Enviar mensaje');
    expect(tree.root.findByType('textarea').props.disabled).toBe(true);
    await act(async () => { pending.resolve(response({ id: 'sent', sequence: 2, revision: 2 })); await settle(); });
    expect(enabledFocus).toHaveBeenCalledTimes(1);
    await advance(5000); expect(enabledFocus).toHaveBeenCalledTimes(1);
  });
  it('does not revive token requests owned by the first StrictMode effect setup', async () => {
    const token = deferred<string>(); let tokens = 0;
    fixture.auth.isSuperadmin = true;
    fixture.firebase.currentUser.getIdToken = () => ++tokens <= 3 ? token.promise : Promise.resolve('current-synthetic-token');
    const tree = await mount({ admin: true, initialThread: id(1) }, true);
    expect(output(tree)).toContain('contenido privado sintético'); expect(tokens).toBeGreaterThan(3);
    const before = requests.length;
    await act(async () => { token.resolve('stale-synthetic-token'); await settle(); });
    expect(requests).toHaveLength(before); expect(output(tree)).toContain('contenido privado sintético');
  });
  it.each(['token', 'response', 'json'])('ignores an older StrictMode session after delayed %s completion', async stage => {
    fixture.auth.isSuperadmin = true;
    const tree = await mount({ admin: true, initialThread: id(1) }, true);
    const pending = deferred<any>(), original = handler;
    if (stage === 'token') fixture.firebase.currentUser.getIdToken = () => pending.promise;
    else handler = () => stage === 'response' ? pending.promise : { ...response(null), json: () => pending.promise };
    await advance(5000);
    fixture.auth.authEpoch++; fixture.firebase.currentUser.getIdToken = async () => 'new-synthetic-token'; handler = original;
    await act(async () => { tree.update(<React.StrictMode><PlatformSupportChat admin initialThread={id(1)} /></React.StrictMode>); await settle(); });
    expect(output(tree)).toContain('contenido privado sintético'); const before = requests.length;
    await act(async () => { pending.resolve(stage === 'token' ? 'late-token' : stage === 'response' ? response(page([message(1, 'stale-body')])) : page([message(1, 'stale-body')])); await settle(); });
    expect(output(tree)).not.toContain('stale-body'); expect(output(tree)).toContain('contenido privado sintético');
    expect(requests).toHaveLength(before);
  });
  it.each(['message', 'recipient'])('suppresses an old %s write and finally while the current StrictMode session is busy', async kind => {
    fixture.auth.isSuperadmin = true;
    const oldWrite = deferred<unknown>(), newWrite = deferred<unknown>(), original = handler; let writes = 0;
    handler = (path, init) => init.method === (kind === 'message' ? 'POST' : 'PATCH') ? (++writes === 1 ? oldWrite.promise : newWrite.promise) : original(path, init);
    const tree = await mount({ admin: true, initialThread: id(1) }, true);
    const send = async () => {
      if (kind === 'message') { await draft(tree, 'current draft'); await click(tree, 'Enviar mensaje'); }
      else { await act(async () => tree.root.findByType('input').props.onChange({ target: { checked: true } })); await click(tree, 'Guardar mi vinculación como destinatario'); }
    };
    await send(); fixture.auth.authEpoch++;
    await act(async () => { tree.update(<React.StrictMode><PlatformSupportChat admin initialThread={id(1)} /></React.StrictMode>); await settle(); });
    await send(); expect(writes).toBe(2);
    await act(async () => { oldWrite.resolve(response(kind === 'message' ? { id: 'old', sequence: 2, revision: 2 } : { revision: 1 })); await settle(); });
    expect(output(tree)).not.toContain(kind === 'message' ? 'Mensaje confirmado' : 'Destinatario guardado'); expect(focus).not.toHaveBeenCalled();
    if (kind === 'message') { expect(tree.root.findByType('textarea').props.disabled).toBe(true); expect(tree.root.findByType('textarea').props.value).toBe('current draft'); }
    else expect(named(tree, 'Reintentar la misma selección').props.disabled).toBe(true);
    await act(async () => { newWrite.resolve(response(kind === 'message' ? { id: 'new', sequence: 2, revision: 2 } : { revision: 1 })); await settle(); });
    expect(output(tree)).toContain(kind === 'message' ? 'Mensaje confirmado' : 'Destinatario guardado');
    expect(focus).toHaveBeenCalledTimes(kind === 'message' ? 1 : 0);
  });
  it('refreshes facts without extending the original plaintext deadline or resurrecting expired stubs', async () => {
    let state: SupportPage['notificationStates'][number]['state'] = 'pending';
    handler = path => path.includes('/messages') ? response(path.includes('?cursor=') ? page([], 'follow') : { ...page([message(1, 'refresh ttl secret', 6000)]), observedAt: now, notificationStates: [{ messageId: 'message-1', state }] }) : response({ conversations: [], cursor: null, hasMore: false, observedAt: Date.now() });
    const tree = await mount({ initialThread: id(1) }); state = 'accepted'; await advance(5000);
    expect(output(tree)).toContain('refresh ttl secret'); expect(output(tree)).toContain('Aceptado por el proveedor');
    vi.setSystemTime(now - 100_000); await advance(1000); expect(output(tree)).not.toContain('refresh ttl secret');
    state = 'delivered'; await advance(4000); expect(output(tree)).toContain('Entregado'); expect(output(tree)).not.toContain('refresh ttl secret');
  });
  it('reads selected messages without writes, separates WhatsApp state and preserves Enter newline', async () => {
    const tree = await mount({ initialThread: id(1) });
    expect(output(tree)).toContain('contenido privado sintético'); expect(output(tree)).toContain('Bloqueado:');
    expect(requests.every(request => !request.init.method)).toBe(true);
    await draft(tree, 'primera\nsegunda'); expect(tree.root.findByType('textarea').props.value).toBe('primera\nsegunda');
    expect(tree.root.findByType('textarea').props.onKeyDown).toBeUndefined();
    expect(tree.root.findAllByProps({ 'aria-live': 'polite' }).map(node => node.children.join('')).join('')).not.toContain('contenido privado');
    await click(tree, 'Ir a los mensajes nuevos'); expect(focus).toHaveBeenCalled(); expect(scroll).toHaveBeenCalled();
  });
  it.each(['uid', 'epoch', 'role', 'permission', 'receipt', 'unknown'])('masks old private content after %s changes before effects publish', async change => {
    fixture.auth.isSuperadmin = true;
    const tree = await mount({ admin: true, initialThread: id(1) });
    expect(output(tree)).toContain('contenido privado');
    if (change === 'uid') { fixture.auth.user = { uid: 'bob' }; fixture.firebase.currentUser = fixture.auth.user; }
    if (change === 'epoch') fixture.auth.authEpoch++;
    if (change === 'role') fixture.auth.isSuperadmin = false;
    if (change === 'permission') fixture.support.active = false;
    if (change === 'receipt') fixture.support.status.receipt = { ...fixture.support.status.receipt, uid: 'bob' };
    if (change === 'unknown') fixture.support.loading = true;
    handler = () => new Promise(() => {});
    await act(async () => { tree.update(<PlatformSupportChat admin initialThread={id(1)} />); await settle(); });
    expect(output(tree)).not.toContain('contenido privado'); expect(output(tree)).not.toContain('primera');
  });
  it.each(['token', 'response', 'json'])('guards the current identity after awaiting %s', async stage => {
    const pending = deferred<any>();
    if (stage === 'token') fixture.firebase.currentUser.getIdToken = () => pending.promise;
    else handler = () => stage === 'response' ? pending.promise : { ...response(null), json: () => pending.promise };
    const tree = await mount({ initialThread: id(1) });
    fixture.firebase.currentUser = { uid: 'bob', getIdToken: async () => 'other' };
    await act(async () => { pending.resolve(stage === 'token' ? 'late-token' : stage === 'response' ? response(page()) : page()); await settle(); });
    expect(output(tree)).not.toContain('contenido privado');
    if (stage === 'token') expect(requests).toHaveLength(0);
  });
  it('clears drafts and bodies on blur/hidden and reads fresh on focus', async () => {
    const tree = await mount({ initialThread: id(1) }); await draft(tree, 'draft synthetic');
    await act(async () => { windowEvents.dispatchEvent(new Event('blur')); });
    expect(output(tree)).not.toContain('contenido privado'); expect(output(tree)).not.toContain('draft synthetic');
    const before = requests.length; await advance(10_000); expect(requests).toHaveLength(before);
    await act(async () => { windowEvents.dispatchEvent(new Event('focus')); await settle(); });
    expect(output(tree)).toContain('contenido privado'); expect(tree.root.findByType('textarea').props.value).toBe('');
    await act(async () => { documentEvents.visibilityState = 'hidden'; documentEvents.dispatchEvent(new Event('visibilitychange')); });
    expect(output(tree)).not.toContain('contenido privado');
  });
  it('clears content and draft on a read error without exposing the server error text', async () => {
    const tree = await mount({ initialThread: id(1) }); await draft(tree, 'draft synthetic');
    handler = () => response({ error: 'private server detail' }, 503); await advance(5_000);
    expect(output(tree)).not.toContain('contenido privado'); expect(output(tree)).not.toContain('draft synthetic'); expect(output(tree)).not.toContain('private server detail');
  });
  it('erases rendered plaintext at TTL equality while polling is offline', async () => {
    handler = path => path.includes('/messages') ? response(page([message(1, 'secret ttl', 1000)])) : response({ conversations: [], cursor: null, hasMore: false, observedAt: now });
    const tree = await mount({ initialThread: id(1) }); expect(output(tree)).toContain('secret ttl');
    handler = () => new Promise(() => {}); await advance(1000);
    expect(output(tree)).not.toContain('secret ttl'); expect(output(tree)).toContain('Texto vencido');
  });
  it('reserves one incremental page and two refresh pages with independent progress beyond 300 rows', async () => {
    const cursors: number[] = []; let delivered = false;
    handler = path => {
      if (!path.includes('/messages')) return response({ conversations: [], cursor: null, hasMore: false, observedAt: now });
      const start = Number(new URL(path, 'https://synthetic.invalid').searchParams.get('cursor') ?? 0); cursors.push(start);
      const messages = Array.from({ length: Math.min(100, 400 - start) }, (_, n) => message(start + n + 1));
      return response({ ...page(messages, String(start + messages.length), start + messages.length < 400), notificationStates: messages.map(item => ({ messageId: item.id, state: delivered ? 'delivered' : 'pending' })) });
    };
    const tree = await mount({ initialThread: id(1) }); expect(cursors).toEqual([0, 0, 100]); expect(output(tree)).toContain('Poniendo los mensajes');
    await advance(5000); expect(cursors.slice(3)).toEqual([100, 200, 300]);
    expect(tree.root.findByProps({ 'aria-label': 'Mensajes consultados' }).findAllByType('li')).toHaveLength(400);
    expect(output(tree)).toContain('Poniendo los mensajes'); // A terminal refresh cannot advance the incremental cursor.
    delivered = true; await advance(5000); expect(cursors.slice(6)).toEqual([200, 0, 100]);
    await advance(5000); expect(cursors.slice(9)).toEqual([300, 200, 300]);
    expect(output(tree)).not.toContain('Poniendo los mensajes');
    expect(tree.root.findByProps({ 'aria-label': 'Mensajes consultados' }).findAllByType('li').every(item => JSON.stringify(item.children.map(child => typeof child === 'string' ? child : child.props.children)).includes('Entregado'))).toBe(true);
  });
  it('retains a finite list cursor across cycles, restarts only at terminal and discovers lower/higher IDs next sweep', async () => {
    let reads = 0;
    handler = path => {
      const n = reads++; const start = n < 4 ? n * 100 + 1 : 0;
      return response({ conversations: Array.from({ length: n === 3 ? 1 : n > 3 ? 2 : 100 }, (_, offset) => conversation(n > 3 && offset === 1 ? 999 : start + offset)), cursor: n < 3 ? 'sweep' + (n + 1) : null, hasMore: n < 3, observedAt: Date.now() });
    };
    const tree = await mount(); expect(reads).toBe(3); expect(output(tree)).toContain('cobertura parcial');
    await advance(5000); expect(reads).toBe(4); expect(requests[3].path).toContain('cursor=sweep3');
    await advance(5000); expect(reads).toBe(5); expect(requests[4].path).not.toContain('cursor=');
    expect(output(tree)).toContain(id(0)); expect(output(tree)).toContain(id(999));
  });
  it('rejects repeated cursors instead of looping or claiming complete coverage', async () => {
    handler = () => response({ conversations: [conversation(1)], cursor: 'repeat', hasMore: true, observedAt: now });
    const tree = await mount(); expect(requests).toHaveLength(2); expect(output(tree)).toContain('No se pudo comprobar el soporte');
  });
  it('sends only explicitly, confirms web status, restores composer focus and reads notification separately', async () => {
    const original = handler;
    handler = (path, init) => init.method === 'POST' ? response({ id: 'new-message', sequence: 2, revision: 2 }) : original(path, init);
    const tree = await mount({ initialThread: id(1) }); await draft(tree, 'mensaje explícito'); await click(tree, 'Enviar mensaje');
    const writes = requests.filter(item => item.init.method === 'POST'); expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0].init.body as string)).toMatchObject({ expectedRevision: 1, text: 'mensaje explícito' });
    expect(output(tree)).toContain('Mensaje confirmado en la web'); expect(output(tree)).not.toContain('Aviso de WhatsApp: Entregado'); expect(focus).toHaveBeenCalled();
  });
  it('retains an uncertain request ID, clears plaintext and never automatically resends', async () => {
    const original = handler; let writes = 0;
    handler = (path, init) => init.method === 'POST' ? (++writes === 1 ? Promise.reject(new Error('offline')) : response({ id: 'sent', sequence: 2, revision: 2 })) : original(path, init);
    const tree = await mount({ initialThread: id(1) }); await draft(tree, 'same message'); await click(tree, 'Enviar mensaje');
    expect(tree.root.findByType('textarea').props.value).toBe(''); expect(output(tree)).toContain('Resultado incierto');
    await advance(5000); expect(writes).toBe(1);
    await draft(tree, 'different'); await click(tree, 'Reintentar el mismo mensaje'); expect(writes).toBe(1);
    await draft(tree, 'same message'); await click(tree, 'Reintentar el mismo mensaje'); expect(writes).toBe(2);
    const bodies = requests.filter(item => item.init.method === 'POST').map(item => JSON.parse(item.init.body as string)); expect(bodies[1]).toEqual(bodies[0]);
  });
  it('requires fresh revision review after 409 before a new explicit request', async () => {
    const original = handler; let writes = 0, revision = 1;
    handler = (path, init) => {
      if (init.method === 'POST') { writes++; revision = 2; return writes === 1 ? response({ error: 'conflict' }, 409) : response({ id: 'sent', sequence: 2, revision: 3 }); }
      if (path.includes('/messages')) return response({ ...page(), revision });
      return original(path, init);
    };
    const tree = await mount({ initialThread: id(1) }); await draft(tree, 'first'); await click(tree, 'Enviar mensaje');
    expect(writes).toBe(1); expect(tree.root.findByType('textarea').props.disabled).toBe(true);
    await click(tree, 'He revisado la lectura actual'); await draft(tree, 'revised'); await click(tree, 'Enviar mensaje');
    const bodies = requests.filter(item => item.init.method === 'POST').map(item => JSON.parse(item.init.body as string)); expect(bodies[1].requestId).not.toBe(bodies[0].requestId); expect(bodies[1].expectedRevision).toBe(2);
  });
  it('does not restore late mutation status or drafts after visibility loss', async () => {
    const pending = deferred<unknown>(), original = handler;
    handler = (path, init) => init.method === 'POST' ? pending.promise : original(path, init);
    const tree = await mount({ initialThread: id(1) }); await draft(tree, 'private send'); await click(tree, 'Enviar mensaje');
    await act(async () => { windowEvents.dispatchEvent(new Event('blur')); pending.resolve(response({ id: 'sent', sequence: 2, revision: 2 })); await settle(); });
    expect(output(tree)).not.toContain('Mensaje confirmado'); expect(output(tree)).not.toContain('private send');
  });
  it('configures only the current admin own-link selector and never writes on mount or selection', async () => {
    fixture.auth.isSuperadmin = true; const original = handler;
    handler = (path, init) => init.method === 'PATCH' ? response({ revision: 1 }) : original(path, init);
    const tree = await mount({ admin: true }); expect(requests.every(item => !item.init.method)).toBe(true);
    await act(async () => tree.root.findByType('input').props.onChange({ target: { checked: true } })); expect(requests.every(item => !item.init.method)).toBe(true);
    await click(tree, 'Guardar mi vinculación como destinatario');
    const body = JSON.parse(requests.find(item => item.init.method === 'PATCH')!.init.body as string);
    expect(body).toEqual({ linkId: id(7), expectedRevision: 0, requestId: expect.any(String) }); expect(output(tree)).toContain('Solo los nuevos mensajes');
  });
  it('ignores noncanonical deep links and does not grant admin rights from a link', async () => {
    await mount({ initialThread: '../private?body=x' }); expect(requests.some(item => item.path.includes('/messages'))).toBe(false);
    await mount({ admin: true, initialThread: id(1) }); expect(requests.some(item => item.path.includes('/api/admin/'))).toBe(false);
  });
});


it('rejects a repeated cursor across separate bounded list cycles', async () => {
  let reads = 0;
  handler = () => { const n = reads++; return response({ conversations: [conversation(n + 1)], cursor: ['a', 'b', 'c', 'a'][n], hasMore: true, observedAt: now }); };
  const tree = await mount(); expect(reads).toBe(3);
  await advance(5000); expect(reads).toBe(4); expect(output(tree)).toContain('No se pudo comprobar el soporte');
});

it('rejects a repeated message cursor across separate bounded cycles', async () => {
  let reads = 0;
  handler = path => {
    if (!path.includes('/messages')) return response({ conversations: [], cursor: null, hasMore: false, observedAt: now });
    reads++; const cursor = new URL(path, 'https://synthetic.invalid').searchParams.get('cursor');
    return response(page([message()], cursor === 'a' ? 'b' : cursor === 'b' ? 'c' : 'a', true));
  };
  const tree = await mount({ initialThread: id(1) }); expect(reads).toBe(3);
  await advance(5000); expect(reads).toBe(6); expect(output(tree)).toContain('No se pudo comprobar el soporte');
});

it('keeps the five-second read schedule when a local message expiry erases plaintext', async () => {
  let reads = 0;
  handler = path => path.includes('/messages') ? (reads++, response(page([message(1, reads === 1 ? 'expires first' : null, 1000)]))) : response({ conversations: [], cursor: null, hasMore: false, observedAt: now });
  await mount({ initialThread: id(1) });
  await advance(5000); expect(reads).toBe(4);
});

it('erases expired list metadata and cannot resurrect it when the wall clock moves back', async () => {
  const first = mergeSupportList({ items: [], cursor: null, catchingUp: false }, { conversations: [conversation(1)], cursor: null, hasMore: false, observedAt: now }, 0);
  await vi.advanceTimersByTimeAsync(100_000);
  const expired = mergeSupportList(first, { conversations: [], cursor: null, hasMore: false, observedAt: Date.now() }, 100_000);
  expect(expired.items).toHaveLength(0);
  vi.setSystemTime(now - 100_000);
  const repeated = mergeSupportList(expired, { conversations: [conversation(1)], cursor: null, hasMore: false, observedAt: now }, 100_000);
  expect(repeated.items).toHaveLength(0);
});
