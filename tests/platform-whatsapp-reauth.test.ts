import type { User } from 'firebase/auth';
import { beforeEach, expect, it, vi } from 'vitest';
import { reauthenticateWithPopup, signInWithPopup } from 'firebase/auth';
import { reauthenticatePlatformWhatsAppOwner } from '@/lib/client/platform-whatsapp-reauth';
const state = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/lib/firebase/client', () => ({ getFirebaseClient: () => ({ auth: { currentUser: state.user } }) }));
vi.mock('firebase/auth', () => ({ GoogleAuthProvider: class {}, reauthenticateWithPopup: vi.fn(), signInWithPopup: vi.fn() }));
let current: boolean;
const token = vi.fn();
const user = { uid: 'owner', providerData: [{ providerId: 'google.com' }], getIdTokenResult: token } as unknown as User;
beforeEach(() => { vi.clearAllMocks(); current = true; state.user = user; token.mockResolvedValue({ authTime: 'old-auth-time' }); vi.mocked(reauthenticateWithPopup).mockResolvedValue({ user } as never); });
it('reauthenticates the actual current Google account before requesting its fresh result token', async () => {
  await reauthenticatePlatformWhatsAppOwner('owner', 4, () => current);
  expect(reauthenticateWithPopup).toHaveBeenCalledWith(user, expect.anything());
  expect(token).toHaveBeenCalledWith(true);
  expect(vi.mocked(reauthenticateWithPopup).mock.invocationCallOrder[0]).toBeLessThan(token.mock.invocationCallOrder[0]);
  expect(signInWithPopup).not.toHaveBeenCalled();
});
it.each(['absent', 'unsupported', 'wrong-uid', 'invalid-epoch'])('rejects %s before opening a popup', async kind => {
  if (kind === 'absent') state.user = null;
  if (kind === 'unsupported') state.user = { ...user, providerData: [] } as unknown as User;
  if (kind === 'wrong-uid') state.user = { ...user, uid: 'other' } as User;
  if (kind === 'invalid-epoch') current = false;
  await expect(reauthenticatePlatformWhatsAppOwner('owner', 4, () => current)).rejects.toThrow();
  expect(reauthenticateWithPopup).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
});
it.each(['auth/popup-closed-by-user', 'auth/popup-blocked', 'mismatch', 'stale-popup', 'stale-token'])('fails closed on %s without sign-in fallback', async kind => {
  if (kind.startsWith('auth/')) vi.mocked(reauthenticateWithPopup).mockRejectedValue({ code: kind });
  if (kind === 'mismatch') vi.mocked(reauthenticateWithPopup).mockResolvedValue({ user: { ...user, uid: 'other' } } as never);
  if (kind === 'stale-popup') vi.mocked(reauthenticateWithPopup).mockImplementation(async () => { current = false; return { user } as never; });
  if (kind === 'stale-token') token.mockImplementation(async () => { current = false; return {}; });
  await expect(reauthenticatePlatformWhatsAppOwner('owner', 4, () => current)).rejects.toThrow();
  expect(signInWithPopup).not.toHaveBeenCalled();
});
