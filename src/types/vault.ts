export interface VaultAttachment { id: string; name: string; dataUrl: string }
export interface VaultMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  attachments: VaultAttachment[];
}
export interface FinancialEntry {
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: string | null;
  kind: 'expense' | 'income';
}
export interface VaultReminder { title: string; date: string; time: string; notes: string }
export interface VaultAnalysis { entries: FinancialEntry[]; reminders: VaultReminder[] }
export interface FinancialTotal { currency: string; income: number; expense: number; balance: number }
export interface VaultChatResponse { message: string; analysis: VaultAnalysis; totals: FinancialTotal[] }
export interface VaultThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: VaultMessage[];
  entries: (FinancialEntry & { id: string })[];
  reminders: (VaultReminder & { id: string })[];
}
export interface VaultBackup {
  format: 'sarin-vault';
  version: 1;
  exportedAt: string;
  threads: VaultThread[];
}
