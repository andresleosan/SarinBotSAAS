import { generateICSFileContent } from '@/lib/utils/icsGenerator';

export interface AppointmentCalendarDetails {
  businessId: string;
  appointmentId: string;
  businessName: string;
  serviceName: string;
  resourceName?: string;
  startAt: number;
  endAt: number;
}

/** Only display fields leave the app; identity fields are used solely for a stable event hash. */
export async function createAppointmentCalendar(details: AppointmentCalendarDetails): Promise<string> {
  if ([details.businessId, details.appointmentId].some(value => typeof value !== 'string' || !value.trim())) throw new Error('No pudimos identificar la cita para el calendario.');
  const bytes = new TextEncoder().encode(JSON.stringify([details.businessId, details.appointmentId]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return generateICSFileContent({
    businessName: details.businessName,
    serviceName: details.serviceName,
    resourceName: details.resourceName,
    startAt: details.startAt,
    endAt: details.endAt,
    uid: `${hash}@alsdevstudio.com`,
  });
}
