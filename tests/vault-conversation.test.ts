import { describe, expect, it } from 'vitest';
import { buildVaultRequest } from '../src/lib/vault/conversation';
import type { VaultMessage } from '../src/types/vault';

describe('bounded Vault context', () => {
  it('keeps the latest user request and the four most recent attachments', () => {
    const messages: VaultMessage[] = Array.from({ length: 30 }, (_, index) => ({
      id: `${index}`, role: 'user', content: `Texto ${index}`, createdAt: index,
      attachments: [{ id: `${index}`, name: `factura-${index}`, dataUrl: 'data:image/webp;base64,UklGRgQAAABXRUJQ' }],
    }));
    const request = buildVaultRequest(messages);
    expect(request.messages).toHaveLength(24);
    expect(request.messages.at(-1)?.content).toBe('Texto 29');
    expect(request.messages.flatMap(message => message.attachments.map(image => image.name))).toEqual(['factura-26', 'factura-27', 'factura-28', 'factura-29']);
    expect(request.messages[0]).not.toHaveProperty('createdAt');
  });
  it('bounds older text while preserving the current question', () => {
    const messages: VaultMessage[] = Array.from({ length: 24 }, (_, index) => ({ id: `${index}`, role: index === 23 ? 'user' : 'assistant', content: `${index}`.repeat(16000), createdAt: index, attachments: [] }));
    const request = buildVaultRequest(messages);
    expect(request.messages.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(96_000);
    expect(request.messages.at(-1)?.role).toBe('user');
    expect(request.messages.at(-1)?.content).toHaveLength(16_000);
  });
});
