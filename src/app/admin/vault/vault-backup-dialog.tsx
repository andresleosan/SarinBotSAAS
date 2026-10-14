'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X, Download, Upload, LockKeyhole, LoaderCircle } from 'lucide-react';
import { VaultDatabase } from '@/lib/vault/localDb';
import { decodeVaultBackup, encodeVaultBackup } from '@/lib/vault/exportCrypto';
import { MAX_IMPORT_BYTES } from '@/lib/vault/schema';
import { errorMessage } from '@/lib/client/api';

export function VaultBackupDialog({ db, mode, onClose, onImported }: {
  db: VaultDatabase; mode: 'export' | 'import'; onClose: () => void; onImported: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [encrypt, setEncrypt] = useState(true);
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (mode === 'export') {
        if (encrypt && password.length < 12) throw new Error('Usa una contraseña de al menos 12 caracteres.');
        const text = await encodeVaultBackup(await db.exportBackup(), encrypt ? password : undefined);
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = `sarin-vault-${new Date().toISOString().slice(0, 10)}${encrypt ? '-cifrado' : ''}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        if (!file) throw new Error('Selecciona una copia de Sarin Vault.');
        if (file.size > MAX_IMPORT_BYTES) throw new Error('La copia supera 72 MB.');
        const backup = await decodeVaultBackup(await file.text(), password || undefined);
        await db.importBackup(backup);
        await onImported();
      }
      onClose();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-md min-w-0 rounded-2xl border border-sarin-line bg-sarin-paper p-5 font-sans text-sarin-ink shadow-2xl shadow-sarin-ink/15 [color-scheme:light] sm:p-6 backdrop:bg-sarin-ink/45">
    <form onSubmit={event => void submit(event)} className="space-y-5">
      <div className="flex items-start justify-between gap-4"><div><LockKeyhole className="mb-3 h-6 w-6 text-sarin-blue" /><h2 className="text-xl font-semibold">{mode === 'export' ? 'Exportar bóveda' : 'Importar copia'}</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label="Cerrar" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-sarin-soft disabled:opacity-40"><X className="h-5 w-5" /></button></div>
      <p className="text-sm leading-relaxed text-sarin-muted">{mode === 'export' ? 'Descarga tus conversaciones, imágenes, cuentas y recordatorios en un solo archivo.' : 'La copia se agrega a este dispositivo. Tus conversaciones actuales se conservan.'}</p>
      {mode === 'export' ? <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={encrypt} onChange={event => setEncrypt(event.target.checked)} className="accent-sarin-blue" />Proteger con contraseña</label> : <label className="block space-y-2 text-sm"><span>Archivo JSON de Sarin Vault</span><input type="file" accept=".json,application/json" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-sarin-soft file:px-3 file:py-3 file:text-sarin-ink" /></label>}
      {(mode === 'import' || encrypt) && <label className="block space-y-2 text-sm"><span>{mode === 'import' ? 'Contraseña, si la copia está cifrada' : 'Contraseña de al menos 12 caracteres'}</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} maxLength={1024} minLength={mode === 'export' && encrypt ? 12 : undefined} required={mode === 'export' && encrypt} autoComplete={mode === 'export' ? 'new-password' : 'current-password'} disabled={busy} className="w-full rounded-xl border border-sarin-line bg-sarin-canvas px-3 py-3 text-sarin-ink outline-none focus:border-sarin-blue focus:ring-2 focus:ring-sarin-blue/15" /></label>}
      <p className="text-xs leading-relaxed text-sarin-muted">{mode === 'export' && encrypt ? 'Conserva la contraseña: no se puede recuperar. El cifrado se realiza en este dispositivo.' : mode === 'export' ? 'El archivo contiene tus datos legibles. Guárdalo en un lugar privado.' : 'La validación y la importación se realizan en este dispositivo.'}</p>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <button disabled={busy || (mode === 'import' && !file)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sarin-blue px-4 py-3 font-semibold text-white hover:bg-sarin-blue/95 disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : mode === 'export' ? <Download className="h-4 w-4" /> : <Upload className="h-4 w-4" />}{busy ? 'Procesando…' : mode === 'export' ? 'Descargar copia' : 'Importar copia'}</button>
    </form>
  </dialog>;
}
