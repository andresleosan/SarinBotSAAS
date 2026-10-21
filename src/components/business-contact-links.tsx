export function businessContactDigits(phone: unknown): string | null {
  if (typeof phone !== 'string') return null;
  const match = /^\+?[1-9]\d{7,14}$/.exec(phone);
  return match && match[0] === phone ? phone.startsWith('+') ? phone.slice(1) : phone : null;
}

export function BusinessContactLinks({ phone, className = 'inline-flex min-h-11 min-w-0 max-w-full items-center py-2 text-sm text-sarin-blue underline underline-offset-4 [overflow-wrap:anywhere] hover:text-sarin-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue' }: { phone: unknown; className?: string }) {
  const digits = businessContactDigits(phone);
  return digits ? <>
    <a href={`tel:+${digits}`} className={className}>+{digits}</a>
    <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={className}>Escribir por WhatsApp</a>
  </> : null;
}
