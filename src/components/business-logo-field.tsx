"use client";

import { useEffect, useRef, useState } from 'react';
import type { Business } from '@/types/firestore';
import { apiFetch, errorMessage } from '@/lib/client/api';
import { Notice, buttonClass } from '@/components/app-shell';

export function BusinessLogoField(props: { business: Business; onSaved: (business: Business) => void }) {
  return <LogoField key={`${props.business.ownerUid}:${props.business.id}`} {...props} />;
}
function LogoField({ business, onSaved }: { business: Business; onSaved: (business: Business) => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const reader = useRef<FileReader | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); reader.current?.abort(); }; }, []);
  async function select(file: File | undefined) {
    if (!file || busy) return;
    setImage(null); setError(null); setNotice(null);
    if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Usa PNG, JPEG o WebP estático de hasta 2 MiB.'); return; }
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const current = new FileReader(); reader.current = current;
        current.onload = () => typeof current.result === 'string' ? resolve(current.result) : reject(new Error('No pudimos leer el logo.'));
        current.onerror = () => reject(new Error('No pudimos leer el logo.'));
        current.onabort = () => reject(new DOMException('Solicitud cancelada.', 'AbortError'));
        current.readAsDataURL(file);
      });
      if (active.current) setImage(dataUrl);
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { reader.current = null; if (active.current) setBusy(false); }
  }
  async function save(logoDataUrl: string | null) {
    if (busy || changed) return;
    setBusy(true); setError(null); setNotice(null);
    controller.current = new AbortController();
    try {
      const result = await apiFetch<{ business: Business }>('/api/businesses/logo', { method: 'POST', signal: controller.current.signal, body: JSON.stringify({ logoDataUrl, expectedSha256: business.logo?.sha256 ?? null }) });
      if (!active.current) return;
      if (result.business.id !== business.id || result.business.ownerUid !== business.ownerUid) throw new Error('No pudimos validar el negocio.');
      onSaved(result.business); setImage(null); setNotice(logoDataUrl ? 'Logo guardado.' : 'Logo eliminado.');
    } catch (cause) {
      if (!active.current) return;
      setError(errorMessage(cause));
      if (cause instanceof Error && 'code' in cause && cause.code === 'BRANDING_CHANGED') setChanged(true);
    } finally { if (active.current) setBusy(false); }
  }
  async function refresh() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await apiFetch<{ business: Business | null }>('/api/businesses');
      if (!active.current) return;
      if (!result.business || result.business.id !== business.id || result.business.ownerUid !== business.ownerUid) throw new Error('No pudimos validar el negocio.');
      onSaved(result.business); setChanged(false);
    } catch (cause) { if (active.current) setError(errorMessage(cause)); }
    finally { if (active.current) setBusy(false); }
  }
  return <section aria-label="Logo del negocio" className="space-y-3 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5"><h2 className="text-lg font-semibold">Logo del negocio</h2><p className="text-sm text-sarin-muted">Aparece en tu perfil y tarjeta de reservas. Tu foto personal de Google se conserva.</p>
    {business.logo && business.slug && <img src={`/api/public/businesses/${business.slug}/logo/${business.logo.sha256}`} alt={`Logo de ${business.name}`} width={96} height={96} className="h-24 w-24 rounded-xl border border-sarin-line object-contain" />}
    <label className="block text-sm">Elegir logo<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => void select(event.target.files?.[0])} className="mt-2 block w-full min-w-0 text-sm file:mr-3 file:rounded-lg file:border file:border-sarin-line file:bg-sarin-soft file:p-2" /></label>
    <p className="text-xs text-sarin-muted">PNG, JPEG o WebP estático, máximo 2 MiB. Se ajusta sin recortar; no admite animaciones.</p>
    <div className="flex flex-wrap gap-4"><button type="button" disabled={busy || !image || changed} onClick={() => save(image)} className={buttonClass}>Guardar logo</button><button type="button" disabled={busy || !business.logo || changed} onClick={() => save(null)} className="min-h-11 text-sm text-sarin-muted">Eliminar logo</button>{changed && <button type="button" disabled={busy} onClick={() => refresh()} className="min-h-11 font-semibold text-sarin-blue">Actualizar logo</button>}</div>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
  </section>;
}
