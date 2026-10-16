import { act, createElement } from 'react';
import { create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingPricing } from '@/components/marketing-pricing';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const text = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(text).join('');
const offer = (monthly: number) => ({ currency: 'COP', trial: { priceCOP: 5000, appointmentLimit: 10, includedResponses: 700, expiresByDays: false },
  plans: [
    { id: 'weekly', label: 'Semanal', periodDays: 7, includedResponses: 700, priceCOP: 20000 },
    { id: 'fortnightly', label: 'Quincenal', periodDays: 15, includedResponses: 1500, priceCOP: 35000 },
    { id: 'monthly', label: 'Mensual', periodDays: 30, includedResponses: 3000, priceCOP: monthly },
  ], responsePack: { responses: 1000, priceCOP: 23000 } });
const response = (monthly: number) => new Response(JSON.stringify(offer(monthly)), { headers: { 'Content-Type': 'application/json' } });

describe('public live pricing', () => {
  let renderer: ReactTestRenderer | undefined;
  let page: EventTarget & { visibilityState: string };
  let fetcher: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', new EventTarget());
    fetcher = vi.fn().mockResolvedValue(response(65000));
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
  const mount = async (endpoint: string | null = '/api/public/commercial-offer') => {
    await act(async () => { renderer = create(createElement(MarketingPricing, { endpoint })); });
  };
  const content = () => text(renderer!.root);

  it('shows saved prices and refreshes without credentials or a rebuild', async () => {
    await mount();
    expect(content()).toContain('Mensual: $65.000 COP');
    expect(content()).toContain('$23.000 COP');
    expect(content()).not.toContain('59.900');
    const [, options] = fetcher.mock.calls[0];
    expect(options).toMatchObject({ cache: 'no-store', credentials: 'omit' });
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
    fetcher.mockResolvedValue(response(68000));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(content()).toContain('Mensual: $68.000 COP');
    expect(content()).not.toContain('65.000');
  });

  it('does not advertise a fixed tariff while the first request is pending', async () => {
    let finish!: (value: Response) => void;
    fetcher.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    await mount();
    expect(content()).toContain('Consultando tarifas');
    expect(content()).not.toMatch(/59\.900|65\.000/);
    await act(async () => { finish(response(65000)); });
    expect(content()).toContain('$65.000 COP');
  });

  it('hides a previously loaded tariff on failure and recovers only after a fresh successful read', async () => {
    await mount();
    fetcher.mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(content()).not.toContain('65.000');
    expect(content()).toContain('Reintentar');
    fetcher.mockResolvedValue(response(68000));
    await act(async () => { renderer!.root.findByType('button').props.onClick(); });
    expect(content()).toContain('$68.000 COP');
  });

  it('rejects malformed offers instead of partially displaying their prices', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ...offer(65000), bankAccounts: [] })));
    await mount();
    expect(content()).not.toContain('65.000');
    expect(content()).toContain('Reintentar');
  });

  it('does not query a guessed backend when coordinated access has no configured origin', async () => {
    await mount(null);
    expect(fetcher).not.toHaveBeenCalled();
    expect(content()).toContain('Consulta el precio vigente');
    expect(content()).not.toContain('59.900');
  });

  it('masks old prices immediately and discards a late response after the endpoint changes', async () => {
    let finish!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    await mount();
    fetcher.mockResolvedValue(response(68000));
    await act(async () => { renderer!.update(createElement(MarketingPricing, { endpoint: '/api/public/commercial-offer?current=1' })); });
    await act(async () => { finish(response(65000)); });
    expect(content()).toContain('$68.000 COP');
    expect(content()).not.toContain('65.000');
  });

  it('waits while hidden and loads current tariffs when the page becomes visible', async () => {
    page.visibilityState = 'hidden';
    await mount();
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => { page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); });
    expect(content()).toContain('$65.000 COP');
  });
});
