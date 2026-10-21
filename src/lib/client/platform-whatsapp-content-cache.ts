import type { PlatformWhatsAppConversationView } from '@/types/platform-whatsapp';

interface ReadToken { startedAt: number; epoch: number }
interface PreviewEntry {
  deadline: number;
  content: Pick<PlatformWhatsAppConversationView, 'customerPhone' | 'lastMessage'> | null;
}
const sanitize = (view: PlatformWhatsAppConversationView): PlatformWhatsAppConversationView => ({
  ...view, customerName: null, customerPhone: null, lastMessage: null, contentAvailable: false,
});
const key = (view: PlatformWhatsAppConversationView) => `${view.id}:${view.contentExpiresAt}`;

/** Volatile presentation only. Clearing plaintext retains deadlines to prevent TTL extension. */
export class PlatformWhatsAppContentCache {
  private readonly entries = new Map<string, PreviewEntry>();
  private epoch = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  begin(): ReadToken { return { startedAt: this.now(), epoch: this.epoch }; }

  accept(view: PlatformWhatsAppConversationView, token: ReadToken): PlatformWhatsAppConversationView {
    const metadata = sanitize(view);
    if (token.epoch !== this.epoch) return metadata;
    const ttl = Date.parse(view.contentExpiresAt) - Date.parse(view.contentObservedAt);
    const previous = this.entries.get(key(view));
    const deadline = Math.min(previous?.deadline ?? Infinity, token.startedAt + ttl);
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 86_400_000 || !Number.isFinite(deadline)) {
      if (previous) previous.content = null;
    } else {
      this.entries.set(key(view), {
        deadline,
        content: view.contentAvailable && deadline > this.now()
          ? { customerPhone: view.customerPhone, lastMessage: view.lastMessage }
          : null,
      });
    }
    return metadata;
  }

  view(metadata: PlatformWhatsAppConversationView): PlatformWhatsAppConversationView {
    this.expire();
    const content = this.entries.get(key(metadata))?.content;
    return content ? { ...metadata, ...content, contentAvailable: true } : sanitize(metadata);
  }

  expire() {
    const now = this.now();
    for (const entry of this.entries.values()) if (entry.deadline <= now) entry.content = null;
  }

  nextDelay(): number | null {
    this.expire();
    const deadlines = [...this.entries.values()].filter(entry => entry.content !== null).map(entry => entry.deadline);
    return deadlines.length ? Math.max(0, Math.min(...deadlines) - this.now()) : null;
  }

  clear() {
    this.epoch++;
    for (const entry of this.entries.values()) entry.content = null;
  }
}
