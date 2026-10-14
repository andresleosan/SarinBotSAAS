import type { VaultMessage } from '@/types/vault';

/** Send recent context only; never send local IDs, timestamps, or the whole database. */
export function buildVaultRequest(messages: readonly VaultMessage[]) {
  let imageBudget = 4;
  let characterBudget = 96_000;
  const recent = [];
  for (const message of messages.slice(-24).reverse()) {
    if (characterBudget <= 0) break;
    const content = message.content.slice(0, Math.min(16_000, characterBudget));
    characterBudget -= content.length;
    const attachments = imageBudget > 0 ? message.attachments.slice(-imageBudget).map(({ name, dataUrl }) => ({ name, dataUrl })) : [];
    imageBudget -= attachments.length;
    if (content || attachments.length) recent.push({ role: message.role, content, attachments });
  }
  return { messages: recent.reverse() };
}
