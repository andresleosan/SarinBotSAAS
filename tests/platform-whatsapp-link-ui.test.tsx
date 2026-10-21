import type { User } from 'firebase/auth';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reauthenticateWithPopup } from 'firebase/auth';
import { safeWhatsAppLinkDestination } from '@/hooks/usePlatformWhatsAppLink';
import { createLinkHarness, deferred, ids, response, syntheticCommand, text } from './platform-whatsapp-link-ui-fixtures';
const firebase = vi.hoisted(() => ({ user: null as User | null, listener: null as ((user: User | null) => Promise<void>) | null }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: firebase.user } }) }));
vi.mock('firebase/auth', () => ({ GoogleAuthProvider: class {}, onIdTokenChanged: vi.fn((_auth, listener) => { firebase.listener = listener; return vi.fn(); }), signInWithPopup: vi.fn(), signInWithCredential: vi.fn(), signOut: vi.fn(), reauthenticateWithPopup: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let h: ReturnType<typeof createLinkHarness>;
beforeEach(() => { firebase.user = null; firebase.listener = null; h = createLinkHarness(firebase); vi.mocked(reauthenticateWithPopup).mockReset().mockImplementation(async () => ({ user: h.user } as never)); });
afterEach(async () => h.unmount());
const recent = () => response({ error: 'Fresh authentication required', code: 'LINK_RECENT_AUTH_REQUIRED' }, 428);
const uncertain = () => response({ error: 'Uncertain', code: 'LINK_UNAVAILABLE' }, 503, { 'Retry-After': '2' });
const pending = () => { h.data.status = { ...h.data.status, revokeGeneration: ids.generation, pending: { challengeId: ids.challenge, revision: 1, expiresAt: Date.now() + 600000, maskedPhone: '••••0001', proof: 'verified' } }; };

describe('explicit owner WhatsApp linking through real provider, API, poller and helper', () => {
  it('keeps support decisions separate and unchecked, requires account and never treats sign-in as consent', async () => {
    h.data.account.active = false; h.data.support.active = false; await h.mount();
    const checkboxes = () => h.root().findAllByType('input').filter(node => node.props.type === 'checkbox');
    expect(checkboxes().map(node => node.props.checked)).toEqual([false, false, false, false]);
    const support = h.root().findByProps({ 'aria-label': 'Permisos de soporte de SarinBot' });
    expect(text(support)).toContain(h.data.support.documents.terms);
    await act(async () => { support.findAllByType('input').forEach(node => node.props.onChange({ target: { checked: true } })); });
    expect(support.findByType('button').props.disabled).toBe(true);
    expect(h.writes()).toHaveLength(0);
    expect(h.transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });
  it('posts only support choices and resets on changed revision/fingerprint and UID', async () => {
    h.data.support.active = false; await h.mount();
    let support = h.root().findByProps({ 'aria-label': 'Permisos de soporte de SarinBot' });
    for (const node of support.findAllByType('input')) await act(async () => node.props.onChange({ target: { checked: true } }));
    await act(async () => support.findByType('form').props.onSubmit({ preventDefault() {} }));
    const body = JSON.parse(String(h.transport.mock.calls.find(([path, init]) => path === '/api/consent' && init?.method === 'POST')?.[1]?.body));
    expect(Object.keys(body).sort()).toEqual(['action', 'dataAuthorized', 'expectedRevision', 'fingerprint', 'requestId', 'scope', 'termsAccepted']);
    expect(body.scope).toBe('platform_support');
    h.data.support = { ...h.data.support, active: false, revision: 3, documents: { ...h.data.support.documents, fingerprint: 'c'.repeat(64) } }; await h.focus();
    support = h.root().findByProps({ 'aria-label': 'Permisos de soporte de SarinBot' });
    expect(support.findAllByType('input').map(node => node.props.checked)).toEqual([false, false]);
    await h.emit({ ...h.user, uid: 'owner-b' } as User);
    expect(h.root().findAllByType('input').filter(node => node.props.type === 'checkbox').map(node => node.props.checked)).toEqual([false, false]);
  });
  it('issues a transient manual command with no implicit open, clipboard or confirm and only the fixed route destination', async () => {
    await h.mount(); await h.begin();
    expect(h.command() === syntheticCommand).toBe(true);
    expect(h.root().findByProps({ id: 'owner-whatsapp-phone' }).props.value).toBe('');
    expect(h.clipboard).not.toHaveBeenCalled();
    const anchor = h.scope().findAllByType('a').find(node => node.props.href.startsWith('https://wa.me/'))!;
    expect(anchor.props).toMatchObject({ href: 'https://wa.me/573000000099', rel: 'noopener noreferrer', target: '_blank', referrerPolicy: 'no-referrer' });
    expect(anchor.props.href.includes(h.command()!)).toBe(false);
    expect(h.writes()).toHaveLength(1);
    expect(Object.keys(JSON.parse(String(h.writes()[0][1]?.body))).sort()).toEqual(['action', 'phoneE164', 'requestId']);
    await h.click('Copiar comando'); expect(h.clipboard).toHaveBeenCalledTimes(1); expect(h.content()).toContain('Comando copiado');
    pending(); await h.focus();
    await act(async () => { h.page.dispatchEvent(new Event('visibilitychange')); h.browser.dispatchEvent(new Event('focus')); });
    expect(h.writes()).toHaveLength(1);
    expect(h.content()).toContain('falta tu confirmación');
    await h.click('Confirmar este número en la web');
    const confirm = JSON.parse(String(h.writes()[1][1]?.body));
    expect(confirm).toMatchObject({ action: 'confirm', challengeId: ids.challenge, confirmed: true });
    expect(h.command() === null).toBe(true); expect(h.content()).toContain('Vinculación confirmada: ••••0001');
  });
  it.each([undefined, 'https://evil.test/123', 'https://wa.me/12345678?text=secret', 'https://wa.me/12345678#x', 'https://u@wa.me/12345678', 'https://wa.me:443/12345678', 'http://wa.me/12345678', 'https://wa.me/12345678\n'])('rejects unsafe or absent destination %# without fallback', async url => {
    expect(safeWhatsAppLinkDestination(url)).toBeNull();
    await h.mount(); h.setMutation(async () => { pending(); return response({ challengeId: ids.challenge, code: syntheticCommand, expiresAt: Date.now() + 600000, ...(url ? { whatsappUrl: url } : {}) }); }); await h.begin();
    expect(h.scope().findAllByType('a').map(node => node.props.href)).toEqual(['/terminos', '/privacidad']);
    expect(h.content()).toContain('No hay un destino de vinculación disponible');
    expect(h.clipboard).not.toHaveBeenCalled();
  });
  it('hides the exact code at expiry equality and blocks explicit confirmation without creating another code', async () => {
    await h.mount(); await h.begin(); pending(); await h.focus();
    await act(async () => vi.advanceTimersByTimeAsync(599999)); expect(Boolean(h.command())).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(h.command() === null).toBe(true);
    expect(h.button('Confirmar este número en la web').props.disabled).toBe(true); await h.click('Confirmar este número en la web');
    expect(h.writes()).toHaveLength(1);
  });
  it('requires explicit replacement and keeps the confirmed link until explicit replacement confirmation', async () => {
    pending(); h.data.status.current = { linkId: ids.link, revision: 1, expiresAt: Date.now() + 86400000, maskedPhone: '••••0002' }; await h.mount();
    expect(h.button('Crear otro código')).toBeDefined(); expect(h.content()).toContain('consume otra emisión');
    expect(h.writes()).toHaveLength(0); await h.begin(); expect(h.content()).toContain('Vinculación confirmada: ••••0002');
  });
  it('retries a lost begin response with the immutable body and treats code-unavailable as terminal', async () => {
    await h.mount(); h.setMutation(async () => { throw Error('Synthetic connection interrupted'); }); await h.begin();
    const original = h.writes()[0][1]?.body;
    expect(h.content()).toContain('No sabemos si');
    h.setMutation(async () => response({ code: 'CHALLENGE_CODE_UNAVAILABLE' }, 409));
    await h.click('Reintentar la misma solicitud');
    expect(h.writes()[1][1]?.body === original).toBe(true);
    expect(h.content()).toContain('nueva acción'); expect(h.button('Reintentar la misma solicitud')).toBeUndefined();
    await h.focus(); expect(h.writes()).toHaveLength(2);
  });
  it.each(['begin', 'confirm', 'revoke'] as const)('retains immutable %s request across Retry-After and actual reauth with no automatic mutation', async action => {
    pending(); await h.mount(); h.setMutation(async () => uncertain());
    if (action === 'begin') await h.begin(); else await h.click(action === 'confirm' ? 'Confirmar este número en la web' : 'Revocar vinculación de WhatsApp');
    const original = h.writes()[0][1]?.body;
    expect(h.button('Reintentar la misma solicitud').props.disabled).toBe(true);
    await h.click('Reintentar la misma solicitud'); expect(h.writes()).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(2000)); h.setMutation(async () => recent());
    await h.click('Reintentar la misma solicitud'); expect(h.writes()[1][1]?.body === original).toBe(true);
    await h.click('Volver a verificar mi identidad');
    expect(reauthenticateWithPopup).toHaveBeenCalledTimes(1); expect(h.user.getIdTokenResult).toHaveBeenCalledWith(true);
    expect(h.writes()).toHaveLength(2);
    // A newly issued result with old authTime is never promoted to browser authority.
    await h.click('Reintentar la misma solicitud'); expect(h.writes()[2][1]?.body === original).toBe(true);
    expect(h.content()).toContain('Vuelve a verificar');
  });
  it.each(['cancel', 'mismatch', 'unsupported'])('never mutates after %s reauth', async kind => {
    await h.mount(); h.setMutation(async () => recent()); await h.begin();
    if (kind === 'cancel') vi.mocked(reauthenticateWithPopup).mockRejectedValueOnce(Error('Cancelled'));
    if (kind === 'mismatch') vi.mocked(reauthenticateWithPopup).mockResolvedValueOnce({ user: { ...h.user, uid: 'other' } } as never);
    if (kind === 'unsupported') Object.assign(h.user, { providerData: [] });
    await h.click('Volver a verificar mi identidad'); expect(h.writes()).toHaveLength(1); expect(h.content()).not.toContain('Identidad verificada.');
  });
  it('keeps generation-bound revoke independent of consent/readiness and preserves an accepted retry after relink', async () => {
    pending(); h.data.account.active = false; h.data.support.active = false; h.data.status.available = false;
    await h.mount(); h.setMutation(async () => uncertain()); await h.click('Revocar vinculación de WhatsApp');
    const original = h.writes()[0][1]?.body, request = JSON.parse(String(original));
    expect(Object.keys(request)).toEqual(['requestId']); expect(request.requestId.startsWith('revoke_v1_' + ids.generation + '_')).toBe(true);
    h.data.status = { ...h.data.status, pending: null, revokeGeneration: ids.nextGeneration, current: { linkId: ids.link, revision: 2, expiresAt: Date.now() + 86400000, maskedPhone: '••••0002' } }; await h.focus();
    await act(async () => vi.advanceTimersByTimeAsync(2000)); h.setMutation(async () => response({ revoked: true })); await h.click('Reintentar la misma solicitud');
    expect(h.writes()[1][1]?.body === original).toBe(true); expect(h.content()).toContain('Vinculación confirmada: ••••0002');
  });
  it('makes stale revoke conflict terminal without auto-upgrading to a new generation', async () => {
    pending(); await h.mount(); h.setMutation(async () => response({ code: 'LINK_CONFLICT' }, 409)); await h.click('Revocar vinculación de WhatsApp');
    const old = String(h.writes()[0][1]?.body);
    h.data.status.revokeGeneration = ids.nextGeneration; await h.focus();
    expect(h.writes()).toHaveLength(1); expect(h.button('Reintentar la misma solicitud')).toBeUndefined();
    await h.click('Revocar vinculación de WhatsApp'); expect(String(h.writes()[1][1]?.body) === old).toBe(false);
  });
  it.each(['account', 'support'] as const)('invalidates code and grant callbacks on %s withdrawal/reaccept while revoke remains independent', async scope => {
    await h.mount(); await h.begin(); const oldConfirm = h.button('Crear otro código').props.onClick;
    h.data[scope] = { ...h.data[scope], active: false, revision: 2 }; await h.focus(); expect(h.command() === null).toBe(true);
    expect(h.button('Revocar vinculación de WhatsApp').props.disabled).toBe(false);
    h.data[scope] = { ...h.data[scope], active: true, revision: 3 }; await h.focus();
    expect(h.command() === null).toBe(true); if (oldConfirm) await act(async () => oldConfirm()); expect(h.writes()).toHaveLength(1);
  });
  it('discards code and a stale confirmation after the displayed challenge changes', async () => {
    await h.mount(); await h.begin(); pending(); await h.focus();
    const stale = h.button('Confirmar este número en la web').props.onClick;
    h.data.status.pending = { ...h.data.status.pending!, challengeId: ids.nextChallenge, revision: 2 }; await h.focus();
    expect(h.command() === null).toBe(true); await act(async () => stale()); expect(h.writes()).toHaveLength(1);
  });
  it.each([401, 403])('latches current identity loss %s, clears private command and blocks token-only reopening', async status => {
    await h.mount(); await h.begin(); h.setMutation(async () => response({ code: 'LINK_AUTH_REQUIRED' }, status));
    await h.click('Revocar vinculación de WhatsApp'); expect(h.command() === null).toBe(true);
    const before = h.writes().length, epoch = h.auth.authEpoch;
    await h.emit(h.user); await h.focus(); expect(h.auth.authEpoch).toBe(epoch); expect(h.auth.user).toBeNull(); expect(h.writes()).toHaveLength(before);
  });
  it('distinguishes consent conflict from freshness and refreshes both decisions without retry authority', async () => {
    await h.mount(); h.data.support.active = false; h.setMutation(async () => response({ code: 'CONSENT_REQUIRED' }, 428)); await h.begin();
    expect(h.content()).toContain('Revisa tus permisos'); expect(h.button('Volver a verificar mi identidad')).toBeUndefined(); expect(h.button('Reintentar la misma solicitud')).toBeUndefined();
    expect(h.button('Revocar vinculación de WhatsApp')).toBeUndefined();
  });
});


// Each row drives the real mounted panel and real API await boundaries.
describe('owner stale-result boundaries', () => {
  it.each(['begin', 'confirm', 'revoke'] as const)('blocks %s before fetch when logout starts during token acquisition before React rerenders', async action => {
    pending(); await h.mount();
    const token = deferred<string>(); vi.mocked(h.user.getIdToken).mockReturnValueOnce(token.promise);
    if (action === 'begin') await h.begin(); else await h.click(action === 'confirm' ? 'Confirmar este número en la web' : 'Revocar vinculación de WhatsApp');
    expect(h.writes()).toHaveLength(0);
    const { signOut } = await import('firebase/auth'); const logout = deferred<void>(); vi.mocked(signOut).mockReturnValueOnce(logout.promise);
    let signingOut!: Promise<void>;
    await act(async () => {
      signingOut = h.auth.signOut();
      token.resolve('synthetic-token'); await Promise.resolve(); await Promise.resolve();
      expect(h.writes()).toHaveLength(0);
    });
    await act(async () => { firebase.user = null; logout.resolve(); await signingOut; });
    expect(h.command() === null).toBe(true); expect(h.writes()).toHaveLength(0);
  });
  it.each(['begin', 'confirm', 'revoke'] as const)('blocks %s token completion after synchronous provider invalidation', async action => {
    pending(); await h.mount();
    const epoch = h.auth.authEpoch, token = deferred<string>(); vi.mocked(h.user.getIdToken).mockReturnValueOnce(token.promise);
    if (action === 'begin') await h.begin(); else await h.click(action === 'confirm' ? 'Confirmar este número en la web' : 'Revocar vinculación de WhatsApp');
    await act(async () => {
      h.auth.invalidateSession('owner-a', epoch); token.resolve('synthetic-token'); await Promise.resolve(); await Promise.resolve();
      expect(h.writes()).toHaveLength(0);
    });
    expect(h.command() === null).toBe(true); expect(h.auth.user).toBeNull();
  });
  const boundaries = (['begin', 'confirm', 'revoke'] as const).flatMap(action => (['fetch', 'json'] as const).map(boundary => ({ action, boundary })));
  it.each(boundaries)('discards late $action $boundary success after UID switch even when transport ignores abort', async ({ action, boundary }) => {
    pending(); await h.mount();
    const wait = deferred<unknown>(), body = action === 'begin' ? { challengeId: ids.challenge, code: syntheticCommand, expiresAt: Date.now() + 600000 } : action === 'confirm' ? { linkId: ids.link, revision: 1, expiresAt: Date.now() + 86400000 } : { revoked: true };
    h.setMutation(async () => boundary === 'fetch' ? wait.promise as Promise<Response> : { ok: true, status: 200, headers: new Headers(), json: () => wait.promise } as unknown as Response);
    if (action === 'begin') await h.begin(); else await h.click(action === 'confirm' ? 'Confirmar este número en la web' : 'Revocar vinculación de WhatsApp');
    const signal = h.writes()[0][1]?.signal;
    await h.emit({ ...h.user, uid: 'owner-b' } as User); expect(signal?.aborted).toBe(true);
    await act(async () => wait.resolve(boundary === 'fetch' ? response(body) : body));
    expect(h.auth.user?.uid).toBe('owner-b'); expect(h.command() === null).toBe(true); expect(h.writes()).toHaveLength(1);
    expect(h.content()).not.toContain('Solicitud de revocación confirmada.');
  });
  it.each([401, 403])('does not let a late old %s poison the newly verified owner', async status => {
    pending(); await h.mount(); const wait = deferred<Response>(); h.setMutation(async () => wait.promise);
    await h.click('Revocar vinculación de WhatsApp'); await h.emit({ ...h.user, uid: 'owner-b' } as User);
    await act(async () => wait.resolve(response({ code: 'LINK_AUTH_REQUIRED' }, status)));
    expect(h.auth.user?.uid).toBe('owner-b'); expect(h.auth.isCurrentSession('owner-b', h.auth.authEpoch)).toBe(true); expect(h.writes()).toHaveLength(1);
  });
  it.each(['fetch', 'json'])('does not publish an old GET $s after a newer GET or successful revoke', async boundary => {
    pending(); await h.mount();
    const wait = deferred<unknown>(), backend = h.transport.getMockImplementation()!, old = structuredClone(h.data.status);
    let first = true;
    h.transport.mockImplementation((path, init) => {
      if (path === '/api/platform-whatsapp/link' && !init?.method && first) { first = false; return boundary === 'fetch' ? wait.promise as Promise<Response> : Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: () => wait.promise } as unknown as Response); }
      return backend(path, init);
    });
    await h.focus(); await h.click('Revocar vinculación de WhatsApp');
    await act(async () => wait.resolve(boundary === 'fetch' ? response(old) : old));
    expect(h.content()).toContain('No hay una vinculación confirmada'); expect(h.content()).not.toContain('Número comprobado;');
    expect(h.button('Revocar vinculación de WhatsApp')).toBeUndefined(); expect(h.writes()).toHaveLength(1);
  });
  it.each(['popup', 'token'])('ignores real reauth $s after logout-start and same-UID recovery', async boundary => {
    await h.mount(); h.setMutation(async () => response({ code: 'LINK_RECENT_AUTH_REQUIRED' }, 428)); await h.begin();
    const wait = deferred<unknown>();
    if (boundary === 'popup') vi.mocked(reauthenticateWithPopup).mockReturnValueOnce(wait.promise as never);
    else vi.mocked(h.user.getIdTokenResult).mockReturnValueOnce(wait.promise as never);
    const verifying = h.button('Volver a verificar mi identidad').props.onClick;
    act(() => { void verifying(); });
    const { signOut } = await import('firebase/auth'); vi.mocked(signOut).mockRejectedValueOnce(Error('Synthetic failed logout'));
    await act(async () => h.auth.signOut());
    const epoch = h.auth.authEpoch;
    await act(async () => wait.resolve(boundary === 'popup' ? { user: h.user } : {}));
    expect(h.auth.authEpoch).toBe(epoch); expect(h.command() === null).toBe(true); expect(h.writes()).toHaveLength(1);
    expect(h.button('Reintentar la misma solicitud')).toBeUndefined(); expect(h.content()).not.toContain('Identidad verificada.');
  });
  it('does not display clipboard completion after the challenge is replaced', async () => {
    await h.mount(); await h.begin(); const wait = deferred<void>(); h.clipboard.mockReturnValueOnce(wait.promise);
    const copying = h.button('Copiar comando').props.onClick; act(() => { void copying(); });
    h.data.status.pending = { ...h.data.status.pending!, challengeId: ids.nextChallenge, revision: 2 }; await h.focus();
    await act(async () => wait.resolve()); expect(h.command() === null).toBe(true); expect(h.content()).not.toContain('Comando copiado'); expect(h.writes()).toHaveLength(1);
  });
  it('reconciles an uncertain pending-only revoke using GET-null without sending another DELETE', async () => {
    pending(); await h.mount(); h.setMutation(async () => { throw Error('Synthetic uncertain revoke'); });
    await h.click('Revocar vinculación de WhatsApp');
    h.data.status = { ...h.data.status, pending: null, current: null, revokeGeneration: null }; await h.focus();
    expect(h.button('Reintentar la misma solicitud')).toBeUndefined(); expect(h.content()).toContain('No se envió otra revocación'); expect(h.writes()).toHaveLength(1);
  });
  it('rejects a stale revoke callback after the displayed generation changes', async () => {
    pending(); await h.mount(); const stale = h.button('Revocar vinculación de WhatsApp').props.onClick;
    h.data.status.revokeGeneration = ids.nextGeneration; await h.focus();
    await act(async () => stale()); expect(h.writes()).toHaveLength(0);
  });
  it('blocks begin completion through a consent withdrawal and later reacceptance', async () => {
    await h.mount(); const wait = deferred<Response>(); h.setMutation(async () => wait.promise); await h.begin();
    h.data.support = { ...h.data.support, active: false, revision: 2 }; await h.focus();
    h.data.support = { ...h.data.support, active: true, revision: 3 }; await h.focus();
    await act(async () => wait.resolve(response({ challengeId: ids.challenge, code: syntheticCommand, expiresAt: Date.now() + 600000 })));
    expect(h.command() === null).toBe(true); expect(h.writes()).toHaveLength(1); expect(h.button('Reintentar la misma solicitud')).toBeUndefined();
  });
  it.each([{}, { available: true, revokeGeneration: null, current: null, pending: { proof: 'verified' } }, { available: 'true', revokeGeneration: null, current: null, pending: null }])('rejects malformed safe status %# without presenting raw data', async malformed => {
    const backend = h.transport.getMockImplementation()!;
    h.transport.mockImplementation((path, init) => path === '/api/platform-whatsapp/link' ? Promise.resolve(response(malformed)) : backend(path, init));
    await h.mount(); expect(h.content()).toContain('No se pudo comprobar la vinculación'); expect(h.writes()).toHaveLength(0); expect(h.command() === null).toBe(true);
  });
});

it('does not create a new request from the original action while an uncertain immutable retry is retained', async () => {
  pending(); await h.mount(); h.setMutation(async () => { throw Error('Synthetic uncertainty'); });
  const staleConfirm = h.button('Confirmar este número en la web').props.onClick;
  await h.click('Confirmar este número en la web');
  expect(h.button('Confirmar este número en la web').props.disabled).toBe(true);
  await act(async () => staleConfirm()); await h.begin(); await h.click('Revocar vinculación de WhatsApp');
  expect(h.writes()).toHaveLength(1);
});
it('closes grants after consent conflict until the receipt anchors change while revoke remains available', async () => {
  pending(); await h.mount(); h.setMutation(async () => response({ code: 'CONSENT_REQUIRED' }, 428));
  await h.click('Confirmar este número en la web');
  expect(h.button('Confirmar este número en la web').props.disabled).toBe(true);
  expect(h.button('Revocar vinculación de WhatsApp').props.disabled).toBe(false);
  await h.focus(); expect(h.button('Confirmar este número en la web').props.disabled).toBe(true);
  h.data.support = { ...h.data.support, revision: h.data.support.revision + 1 }; await h.focus();
  expect(h.button('Confirmar este número en la web').props.disabled).toBe(false);
});
it('retires an uncertain confirm on challenge replacement and requires a new explicit challenge action', async () => {
  pending(); await h.mount(); h.setMutation(async () => { throw Error('Synthetic uncertainty'); }); await h.click('Confirmar este número en la web');
  h.data.status.pending = { ...h.data.status.pending!, challengeId: ids.nextChallenge, revision: 2 }; await h.focus();
  expect(h.button('Reintentar la misma solicitud')).toBeUndefined(); expect(h.button('Confirmar este número en la web').props.disabled).toBe(false);
  expect(h.writes()).toHaveLength(1); await h.click('Confirmar este número en la web'); expect(h.writes()).toHaveLength(2);
});
it.each(['popup', 'token'])('synchronously rejects stale real reauth %s completion at provider invalidation before React rerenders', async boundary => {
  await h.mount(); h.setMutation(async () => response({ code: 'LINK_RECENT_AUTH_REQUIRED' }, 428)); await h.begin();
  const wait = deferred<unknown>();
  if (boundary === 'popup') vi.mocked(reauthenticateWithPopup).mockReturnValueOnce(wait.promise as never);
  else vi.mocked(h.user.getIdTokenResult).mockReturnValueOnce(wait.promise as never);
  act(() => { void h.button('Volver a verificar mi identidad').props.onClick(); });
  const epoch = h.auth.authEpoch, predicate = h.auth.isCurrentSession;
  await act(async () => {
    h.auth.invalidateSession('owner-a', epoch);
    expect(predicate('owner-a', epoch)).toBe(false);
    wait.resolve(boundary === 'popup' ? { user: h.user } : {});
    await Promise.resolve(); await Promise.resolve();
    expect(h.writes()).toHaveLength(1);
  });
  expect(h.command() === null).toBe(true); expect(h.content()).not.toContain('Identidad verificada.');
});

it.each(['fetch', 'json'])('rejects delayed GET %s after switching to a new verified UID', async boundary => {
  await h.mount();
  const wait = deferred<unknown>(), backend = h.transport.getMockImplementation()!;
  const old = { available: true, revokeGeneration: ids.generation, pending: null, current: { linkId: ids.link, revision: 1, expiresAt: Date.now() + 86400000, maskedPhone: '••••0009' } };
  let first = true;
  h.transport.mockImplementation((path, init) => {
    if (path === '/api/platform-whatsapp/link' && !init?.method && first) { first = false; return boundary === 'fetch' ? wait.promise as Promise<Response> : Promise.resolve({ ok: true, status: 200, headers: new Headers(), json: () => wait.promise } as unknown as Response); }
    return backend(path, init);
  });
  await h.focus(); await h.emit({ ...h.user, uid: 'owner-b' } as User);
  await act(async () => wait.resolve(boundary === 'fetch' ? response(old) : old));
  expect(h.content()).not.toContain('••••0009'); expect(h.auth.user?.uid).toBe('owner-b'); expect(h.writes()).toHaveLength(0);
});
it.each(['popup', 'token'])('rejects real reauth %s after a UID transition with zero extra mutation', async boundary => {
  await h.mount(); h.setMutation(async () => response({ code: 'LINK_RECENT_AUTH_REQUIRED' }, 428)); await h.begin();
  const wait = deferred<unknown>();
  if (boundary === 'popup') vi.mocked(reauthenticateWithPopup).mockReturnValueOnce(wait.promise as never);
  else vi.mocked(h.user.getIdTokenResult).mockReturnValueOnce(wait.promise as never);
  act(() => { void h.button('Volver a verificar mi identidad').props.onClick(); });
  await h.emit({ ...h.user, uid: 'owner-b' } as User);
  await act(async () => wait.resolve(boundary === 'popup' ? { user: h.user } : {}));
  expect(h.writes()).toHaveLength(1); expect(h.content()).not.toContain('Identidad verificada.'); expect(h.button('Reintentar la misma solicitud')).toBeUndefined();
});
const synchronousBoundaryRows = (['begin', 'confirm', 'revoke'] as const).flatMap(action => (['fetch', 'json'] as const).map(boundary => ({ action, boundary })));
it.each(synchronousBoundaryRows)('fences actual $action $boundary when invalidation and completion occur before React rerenders', async ({ action, boundary }) => {
  pending(); await h.mount(); const wait = deferred<unknown>();
  const old = action === 'begin' ? { challengeId: ids.challenge, code: syntheticCommand, expiresAt: Date.now() + 600000 } : action === 'confirm' ? { linkId: ids.link, revision: 1, expiresAt: Date.now() + 86400000 } : { revoked: true };
  h.setMutation(async () => boundary === 'fetch' ? wait.promise as Promise<Response> : { ok: true, status: 200, headers: new Headers(), json: () => wait.promise } as unknown as Response);
  if (action === 'begin') await h.begin(); else await h.click(action === 'confirm' ? 'Confirmar este número en la web' : 'Revocar vinculación de WhatsApp');
  const epoch = h.auth.authEpoch;
  await act(async () => { h.auth.invalidateSession('owner-a', epoch); wait.resolve(boundary === 'fetch' ? response(old) : old); await Promise.resolve(); await Promise.resolve(); });
  expect(h.command() === null).toBe(true); expect(h.auth.user).toBeNull(); expect(h.writes()).toHaveLength(1); expect(h.content()).not.toContain('Vinculación confirmada.');
});
it('retires a pending confirm response when the displayed challenge changes and never confirms the replacement automatically', async () => {
  pending(); await h.mount(); const wait = deferred<Response>(); h.setMutation(async () => wait.promise);
  await h.click('Confirmar este número en la web');
  h.data.status.pending = { ...h.data.status.pending!, challengeId: ids.nextChallenge, revision: 2 }; await h.focus();
  await act(async () => wait.resolve(response({ linkId: ids.link, revision: 1, expiresAt: Date.now() + 86400000 })));
  expect(h.content()).not.toContain('Vinculación confirmada:'); expect(h.writes()).toHaveLength(1); expect(h.button('Confirmar este número en la web').props.disabled).toBe(false);
});
it('disables an immutable confirm retry at expiry equality without issuing another request', async () => {
  pending(); await h.mount(); h.setMutation(async () => { throw Error('Synthetic uncertainty'); }); await h.click('Confirmar este número en la web');
  await act(async () => vi.advanceTimersByTimeAsync(600000));
  expect(h.button('Reintentar la misma solicitud')).toBeUndefined(); expect(h.button('Confirmar este número en la web').props.disabled).toBe(true); expect(h.writes()).toHaveLength(1);
});

it('never exposes an old begin command after a newer GET has replaced its challenge, even while the follow-up GET hangs', async () => {
  await h.mount(); const wait = deferred<Response>(); h.setMutation(async () => wait.promise); await h.begin();
  pending(); h.data.status.pending = { ...h.data.status.pending!, challengeId: ids.nextChallenge, revision: 2 }; await h.focus();
  const backend = h.transport.getMockImplementation()!;
  h.transport.mockImplementation((path, init) => path === '/api/platform-whatsapp/link' && !init?.method ? new Promise<Response>(() => {}) : backend(path, init));
  await act(async () => wait.resolve(response({ challengeId: ids.challenge, code: syntheticCommand, expiresAt: Date.now() + 600000 })));
  expect(h.command() === null).toBe(true); expect(h.writes()).toHaveLength(1);
});

describe('review I1 late-expiry boundaries through the actual owner panel', () => {
  it.each([0, 1])('never publishes a begin response arriving expiry+%sms while the follow-up GET is held', async lateBy => {
    await h.mount();
    const expiresAt = Date.now() + 10000, wait = deferred<Response>();
    h.setMutation(async () => wait.promise); await h.begin();
    h.page.visibilityState = 'hidden';
    await act(async () => h.page.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTimeAsync(10000 + lateBy));
    const backend = h.transport.getMockImplementation()!;
    h.transport.mockImplementation((path, init) => path === '/api/platform-whatsapp/link' && !init?.method ? new Promise<Response>(() => {}) : backend(path, init));
    h.page.visibilityState = 'visible';
    await act(async () => wait.resolve(response({ challengeId: ids.challenge, code: syntheticCommand, expiresAt, whatsappUrl: 'https://wa.me/573000000099' })));
    expect(h.command() === null).toBe(true);
    expect(h.button('Copiar comando') === undefined).toBe(true);
    expect(h.clipboard.mock.calls.length).toBe(0); expect(h.writes()).toHaveLength(1);
  });
  const expiredStatuses = (['pending', 'current'] as const).flatMap(kind => [0, 1].map(lateBy => ({ kind, lateBy })));
  it.each(expiredStatuses)('renders delayed $kind status as expired at expiry+$lateBy ms', async ({ kind, lateBy }) => {
    await h.mount();
    const expiresAt = Date.now() + 10000, wait = deferred<Response>(), backend = h.transport.getMockImplementation()!;
    const status = { available: true, revokeGeneration: ids.generation, current: kind === 'current' ? { linkId: ids.link, revision: 1, expiresAt, maskedPhone: '••••0001' } : null, pending: kind === 'pending' ? { challengeId: ids.challenge, revision: 1, expiresAt, maskedPhone: '••••0001', proof: 'verified' as const } : null };
    h.transport.mockImplementation((path, init) => path === '/api/platform-whatsapp/link' && !init?.method ? wait.promise : backend(path, init));
    await h.focus();
    vi.setSystemTime(expiresAt + lateBy);
    await act(async () => wait.resolve(response(status)));
    if (kind === 'pending') {
      expect(h.content().includes('Código vencido.')).toBe(true);
      expect(h.button('Confirmar este número en la web').props.disabled).toBe(true);
    } else {
      expect(h.content().includes('Vencida')).toBe(true);
      expect(h.content().includes('Vigente hasta')).toBe(false);
    }
    expect(h.writes()).toHaveLength(0); expect(h.command() === null).toBe(true);
  });
  it.each([0, 1])('rejects a captured copy callback before clipboard at expiry+%sms', async lateBy => {
    await h.mount(); await h.begin();
    const copy = h.button('Copiar comando').props.onClick;
    const expiresAt = h.data.status.pending!.expiresAt;
    vi.setSystemTime(expiresAt + lateBy);
    await act(async () => copy());
    expect(h.clipboard.mock.calls.length).toBe(0);
    expect(h.writes()).toHaveLength(1);
  });
});
