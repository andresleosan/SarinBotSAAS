import type { Tenant, Appointment } from '@/types/firestore';

export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isTimeString(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function toMinutes(value: string): number {
  if (!isTimeString(value)) throw new RangeError('Hora inválida; usa HH:mm.');
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function toTimeStr(minutes: number): string {
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}

// Colombia uses UTC-05:00. Never interpret bookings in the host timezone.
export function toColombiaTimestamp(dateKey: string, time: string): number {
  if (!isDateKey(dateKey) || !isTimeString(time)) throw new RangeError('Fecha u hora inválida.');
  return Date.parse(`${dateKey}T${time}:00-05:00`);
}

export function getAvailableSlots(params: {
  tenant: Tenant;
  dateKey: string; // "YYYY-MM-DD"
  serviceId: string;
  resourceId?: string;
  existingAppointments: Appointment[];
  stepMinutes?: number;
  now?: number;
}): { resourceId: string; resourceName: string; slots: string[] }[] {
  const { tenant, dateKey, serviceId, resourceId, existingAppointments, stepMinutes = 15, now = Date.now() } = params;
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
    const resourceApts = existingAppointments.filter(
      (a) => a.resourceId === resource.id && a.dateKey === dateKey && a.status === 'confirmed' && (!a.tenantId || a.tenantId === tenant.id)
    );

    const validSlots: string[] = [];

    for (const interval of daySchedule.intervals) {
      const startMin = toMinutes(interval.start);
      const endMin = toMinutes(interval.end);

      for (let cursor = startMin; cursor + totalBlockNeeded <= endMin; cursor += stepMinutes) {
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
