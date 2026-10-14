export type SarinPriority = 'CRITICAL' | 'NORMAL';
interface QueueOptions { signal?: AbortSignal; }
interface WaitingJob { start: () => void; cancel: (error: Error) => void; }

export class QueueBusyError extends Error {
  readonly status = 429;
  constructor() { super('La cola está ocupada. Inténtalo de nuevo en un momento.'); }
}

/** One queue per server process. A slot is transferred synchronously, with no semaphore race. */
export class PriorityFifoQueue {
  private active = 0;
  private readonly waiting: Record<SarinPriority, WaitingJob[]> = { CRITICAL: [], NORMAL: [] };

  constructor(private readonly maxSlots = 4, private readonly maxQueued = 64, private readonly waitTimeoutMs = 120_000) {
    if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 4) throw new Error('La concurrencia debe estar entre 1 y 4.');
    if (!Number.isInteger(maxQueued) || maxQueued < 1 || !Number.isFinite(waitTimeoutMs) || waitTimeoutMs < 1) throw new Error('Configuración de cola no válida.');
  }

  run<T>(task: () => Promise<T>, priority: SarinPriority = 'NORMAL', options: QueueOptions = {}): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(new DOMException('Solicitud cancelada.', 'AbortError'));
    const stats = this.stats();
    // A saturated public queue must still admit the Superadmin's next turn.
    // The extra admission is bounded to one reserved waiting position.
    const reservedVipPosition = priority === 'CRITICAL' && stats.criticalQueued === 0 && stats.queuedRequests === this.maxQueued;
    if (stats.queuedRequests >= this.maxQueued && !reservedVipPosition) return Promise.reject(new QueueBusyError());
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let waiting = true;
      const cleanup = () => { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
      const job: WaitingJob = {
        start: () => {
          waiting = false; cleanup(); this.active++;
          void (async () => {
            try { resolve(await task()); } catch (error) { reject(error); }
            finally { this.active--; this.drain(); }
          })();
        },
        cancel: (error) => {
          if (!waiting) return;
          waiting = false; cleanup();
          const index = this.waiting[priority].indexOf(job);
          if (index !== -1) this.waiting[priority].splice(index, 1);
          reject(error);
        },
      };
      const abort = () => job.cancel(new DOMException('Solicitud cancelada.', 'AbortError'));
      this.waiting[priority].push(job);
      options.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => job.cancel(new QueueBusyError()), this.waitTimeoutMs);
      this.drain();
    });
  }

  private drain() {
    while (this.active < this.maxSlots) {
      const job = this.waiting.CRITICAL.shift() ?? this.waiting.NORMAL.shift();
      if (!job) break;
      job.start();
    }
  }

  stats() { return { activeSlots: this.active, queuedRequests: this.waiting.CRITICAL.length + this.waiting.NORMAL.length,
    criticalQueued: this.waiting.CRITICAL.length, normalQueued: this.waiting.NORMAL.length, maxSlots: this.maxSlots }; }
}

const state = globalThis as typeof globalThis & { __sarinQueue?: PriorityFifoQueue };
function queue() {
  return state.__sarinQueue ??= new PriorityFifoQueue(Number(process.env.MAX_CONCURRENT_LLM_SLOTS ?? 4),
    Number(process.env.MAX_QUEUED_LLM_REQUESTS ?? 64), Number(process.env.LLM_QUEUE_TIMEOUT_MS ?? 120_000));
}
export function runInSarinQueue<T>(task: () => Promise<T>, priority: SarinPriority = 'NORMAL', options: QueueOptions = {}): Promise<T> {
  return queue().run(task, priority, options);
}
export function getSarinQueueStats() { return queue().stats(); }
