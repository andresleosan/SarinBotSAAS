export interface PlatformWhatsAppBudgetView {
  configured: boolean;
  version: number;
  dayUsd: number;
  monthUsd: number;
  timezone: 'UTC';
  day: string;
  month: string;
  usage: { day: { usedMicros: number; heldMicros: number; blocked: boolean }; month: { usedMicros: number; heldMicros: number; blocked: boolean } };
}
