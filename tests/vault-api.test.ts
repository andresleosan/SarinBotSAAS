import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  authorize: vi.fn(),
  complete: vi.fn(),
  priorities: [] as string[],
}));
vi.mock('@/lib/server/auth', () => ({ requireSuperadmin: dependencies.authorize }));
vi.mock('@/lib/sarin/engine', () => ({ completeChat: dependencies.complete }));
vi.mock('@/lib/server/inference', () => ({ runUserInference: async (_uid: string, task: () => Promise<unknown>) => task() }));
vi.mock('@/lib/sarin/queue', () => ({
  runInSarinQueue: async (task: () => Promise<unknown>, priority: string) => {
    dependencies.priorities.push(priority);
    return task();
  },
}));
import { POST } from '../src/app/api/sarin/vault/route';
import { HttpError } from '../src/lib/server/http';

describe('Vault server privacy boundary', () => {
  beforeEach(() => {
    dependencies.authorize.mockReset().mockResolvedValue({ uid: 'superadmin' });
    dependencies.complete.mockReset();
    dependencies.priorities.length = 0;
  });

  it('rejects a non-admin before reading private request content', async () => {
    dependencies.authorize.mockRejectedValue(new HttpError(403, 'Forbidden'));
    const request = new Request('http://localhost/api/sarin/vault', { method: 'POST', body: 'not even JSON' });
    const read = vi.spyOn(request, 'arrayBuffer');
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(dependencies.complete).not.toHaveBeenCalled();
  });

  it('uses critical priority, disables response caching and only returns validated financial records', async () => {
    dependencies.complete.mockResolvedValue({ role: 'assistant', content: 'Tu factura vence el 15 de enero.', tool_calls: [{
      id: 'analysis', type: 'function', function: { name: 'registrar_analisis', arguments: JSON.stringify({
        entries: [{ description: 'Agua', amount: 45000, currency: 'COP', category: 'Servicios', date: '2030-01-01', kind: 'expense' }],
        reminders: [{ title: 'Pagar agua', date: '2030-01-15', time: '09:00', notes: '' }],
      }) },
    }] });
    const response = await POST(new Request('http://localhost/api/sarin/vault', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Agua: 45.000 COP. Vence el 15 de enero de 2030.', attachments: [] }] }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(dependencies.priorities).toEqual(['CRITICAL']);
    expect(dependencies.complete.mock.calls[0][2]).toMatchObject({ provider: 'ollama' });
    const body = await response.json() as { message: string; analysis: { entries: { amount: number }[] } };
    expect(body.message).toContain('15 de enero');
    expect(body.analysis.entries[0].amount).toBe(45000);
  });

  it('rejects remote attachment URLs before the inference engine is called', async () => {
    const response = await POST(new Request('http://localhost/api/sarin/vault', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'factura', attachments: [{ name: 'factura', dataUrl: 'https://example.com/invoice.webp' }] }] }),
    }));
    expect(response.status).toBe(400);
    expect(dependencies.complete).not.toHaveBeenCalled();
  });
  it('routes embedded images through local vision and rejects invalid extracted dates', async () => {
    const calls: boolean[] = [];
    dependencies.complete.mockImplementation(async (_messages, tools, options: { vision: boolean; provider?: string }) => {
      calls.push(options.vision);
      expect(options.provider).toBe('ollama');
      if (options.vision) {
        expect(tools).toBeUndefined();
        return { role: 'assistant', content: 'Factura: el documento indica una fecha ilegible.' };
      }
      return { role: 'assistant', content: 'Una factura', tool_calls: [{ id: 'invalid', type: 'function', function: { name: 'registrar_analisis', arguments: JSON.stringify({ entries: [], reminders: [{ title: 'Pagar', date: '2030-02-30', time: '09:00', notes: '' }] }) } }] };
    });
    const response = await POST(new Request('http://localhost/api/sarin/vault', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Revisa esta factura', attachments: [{ name: 'recibo.webp', dataUrl: 'data:image/webp;base64,UklGRgQAAABXRUJQ' }] }] }) }));
    expect(response.status).toBe(502);
    expect(calls).toEqual([true, false]);
    expect((await response.json() as { error: string }).error).toContain('fechas');
  });
});
