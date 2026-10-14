"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Download, ExternalLink } from "lucide-react";
import { AuthGate } from "@/components/auth-provider";
import { AppShell, Notice, buttonClass } from "@/components/app-shell";
import { useBusiness } from "@/hooks/useBusiness";
import { errorMessage } from "@/lib/client/api";

function QRKit() {
  const { business, loading, error } = useBusiness();
  const [origin, setOrigin] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const qr = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  if (loading) return <Notice>Cargando tu isla…</Notice>;
  if (error) return <Notice error>{error}</Notice>;
  if (!business)
    return (
      <Notice>
        Configura primero tu negocio en{" "}
        <Link
          href="/dashboard/onboarding"
          className="text-emerald-300 underline"
        >
          Configuración
        </Link>
        .
      </Notice>
    );
  const url = `${origin}/b/${business.slug}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Enlace copiado.");
    } catch (cause) {
      setNotice(errorMessage(cause));
    }
  }
  function download() {
    const svg = qr.current?.querySelector("svg");
    if (!svg) return;
    const image = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(image);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `sarin-qr-${business!.slug}.svg`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  return (
    <section className="mx-auto max-w-3xl space-y-6 rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center sm:p-10">
      <p className="text-xs uppercase tracking-widest text-emerald-400">
        Kit de tu isla privada
      </p>
      <h1 className="text-3xl font-bold">{business.name}</h1>
      <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-400">
        Descarga el QR para imprimirlo en tu local o comparte el enlace para que
        tus clientes reserven contigo.
      </p>
      {origin && (
        <div className="mx-auto w-fit rounded-2xl bg-white p-6" ref={qr}>
          <QRCodeSVG
            value={url}
            size={224}
            level="M"
            marginSize={2}
            title={`Agenda de ${business.name}`}
          />
        </div>
      )}
      <p className="break-all font-mono text-sm text-slate-300">{url}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          className={buttonClass + " flex items-center gap-2"}
          disabled={!origin}
          onClick={download}
        >
          <Download className="h-4 w-4" />
          Descargar QR
        </button>
        <button
          className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm hover:bg-slate-800"
          onClick={() => void copy()}
        >
          <Copy className="h-4 w-4" />
          Copiar enlace
        </button>
        <Link
          className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm hover:bg-slate-800"
          href={`/b/${business.slug}`}
        >
          <ExternalLink className="h-4 w-4" />
          Abrir isla
        </Link>
      </div>
      {notice && <Notice>{notice}</Notice>}
    </section>
  );
}
export default function QRKitPage() {
  return (
    <AuthGate>
      <AppShell>
        <QRKit />
      </AppShell>
    </AuthGate>
  );
}
