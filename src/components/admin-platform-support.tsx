"use client";
import { useEffect, useState } from 'react';
import { PlatformSupportChat } from '@/components/platform-support-chat';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function AdminPlatformSupport({ initialThread }: { initialThread?: string | null }) {
  const [open, setOpen] = useState(false);
  const thread = initialThread && uuid.test(initialThread) ? initialThread : null;
  useEffect(() => { if (thread) setOpen(true); }, [thread]);
  return <section id="soporte-web" aria-label="Soporte web privado" className="min-w-0 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-6"><h2 className="text-xl font-semibold">Soporte web privado</h2><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="min-h-11 py-2 text-sarin-blue underline">{open ? 'Cerrar soporte web y borrar esta vista' : 'Abrir soporte web'}</button>{open && <PlatformSupportChat admin initialThread={thread} />}</section>;
}
