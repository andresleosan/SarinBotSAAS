import 'server-only';
import type { Database } from '@/lib/storage/types';
import { readPublicCommercialOffer } from './commercial-offer';
import { workExact, workObject, workText } from '../../../shared/platform-whatsapp-work';
export const PLATFORM_SCOPE_REFUSAL = 'Solo puedo explicar el soporte público y los planes de SarinBot. No puedo consultar pagos, cuentas ni datos privados. Puedes pedir atención humana.';
export async function readPlatformSupportKnowledge(db: Database) {
  const offer = await readPublicCommercialOffer(db);
  return Object.freeze([
    Object.freeze({ id: 'sarin.support.v1', text: 'SarinBot ofrece soporte sobre el servicio comercial de citas. En Ayuda puedes vincular tu cuenta y revisar los permisos de soporte. Puedes solicitar atención humana.' }),
    Object.freeze({ id: 'sarin.audio.v1', text: 'Puedes enviar notas de voz de hasta dos minutos. El audio bruto se procesa en memoria y no se conserva en R2 ni en la bandeja. La transcripción es contenido de una consulta. Nunca prueba identidad, acepta documentos ni autoriza un pago.' }),
    Object.freeze({ id: 'sarin.privacy.v1', text: 'El soporte público no consulta pagos ni datos privados. El contenido cifrado se conserva hasta 24 horas y los controles mínimos hasta 30 días. SALIR detiene el soporte automático de la conversación.' }),
    Object.freeze({ id: 'sarin.offer.v1', text: JSON.stringify(offer) }),
  ]);
}
export function validatePlatformSupportOutput(raw: string, sources: readonly { id: string }[]): { reply: string; sourceIds: string[] } | null {
  let v: unknown; try { v = JSON.parse(raw); } catch { return null; }
  if (!workObject(v) || !workExact(v, ['reply', 'sourceIds']) || !workText(v.reply, 'reply') || /<[^>]*>|https?:|www\.|\b(?:tool_calls|function_call)\b/i.test(v.reply) || !Array.isArray(v.sourceIds) || v.sourceIds.length > 12 || new Set(v.sourceIds).size !== v.sourceIds.length || v.sourceIds.some(id => typeof id !== 'string' || !sources.some(s => s.id === id)) || !v.sourceIds.length && v.reply !== PLATFORM_SCOPE_REFUSAL) return null;
  if (/\b(?:he (?:pagado|cobrado|transferido|cancelado|confirmado)|pago (?:confirmado|aprobado)|tu (?:saldo|cuenta bancaria)|tus pagos)\b/i.test(v.reply)) return null;
  return { reply: v.reply, sourceIds: v.sourceIds as string[] };
}
