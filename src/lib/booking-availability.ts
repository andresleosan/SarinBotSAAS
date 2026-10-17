/** Shared read-only availability contract; booking still requires explicit confirmation. */
export const NEXT_AVAILABILITY_DAYS = 14;

export type AvailabilitySlots = { resourceId: string; resourceName: string; slots: string[] }[];

export type NextAvailabilityResult = {
  dateKey: string | null;
  availability: AvailabilitySlots;
  fromDateKey: string;
  throughDateKey: string;
};
