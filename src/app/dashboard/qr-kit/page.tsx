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
  if (!business?.slug || !business.sarinConfig.onboardingCompleted)
    return (
      <Notice>
        Configura primero tu negocio en{" "}
        <Link
          href="/dashboard/onboarding"
          className="text-sarin-blue underline"
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
    <section className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-sarin-line bg-sarin-paper p-5 text-center sm:p-10">
      <p className="text-xs uppercase tracking-widest text-sarin-blue">
        Enlace de tu negocio
      </p>
      <h1 className="break-words text-3xl font-semibold tracking-tight">{business.name}</h1>
      <p className="mx-auto max-w-md text-sm leading-relaxed text-sarin-muted">
        Descarga el QR para imprimirlo en tu local o comparte el enlace para que
        tus clientes reserven contigo.
      </p>
      {origin && (
        <div className="mx-auto w-full max-w-[272px] rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-6" ref={qr}>
          <QRCodeSVG
            value={url}
            size={224}
            className="h-auto w-full"
            level="M"
            marginSize={2}
            title={`Agenda de ${business.name}`}
          />
        </div>
      )}
      <p className="break-all tabular-nums text-sm text-sarin-ink">{url}</p>
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
          className="flex min-h-11 items-center gap-2 rounded-[10px] border border-sarin-line px-4 py-2.5 text-sm text-sarin-ink hover:bg-sarin-soft"
          onClick={() => void copy()}
        >
          <Copy className="h-4 w-4" />
          Copiar enlace
        </button>
        <Link
          className="flex min-h-11 items-center gap-2 rounded-[10px] border border-sarin-line px-4 py-2.5 text-sm text-sarin-ink hover:bg-sarin-soft"
          href={`/b/${business.slug}`}
        >
          <ExternalLink className="h-4 w-4" />
          Abrir página del negocio
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
