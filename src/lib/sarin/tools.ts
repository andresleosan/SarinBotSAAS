import 'server-only';
import { z } from 'zod';
import type { ToolDefinition } from './engine';
import { availabilitySchema, bookingSchema, businessConfigSchema, dateKeySchema, documentIdSchema, timeSchema } from '@/lib/server/schemas';

export const escalationSchema = z.object({ resumenDuda: z.string().trim().min(1).max(600) }).strict();
export const ownerBlockToolSchema = z.object({ dateKey: dateKeySchema, startTimeStr: timeSchema, endTimeStr: timeSchema, resourceId: documentIdSchema, motivo: z.string().max(300).optional() }).strict().refine((input) => input.startTimeStr < input.endTimeStr);
export const summarySchema = z.object({ dateKey: dateKeySchema }).strict();

function tool(name: string, description: string, schema: z.ZodType): ToolDefinition {
  return { type: 'function', function: { name, description, parameters: z.toJSONSchema(schema) } };
}

export const SARIN_ONBOARDING_TOOLS: readonly ToolDefinition[] = [
  tool('guardar_estructura_negocio', 'Guarda configuración completa con horarios, servicios, recursos, teléfono y enlace. Requiere pago aprobado; guardar o editar conserva la suscripción y las citas consumidas de la prueba pagada.', businessConfigSchema),
];
export const SARIN_CLIENT_TOOLS: readonly ToolDefinition[] = [
  tool('consultar_disponibilidad', 'Consulta horarios reales disponibles para una fecha y servicio. Consulta antes de ofrecer o confirmar una hora.', availabilitySchema),
  tool('crear_cita', 'Reserva de forma atómica una cita que el cliente haya solicitado y confirmado, con sus datos obligatorios. Un conflicto significa que NO quedó reservada.', bookingSchema),
  tool('escalar_a_humano', 'Genera un enlace de WhatsApp del negocio cuando hace falta atención humana.', escalationSchema),
];
export const SARIN_COPILOT_TOOLS: readonly ToolDefinition[] = [
  ...SARIN_CLIENT_TOOLS,
  tool('bloquear_horario', 'Bloquea horas futuras libres de un recurso. No reemplaza ni mueve citas existentes.', ownerBlockToolSchema),
  tool('resumen_agenda_dia', 'Consulta citas e ingresos estimados del día en el negocio del dueño autenticado.', summarySchema),
];
