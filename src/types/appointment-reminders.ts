export type ReminderOccurrence = { appointmentId: string; sourceRevision: number; sourceStartAt: number; offsetMinutes: 1440 };
export type AppointmentReminder = ReminderOccurrence & { availableAt: number; seenAt: number | null };
export type ReminderPreference = { enabled: boolean; revision: number; status: 'disabled' | 'active' | 'suspended'; offsetMinutes: 1440 };
export type AppointmentReminders = { businessId: string; ownerUid: string; serverNow: number; preference: ReminderPreference; reminders: AppointmentReminder[] };
