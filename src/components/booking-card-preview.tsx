"use client";

import { useEffect, useState } from 'react';
type Assets = { png: Blob; pdf: Blob; qrSvg: Blob };
export function BookingCardPreview({ assets, businessName, filenameStem, qrFilename }: { assets: Assets | null; businessName: string; filenameStem: string; qrFilename: string }) {
  const [state, setState] = useState<{ assets: Assets; png: string; pdf: string; qrSvg: string } | null>(null);
  useEffect(() => {
    if (!assets) { setState(null); return; }
    const next = { assets, png: URL.createObjectURL(assets.png), pdf: URL.createObjectURL(assets.pdf), qrSvg: URL.createObjectURL(assets.qrSvg) };
    setState(next);
    return () => { URL.revokeObjectURL(next.png); URL.revokeObjectURL(next.pdf); URL.revokeObjectURL(next.qrSvg); };
  }, [assets]);
  const urls = state?.assets === assets ? state : null;
  if (!urls) return <p className="text-sm text-sarin-muted">Prepara la tarjeta para revisar y descargar tus archivos.</p>;
  return <div className="space-y-4"><img src={urls.png} alt={`Tarjeta Agenda clara de ${businessName}`} width={1241} height={1749} className="mx-auto h-auto w-full max-w-xs border border-sarin-line" /><div className="flex flex-wrap justify-center gap-4 text-sm font-semibold text-sarin-blue"><a className="inline-flex min-h-11 items-center underline" href={urls.pdf} target="_blank" rel="noopener noreferrer">Ver PDF</a><a className="inline-flex min-h-11 items-center underline" href={urls.pdf} download={`${filenameStem}.pdf`}>Descargar PDF</a><a className="inline-flex min-h-11 items-center underline" href={urls.png} download={`${filenameStem}.png`}>Descargar PNG</a><a className="inline-flex min-h-11 items-center underline" href={urls.qrSvg} download={qrFilename}>Descargar QR SVG</a></div></div>;
}
