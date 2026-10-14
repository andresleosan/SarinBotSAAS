export function SarinMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path d="M10 9h12a5 5 0 0 1 5 5v12H5V14a5 5 0 0 1 5-5ZM16 4v5M11 16v3m10-3v3m-9 4h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="3" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function SarinBrand({ compact = false }: { compact?: boolean }) {
  return <span className="inline-flex items-center gap-2 sm:gap-3">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-emerald-500/25 bg-emerald-500/8 text-emerald-500 sm:h-10 sm:w-10"><SarinMark /></span>
    <span className="whitespace-nowrap font-display text-xl font-semibold leading-none tracking-[-0.05em] sm:text-[23px]">Sarin<span className="text-emerald-500"> Bot</span>{!compact && <span className="mt-1.5 block font-mono text-[9px] font-normal tracking-[0.16em] text-slate-400">ALS DEVSTUDIO</span>}</span>
  </span>;
}
