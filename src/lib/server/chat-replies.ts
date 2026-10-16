import 'server-only';
import type { ChatResponse } from '@/types/chat';
import type { Appointment, Business } from '@/types/firestore';
import type { ChatIntent } from './chat-intent';
export const OUT_OF_SCOPE_REPLY = 'Puedo ayudarte con los servicios, horarios y citas de este negocio. ¿Qué necesitas reservar o consultar?';
const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
export function renderChatReply({ intent, business, data }: { intent: ChatIntent; business: Business; data: Record<string, unknown> }): ChatResponse {
  const service = business.services.find(item => item.id === data.serviceId);
  let reply: string;
  switch (intent) {
    case 'out_of_scope': reply = OUT_OF_SCOPE_REPLY; break;
    case 'services': reply = business.services.length ? `Servicios de ${business.name}:\n${business.services.map(item => `${item.name}: ${money(item.price)} · ${item.durationMinutes} minutos.`).join('\n')}` : 'El negocio todavía no ha publicado sus servicios. Completa el catálogo en Mi negocio.'; break;
    case 'price': reply = service ? `${service.name}: ${money(service.price)} · ${service.durationMinutes} minutos.` : '¿De qué servicio quieres conocer el precio?'; break;
    case 'contact': reply = business.phoneWhatsApp ? `Puedes contactar a ${business.name} en ${business.phoneWhatsApp}.` : 'El negocio todavía no ha publicado un teléfono de contacto.'; break;
    case 'location': reply = `El negocio no ha publicado una dirección en Sarin.${business.phoneWhatsApp ? ` Consulta la ubicación en ${business.phoneWhatsApp}.` : ' Contacta al negocio para confirmar la ubicación.'}`; break;
    case 'hours': reply = `Horario de Colombia:\n${Object.entries(business.weeklySchedule).map(([day, schedule]) => `${['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][Number(day)]}: ${schedule.isOpen ? schedule.intervals.map(interval => `${interval.start}–${interval.end}`).join(', ') : 'Cerrado'}`).join('\n')}`; break;
    case 'availability': {
      const availability = data.availability as { resourceName: string; slots: string[] }[] | undefined;
      reply = availability?.some(item => item.slots.length) ? `Disponibilidad para ${String(data.dateKey)} (Colombia):\n${availability.map(item => `${item.resourceName}: ${item.slots.join(', ') || 'Sin horas libres'}`).join('\n')}\nElige una hora para preparar la reserva.` : data.dateKey ? 'No hay horas libres para esa selección. Prueba otra fecha o profesional.' : 'Indica el servicio y la fecha que quieres consultar.';
      break;
    }
    case 'booking': reply = 'Para preparar tu reserva necesito servicio, profesional, fecha y hora. La cita se agenda al revisar el resumen y pulsar Confirmar cita.'; break;
    case 'own_appointments': case 'owner_agenda': {
      const appointments = data.appointments as Appointment[] | undefined;
      reply = appointments?.length ? appointments.map(item => `${item.serviceName} · ${item.dateKey} ${item.startTimeStr}–${item.endTimeStr} · ${item.status === 'confirmed' ? 'Activa' : 'Cancelada'}`).join('\n') : 'No hay citas para esta consulta. Puedes revisar próximas e historial en la agenda.';
      break;
    }
    case 'owner_usage': reply = typeof data.remainingResponses === 'number' ? `Respuestas de IA disponibles: ${data.remainingResponses}. Revisa Suscripción para ver tu consumo y vigencia.` : 'Consulta tu consumo y vigencia en Suscripción.'; break;
    case 'owner_block': reply = 'Para bloquear horarios o cancelar citas, utiliza los controles de Mi agenda. Revisa fecha, profesional y horario antes de guardar.'; break;
    case 'configure_business': reply = data.hasDraft ? 'Preparé una propuesta para el formulario. Pulsa Usar propuesta, revisa todos los datos y luego Guarda la configuración.' : 'Describe los datos completos de tu negocio o completa el formulario. Los cambios se guardan únicamente con Guardar configuración.'; break;
    default: reply = '¿Quieres consultar servicios, precios, horarios o preparar una cita? Indica el servicio y la fecha si deseas reservar.';
  }
  return { reply };
}
