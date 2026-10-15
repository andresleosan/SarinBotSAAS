import { describe, expect, it, vi } from 'vitest';
import { inspectConfiguration, parseDoctorFlags, runDoctor } from '../scripts/lib/doctor.mjs';

const local = {
  SARIN_TUNNEL_URL: 'http://127.0.0.1:11434/v1/chat/completions',
  OLLAMA_MAIN_MODEL: 'private-main:32b', OLLAMA_VISION_MODEL: 'private-vision:8b',
};
const configured = {
  ...local,
  NEXT_PUBLIC_FIREBASE_API_KEY: 'public-placeholder', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'project.example',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'project', NEXT_PUBLIC_FIREBASE_APP_ID: 'app',
  FIREBASE_ADMIN_PROJECT_ID: 'project', FIREBASE_ADMIN_CLIENT_EMAIL: 'service@example.test',
  FIREBASE_ADMIN_PRIVATE_KEY: 'PRIVATE-KEY-DO-NOT-PRINT', SUPERADMIN_UID: 'PRIVATE-UID-DO-NOT-PRINT',
};
const completion = () => Response.json({ choices: [{ message: { role: 'assistant', content: 'RAW-CONTENT-DO-NOT-PRINT' } }] });

describe('local configuration doctor', () => {
  it('does not contact any service by default and treats missing Firebase as pending', async () => {
    const fetchImpl = vi.fn();
    const result = await runDoctor({ env: local, nodeVersion: 'v24.18.0', fetchImpl });
    expect(result.exitCode).toBe(0);
    expect(result.checks.find(check => check.check === 'firebase.client')?.status).toBe('pending');
    expect(result.checks.find(check => check.check === 'firebase.admin')?.status).toBe('pending');
    expect(result.checks.find(check => check.check === 'firebase.superadmin')?.status).toBe('pending');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks only credential presence without exposing or claiming to authenticate credentials', () => {
    const checks = inspectConfiguration(configured, '24.18.0');
    expect(checks.find(check => check.check === 'firebase.admin')?.status).toBe('ok');
    expect(checks.find(check => check.check === 'firebase.admin-key')?.message).toContain('presencia');
    expect(JSON.stringify(checks)).not.toContain('PRIVATE-KEY');
    expect(JSON.stringify(checks)).not.toContain('PRIVATE-UID');
    expect(JSON.stringify(checks)).not.toContain('service@example');
    expect(JSON.stringify(checks)).not.toContain('private-main:32b');
  });

  it('accepts explicit ADC configuration without demanding or reading a private key', async () => {
    const fetchImpl = vi.fn();
    const report = await runDoctor({ env: { ...local, FIREBASE_ADMIN_PROJECT_ID: 'project', FIREBASE_ADMIN_CREDENTIAL_MODE: 'adc', GOOGLE_APPLICATION_CREDENTIALS: 'PRIVATE-PATH-DO-NOT-PRINT' }, nodeVersion: '24.18.0', fetchImpl });
    expect(report.exitCode).toBe(0);
    expect(report.checks.find(check => check.check === 'firebase.admin')?.status).toBe('ok');
    expect(report.checks.find(check => check.check === 'firebase.admin-key')?.status).toBe('ok');
    expect(report.checks.find(check => check.check === 'firebase.admin-key')?.message).toContain('ADC');
    expect(JSON.stringify(report)).not.toContain('PRIVATE-PATH');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { FIREBASE_ADMIN_CREDENTIAL_MODE: 'unknown' },
    { FIREBASE_ADMIN_CREDENTIAL_MODE: 'adc', FIREBASE_ADMIN_CLIENT_EMAIL: 'PRIVATE-EMAIL' },
    { FIREBASE_ADMIN_CREDENTIAL_MODE: 'adc', FIREBASE_ADMIN_PRIVATE_KEY: 'PRIVATE-KEY' },
  ])('rejects unsupported or ambiguous Admin credential configuration without contacting services', async (overrides) => {
    const fetchImpl = vi.fn();
    const report = await runDoctor({ env: { ...local, FIREBASE_ADMIN_PROJECT_ID: 'project', ...overrides }, nodeVersion: '24.18.0', fetchImpl });
    expect(report.exitCode).toBe(1);
    expect(report.checks.find(check => check.check === 'firebase.admin')?.status).toBe('error');
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE-EMAIL|PRIVATE-KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [{ MAX_CONCURRENT_LLM_SLOTS: '0' }, 'queue.slots'],
    [{ MAX_CONCURRENT_LLM_SLOTS: '5' }, 'queue.slots'],
    [{ MAX_CONCURRENT_LLM_SLOTS: '1.5' }, 'queue.slots'],
    [{ MAX_QUEUED_LLM_REQUESTS: 'NaN' }, 'queue.capacity'],
    [{ LLM_QUEUE_TIMEOUT_MS: '0' }, 'queue.timeout'],
    [{ LLM_REQUEST_TIMEOUT_MS: '300001' }, 'engine.timeout'],
    [{ OLLAMA_MAIN_MODEL: 'qwen3:cloud' }, 'engine.main-model'],
    [{ SARIN_TUNNEL_URL: 'https://api.openai.com/v1/chat/completions', CF_ACCESS_CLIENT_ID: 'id', CF_ACCESS_CLIENT_SECRET: 'secret' }, 'engine.url'],
    [{ SARIN_TUNNEL_URL: 'https://sarin.example/v1/chat/completions?token=secret' }, 'engine.url'],
    [{ SARIN_TUNNEL_URL: 'http://sarin.example/v1/chat/completions' }, 'engine.url'],
  ])('rejects invalid runtime settings before sending any probe', async (overrides, check) => {
    const fetchImpl = vi.fn();
    const result = await runDoctor({ env: { ...local, ...overrides }, nodeVersion: 'v24.18.0', flags: { generate: true }, fetchImpl });
    expect(result.exitCode).toBe(1);
    expect(result.checks.find(item => item.check === check)?.status).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires Node 24 and rejects an incomplete Cloudflare service-token pair', () => {
    expect(inspectConfiguration(local, 'v25.0.0').find(check => check.check === 'runtime.node')?.status).toBe('error');
    expect(inspectConfiguration({ ...local, CF_ACCESS_CLIENT_ID: 'one-only' }, '24.1.0').find(check => check.check === 'engine.access')?.status).toBe('error');
  });

  it('uses a GET-only model catalog probe with server credentials and no Firebase dependency', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ id: local.OLLAMA_MAIN_MODEL }, { id: local.OLLAMA_VISION_MODEL }] }));
    const result = await runDoctor({ env: { ...local, SARIN_TUNNEL_URL: 'https://private.example/ollama/v1/chat/completions', CF_ACCESS_CLIENT_ID: 'SECRET-ID', CF_ACCESS_CLIENT_SECRET: 'SECRET-TOKEN' }, nodeVersion: '24.18.0', flags: { engine: true }, fetchImpl });
    expect(result.exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://private.example/ollama/v1/models');
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
    expect(options.redirect).toBe('error');
    expect(new Headers(options.headers).get('CF-Access-Client-Secret')).toBe('SECRET-TOKEN');
    expect(JSON.stringify(result)).not.toMatch(/SECRET-|private\.example|private-main/);
  });

  it('runs exactly one synthetic text inference when requested without echoing its output', async () => {
    const fetchImpl = vi.fn(async () => completion());
    const result = await runDoctor({ env: local, nodeVersion: '24.18.0', flags: { generate: true }, fetchImpl });
    expect(result.exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const options = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(String(options.body)) as { model: string; messages: { content: string }[]; stream: boolean };
    expect(body.model).toBe(local.OLLAMA_MAIN_MODEL);
    expect(body.messages[0].content).toContain('sintética');
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty('tools');
    expect(JSON.stringify(result)).not.toContain('RAW-CONTENT');
  });

  it('sends only a local embedded image to the vision model without function calling', async () => {
    const fetchImpl = vi.fn(async () => completion());
    const result = await runDoctor({ env: local, nodeVersion: '24.18.0', flags: { vision: true }, fetchImpl });
    expect(result.exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const options = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(String(options.body)) as { model: string; messages: { content: { type: string; image_url?: { url: string } }[] }[] };
    expect(body.model).toBe(local.OLLAMA_VISION_MODEL);
    expect(body.messages[0].content[1].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(body).not.toHaveProperty('tools');
    expect(JSON.stringify(result)).not.toContain('base64');
  });

  it('bounds streamed response bytes, cancels oversized responses, and hides upstream errors', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(300 * 1024)); }, cancel() { cancelled = true; } }));
    const oversized = await runDoctor({ env: local, nodeVersion: '24.18.0', flags: { engine: true }, fetchImpl: vi.fn(async () => response) });
    expect(oversized.exitCode).toBe(1);
    expect(cancelled).toBe(true);
    const failed = await runDoctor({ env: local, nodeVersion: '24.18.0', flags: { generate: true }, fetchImpl: vi.fn(async () => { throw new Error('SECRET-TOKEN and PRIVATE-CONTENT'); }) });
    expect(failed.exitCode).toBe(1);
    expect(JSON.stringify(failed)).not.toMatch(/SECRET|PRIVATE-CONTENT/);
  });

  it('rejects malformed or empty completion responses and never retries them', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: { content: '' } }] }));
    const result = await runDoctor({ env: local, nodeVersion: '24.18.0', flags: { generate: true }, fetchImpl });
    expect(result.exitCode).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sets short health and bounded inference timeouts and does not follow redirects', async () => {
    const timeouts = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      expect(options?.redirect).toBe('error');
      expect(options?.cache).toBe('no-store');
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return options?.method === 'GET' ? Response.json({ data: [{ id: local.OLLAMA_MAIN_MODEL }, { id: local.OLLAMA_VISION_MODEL }] }) : completion();
    });
    try {
      const report = await runDoctor({ env: local, nodeVersion: '24.18.0', flags: { engine: true, generate: true, vision: true }, fetchImpl });
      expect(report.exitCode).toBe(0);
      expect(timeouts.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([8000, 120000, 120000]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally { timeouts.mockRestore(); }
  });

  it('fails closed for a remote tunnel without Access credentials or a requested missing model', async () => {
    const fetchImpl = vi.fn(async () => completion());
    const remote = await runDoctor({ env: { ...local, SARIN_TUNNEL_URL: 'https://private.example/v1/chat/completions' }, nodeVersion: '24.18.0', flags: { engine: true }, fetchImpl });
    expect(remote.exitCode).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    const absent = await runDoctor({ env: { ...local, OLLAMA_VISION_MODEL: undefined }, nodeVersion: '24.18.0', flags: { vision: true }, fetchImpl });
    expect(absent.exitCode).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts only explicit diagnostic flags, deduplicates them, and never echoes unknown arguments', () => {
    expect(parseDoctorFlags(['--engine', '--engine', '--vision'])).toEqual({ help: false, flags: { engine: true, generate: false, vision: true } });
    expect(parseDoctorFlags(['--help']).help).toBe(true);
    expect(() => parseDoctorFlags(['--token=SECRET-TOKEN'])).toThrow('Opción no reconocida. Usa --help.');
  });
});
