import 'server-only';
import { createHash } from 'node:crypto';
import type { Database, Transaction } from '@/lib/storage/types';
import { isWorkRecordAtPath, type WorkRecord } from '../../../shared/platform-whatsapp-work';
import { platformWhatsAppUnavailableError } from './platform-whatsapp-store';
import { HttpError } from './http';

export const workHash = (domain: string, ...parts: unknown[]) => createHash('sha256').update(JSON.stringify(['sarin/platform-whatsapp', 1, domain, ...parts])).digest('hex');
export function workRef(db: Database, path: string) { const [root, id, extra] = path.split('/'); if (!root || !id || extra) throw platformWhatsAppUnavailableError(); return db.collection(root).doc(id); }
export async function readWork(tx: Transaction, db: Database, path: string): Promise<WorkRecord | null> {
  const v = (await tx.get(workRef(db, path))).data();
  if (v === undefined) return null;
  if (!isWorkRecordAtPath(path, v)) throw new HttpError(503, 'El registro de trabajo no está disponible.', 'PLATFORM_WORK_CORRUPT');
  return v;
}
export function stageWork(tx: Transaction, db: Database, path: string, v: WorkRecord): void {
  if (!isWorkRecordAtPath(path, v)) throw platformWhatsAppUnavailableError();
  tx.set(workRef(db, path), v);
}
export function checkedAdd(...values: number[]) { let result = 0; for (const v of values) { if (!Number.isSafeInteger(v) || v < 0 || !Number.isSafeInteger(result + v)) throw platformWhatsAppUnavailableError(); result += v; } return result; }
