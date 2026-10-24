import type { Tenant, Appointment } from '@/types/firestore';
import { resolveResourceDaySchedule, type ResourceSchedulePolicy } from '@/lib/resource-schedules';
import { isDateKey, toMinutes, toTimeStr, toColombiaTimestamp } from '@/lib/sarin/calendar-time';
export { isDateKey, isTimeString, toMinutes, toTimeStr, toColombiaTimestamp } from '@/lib/sarin/calendar-time';

export function getAvailableSlots(params: {
  tenant: Tenant;
  resourceSchedulePolicy: ResourceSchedulePolicy;
  dateKey: string; // "YYYY-MM-DD"
  serviceId: string;
  resourceId?: string;
  existingAppointments: Appointment[];
  stepMinutes?: number;
  now?: number;
}): { resourceId: string; resourceName: string; slots: string[] }[] {
  const { tenant, dateKey, serviceId, resourceId, existingAppointments, stepMinutes = 15, now = Date.now() } = params;
  if (params.resourceSchedulePolicy.businessId !== tenant.id) throw new RangeError('El horario no corresponde a este negocio.');
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1 || stepMinutes > 1440) throw new RangeError('El intervalo de agenda debe ser un entero positivo.');
  if (!isDateKey(dateKey)) return [];
  const service = tenant.services.find((s) => s.id === serviceId);
  if (!service || !Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0 || service.bufferMinutes < 0) return [];
  const dayOfWeek = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  const daySchedule = tenant.weeklySchedule[dayOfWeek];

  if (!daySchedule || !daySchedule.isOpen) return [];

  const totalBlockNeeded = service.durationMinutes + (service.bufferMinutes || 0);

  const candidateResources = tenant.resources.filter(
    (r) => r.active && service.resourceIds.includes(r.id) && (!resourceId || r.id === resourceId)
  );

  return candidateResources.map((resource) => {
    const effectiveDay = resolveResourceDaySchedule({ business: tenant, policy: params.resourceSchedulePolicy, resourceId: resource.id, dateKey });
    const resourceApts = existingAppointments.filter(
      (a) => a.resourceId === resource.id && a.dateKey === dateKey && a.status === 'confirmed' && (!a.tenantId || a.tenantId === tenant.id)
    );

    const validSlots: string[] = [];

    for (const interval of daySchedule.intervals) {
      const startMin = toMinutes(interval.start);
      const endMin = toMinutes(interval.end);

      for (let cursor = startMin; cursor + totalBlockNeeded <= endMin; cursor += stepMinutes) {
        if (!effectiveDay.intervals.some(item => cursor >= toMinutes(item.start) && cursor + totalBlockNeeded <= toMinutes(item.end))) continue;
        const candidateStart = toColombiaTimestamp(dateKey, toTimeStr(cursor));
        const candidateEnd = candidateStart + totalBlockNeeded * 60000;
        if (candidateStart <= now) continue;

        const hasOverlap = resourceApts.some((apt) => {
          const aptStart = apt.startAt || toColombiaTimestamp(dateKey, apt.startTimeStr);
          const serviceBuffer = tenant.services.find((candidate) => candidate.id === apt.serviceId)?.bufferMinutes ?? 0;
          const aptEnd = apt.reservedUntilAt ?? ((apt.endAt || toColombiaTimestamp(dateKey, apt.endTimeStr)) + serviceBuffer * 60000);
          return candidateStart < aptEnd && candidateEnd > aptStart;
        });

        if (!hasOverlap) {
          validSlots.push(toTimeStr(cursor));
        }
      }
    }

    return {
      resourceId: resource.id,
      resourceName: resource.name,
      slots: [...new Set(validSlots)].sort(),
    };
  });
}
