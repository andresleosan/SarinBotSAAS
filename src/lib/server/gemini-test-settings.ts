import 'server-only';
import type { AiTestProfileStatus } from '@/types/ai';

/** Informational profile only. No network, storage or production credential fallback. */
export function getGeminiTestProfileStatus(): AiTestProfileStatus {
  const unavailable = (error: string): AiTestProfileStatus => ({ configured: false, model: null, connection: 'not_checked', error });
  const key = process.env.GEMINI_TEST_API_KEY;
  if (!key || !/^[\x21-\x7e]+$/.test(key)) return unavailable('Configura una clave válida de Gemini para pruebas en el servidor.');
  if (key === process.env.GEMINI_API_KEY) return unavailable('La clave de Gemini para pruebas debe ser distinta de la clave para clientes.');
  const model = process.env.GEMINI_TEST_MODEL ?? 'gemini-3.5-flash-lite';
  if (model !== 'gemini-3.5-flash-lite') return unavailable('El modelo configurado de Gemini para pruebas no está habilitado.');
  // Different key bytes do not establish different Google projects or billing.
  return { configured: true, model, connection: 'not_checked' };
}
