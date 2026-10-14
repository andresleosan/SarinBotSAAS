import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const auth = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminAuth: () => auth }));
import { requireSuperadmin } from '@/lib/server/auth';
import { readJson } from '@/lib/server/http';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('zero trust request boundaries', () => {
  it('rejects missing token and any UID different from server config', async () => {
    vi.stubEnv('SUPERADMIN_UID', 'admin-exact'); auth.verifyIdToken.mockResolvedValue({ uid:'other',email:'admin@example.com' });
    await expect(requireSuperadmin(new Request('http://localhost'))).rejects.toMatchObject({ status:401 });
    await expect(requireSuperadmin(new Request('http://localhost',{headers:{Authorization:'Bearer token'}}))).rejects.toMatchObject({ status:403 });
    expect(auth.verifyIdToken).toHaveBeenCalledWith('token', true);
    auth.verifyIdToken.mockResolvedValue({ uid:'admin-exact' });
    await expect(requireSuperadmin(new Request('http://localhost',{headers:{Authorization:'Bearer token'}}))).resolves.toMatchObject({ uid:'admin-exact' });
  });
  it('limits actual bytes and validates schema without trusting content length', async () => {
    const request = new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'a'.repeat(50)})});
    await expect(readJson(request,z.object({text:z.string()}),20)).rejects.toMatchObject({status:413});
    await expect(readJson(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:'{"text":12}'}),z.object({text:z.string()}))).rejects.toMatchObject({status:400});
  });
});
