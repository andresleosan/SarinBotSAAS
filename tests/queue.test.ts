import { describe, expect, it } from 'vitest';
import { PriorityFifoQueue } from '@/lib/sarin/queue';

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
describe('priority FIFO inference queue', () => {
  it('runs CRITICAL next, retaining FIFO within both levels and no overlap', async () => {
    const queue = new PriorityFifoQueue(1);
    const gate = deferred(); const order: string[] = [];
    const running = queue.run(async () => { order.push('current'); await gate.promise; });
    const normal1 = queue.run(async () => { order.push('n1'); });
    const critical1 = queue.run(async () => { order.push('c1'); }, 'CRITICAL');
    const normal2 = queue.run(async () => { order.push('n2'); });
    const critical2 = queue.run(async () => { order.push('c2'); }, 'CRITICAL');
    gate.resolve(); await Promise.all([running, normal1, normal2, critical1, critical2]);
    expect(order).toEqual(['current', 'c1', 'c2', 'n1', 'n2']);
    expect(queue.stats().activeSlots).toBe(0);
  });
  it('never exceeds configured capacity and releases failed tasks', async () => {
    const queue = new PriorityFifoQueue(2); let active = 0; let maximum = 0;
    await Promise.allSettled(Array.from({ length: 15 }, (_, i) => queue.run(async () => {
      active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--;
      if (i === 4) throw new Error('expected');
    })));
    expect(maximum).toBe(2); expect(queue.stats().queuedRequests).toBe(0);
    expect(await queue.run(async () => 42)).toBe(42);
  });
  it('removes an aborted queued job without running it', async () => {
    const queue = new PriorityFifoQueue(1); const gate = deferred(); let ran = false;
    const active = queue.run(() => gate.promise);
    const controller = new AbortController();
    const pending = queue.run(async () => { ran = true; }, 'CRITICAL', { signal: controller.signal });
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    gate.resolve(); await active;
    expect(ran).toBe(false); expect(queue.stats().queuedRequests).toBe(0);
  });
  it('rejects invalid configuration and full waiting queue', async () => {
    expect(() => new PriorityFifoQueue(0)).toThrow(); expect(() => new PriorityFifoQueue(Number.NaN)).toThrow();
    const queue = new PriorityFifoQueue(1, 1); const gate = deferred();
    const active = queue.run(() => gate.promise); const queued = queue.run(async () => 1);
    await expect(queue.run(async () => 2)).rejects.toThrow(/ocupad|cola/i);
    gate.resolve(); await Promise.all([active, queued]);
  });
});
