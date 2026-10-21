import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformWhatsAppContentCache } from '@/lib/client/platform-whatsapp-content-cache';
import { conversationFixture } from './platform-whatsapp-ui-fixtures';

describe('volatile platform preview deadlines', () => {
  afterEach(() => vi.restoreAllMocks());
  it('sanitizes React metadata while presenting exact contact/text only until the monotonic deadline', () => {
    let now = 100;
    const cache = new PlatformWhatsAppContentCache(() => now);
    const original = conversationFixture();
    const token = cache.begin(); now = 2_100;
    const metadata = cache.accept(original, token);
    expect(metadata).toEqual({ ...original, customerName: null, customerPhone: null, lastMessage: null, contentAvailable: false });
    expect(original.lastMessage).toBe('Consulta sintética\nSegunda línea');
    expect(cache.view(metadata)).toEqual(original);
    expect(cache.nextDelay()).toBe(8_000);
    now = 10_100;
    expect(cache.view(metadata)).toEqual(metadata);
    expect(cache.nextDelay()).toBeNull();
  });
  it.each([
    ['zero', '2026-10-21T15:00:00.000Z'], ['negative', '2026-10-21T14:59:59.000Z'],
    ['invalid', 'invalid'], ['over 24 hours', '2026-10-22T15:00:00.001Z'],
  ])('hides %s remote durations and invalidates an existing preview', (_, expires) => {
    const cache = new PlatformWhatsAppContentCache(() => 0);
    const view = conversationFixture({ contentExpiresAt: expires });
    expect(cache.view(cache.accept(view, cache.begin())).contentAvailable).toBe(false);
    expect(cache.nextDelay()).toBeNull();
    const good = conversationFixture(); cache.accept(good, cache.begin());
    cache.accept({ ...good, contentObservedAt: 'invalid' }, cache.begin());
    expect(cache.view(good).lastMessage).toBeNull();
  });
  it('admits exactly 24 hours and spends latency, independently of wall clock jumps', () => {
    let now = 0; const cache = new PlatformWhatsAppContentCache(() => now);
    const view = conversationFixture({ contentExpiresAt: '2026-10-22T15:00:00.000Z' });
    const start = cache.begin(); now = 1_000; cache.accept(view, start);
    vi.spyOn(Date, 'now').mockReturnValue(-999999999999);
    expect(cache.nextDelay()).toBe(86_399_000);
    vi.mocked(Date.now).mockReturnValue(9999999999999);
    expect(cache.nextDelay()).toBe(86_399_000);
    now = 86_400_000; expect(cache.view(view).contentAvailable).toBe(false);
    const late = new PlatformWhatsAppContentCache(() => now);
    now = 0; const begin = late.begin(); now = 10_001;
    expect(late.view(late.accept(conversationFixture(), begin)).contentAvailable).toBe(false);
  });
  it('retains deadlines through clear and expiry, blocks old epochs and never extends a matching key', () => {
    let now = 0; const cache = new PlatformWhatsAppContentCache(() => now);
    const view = conversationFixture(); const old = cache.begin(); cache.accept(view, old);
    cache.clear(); expect(cache.view(view).lastMessage).toBeNull();
    now = 1_000; cache.accept(view, old); expect(cache.nextDelay()).toBeNull();
    cache.accept({ ...view, revision: 8, contentObservedAt: '2026-10-21T14:59:50.000Z' }, cache.begin());
    expect(cache.nextDelay()).toBe(9_000);
    now = 10_000; cache.expire(); cache.accept(view, cache.begin());
    expect(cache.nextDelay()).toBeNull();
    cache.clear(); cache.accept(view, cache.begin()); expect(cache.view(view).contentAvailable).toBe(false);
    const next = { ...view, contentExpiresAt: '2026-10-21T15:00:20.000Z' };
    cache.accept(next, cache.begin()); expect(cache.view(next).contentAvailable).toBe(true);
  });
  it('shortens deadlines, schedules the earliest preview and clears unavailable content', () => {
    let now = 0; const cache = new PlatformWhatsAppContentCache(() => now);
    const first = conversationFixture(); const second = conversationFixture({ id: 'b'.repeat(64) });
    cache.accept(first, cache.begin()); cache.accept(second, cache.begin());
    now = 1_000;
    cache.accept({ ...first, contentObservedAt: '2026-10-21T15:00:08.000Z' }, cache.begin());
    expect(cache.nextDelay()).toBe(2_000);
    now = 3_000; expect(cache.view(first).lastMessage).toBeNull(); expect(cache.nextDelay()).toBe(7_000);
    cache.accept({ ...second, contentAvailable: false }, cache.begin()); expect(cache.nextDelay()).toBeNull();
  });
  it('uses performance.now by default and does not validate or normalize nullable content', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(15);
    const cache = new PlatformWhatsAppContentCache(); const view = conversationFixture({ customerPhone: null, lastMessage: '' });
    const token = cache.begin(); expect(token).toEqual({ startedAt: 15, epoch: 0 });
    cache.accept(view, token); now.mockReturnValue(20);
    expect(cache.view(view)).toEqual(view); expect(cache.nextDelay()).toBe(9_995);
  });
  it('does not create a new invalid deadline or revive content with a non-finite request clock', () => {
    let now = Infinity; const cache = new PlatformWhatsAppContentCache(() => now); const view = conversationFixture();
    cache.accept(view, cache.begin()); now = 0; expect(cache.view(view).contentAvailable).toBe(false);
    cache.accept(view, cache.begin()); expect(cache.nextDelay()).toBe(10_000);
    cache.accept(view, { startedAt: NaN, epoch: 0 }); expect(cache.view(view).lastMessage).toBeNull();
    cache.accept(view, cache.begin()); expect(cache.nextDelay()).toBe(10_000);
  });
});
