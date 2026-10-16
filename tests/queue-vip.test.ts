import { describe, expect, it } from 'vitest';
import { PriorityFifoQueue } from '@/lib/sarin/queue';

describe('reserved priority queue admission', () => {
  it('admits one CRITICAL turn ahead of a full normal waiting queue', async () => {
    const queue = new PriorityFifoQueue(1, 1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const active = queue.run(async () => { order.push('running'); await gate; });
    const normal = queue.run(async () => { order.push('normal'); });
    const critical = queue.run(async () => { order.push('priority'); }, 'CRITICAL');
    const secondCritical = queue.run(async () => { order.push('extra'); }, 'CRITICAL');
    const extraNormal = queue.run(async () => { order.push('extra-normal'); });
    // Attach rejection handlers before freeing the running task, so a failed
    // VIP admission is reported by the assertion without unhandled rejections.
    const results = Promise.allSettled([active, normal, critical, secondCritical, extraNormal]);
    const waiting = queue.stats();
    release();
    const outcomes = await results;
    expect(outcomes[2].status).toBe('fulfilled');
    expect(outcomes[3].status).toBe('rejected');
    expect(outcomes[4].status).toBe('rejected');
    expect(waiting.queuedRequests).toBe(2);
    expect(order).toEqual(['running', 'priority', 'normal']);
    expect(queue.stats().queuedRequests).toBe(0);
  });
});
