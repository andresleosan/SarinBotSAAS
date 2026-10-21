import Image from "next/image";

export function SarinMark({ className = "h-6 w-6" }: { className?: string }) {
  return <Image src="/brand/sarin-face-mark.png" alt="" width={40} height={40} className={`shrink-0 object-contain ${className}`} />;
}

export function SarinBrand({ compact = false }: { compact?: boolean }) {
  return <span className="inline-flex items-center gap-2 sm:gap-3">
    <SarinMark className="h-9 w-9 sm:h-10 sm:w-10" />
    <span className="whitespace-nowrap text-xl font-semibold leading-none tracking-[-0.05em] text-sarin-ink sm:text-[23px]">Sarin<span className="text-sarin-blue">Bot</span>{!compact && <span className="mt-1.5 block text-xs font-normal tracking-normal text-sarin-muted">Tu agenda, en orden</span>}</span>
  </span>;
}
