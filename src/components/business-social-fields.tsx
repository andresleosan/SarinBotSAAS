"use client";

import { businessSocialPlatformLabels as labels, type BusinessSocialLink, type BusinessSocialPlatform } from '@/lib/business-branding';
import { fieldClass } from '@/components/app-shell';
export function BusinessSocialFields({ value, onChange }: { value: BusinessSocialLink[]; onChange: (links: BusinessSocialLink[]) => void }) {
  return <section className="space-y-3"><h3 className="font-semibold">Redes y sitio web</h3><p className="text-sm text-sarin-muted">Hasta tres enlaces públicos. Se guardan con los datos de tu negocio y aparecen en tu tarjeta.</p>
    {value.map((link, index) => <div key={index} className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-sarin-muted">Red {index + 1}<select aria-label={`Red ${index + 1}`} value={link.platform} onChange={event => onChange(value.map((item, row) => row === index ? { platform: event.target.value as BusinessSocialPlatform, url: '' } : item))} className={`${fieldClass} mt-1`}>{Object.entries(labels).map(([platform, label]) => <option key={platform} value={platform} disabled={value.some((other, row) => row !== index && other.platform === platform)}>{label}</option>)}</select></label>
      <label className="min-w-0 flex-1 text-xs text-sarin-muted">Enlace de {labels[link.platform]}<input type="url" required maxLength={512} aria-label={`Enlace de ${labels[link.platform]}`} placeholder="https://" value={link.url} onChange={event => onChange(value.map((item, row) => row === index ? { ...item, url: event.target.value } : item))} className={`${fieldClass} mt-1`} /></label>
      <button type="button" onClick={() => onChange(value.filter((_, row) => row !== index))} className="min-h-11 text-sm text-sarin-muted">Quitar enlace</button>
    </div>)}
    <button type="button" disabled={value.length >= 3} onClick={() => {
      const platform = (Object.keys(labels) as BusinessSocialPlatform[]).find(item => !value.some(link => link.platform === item));
      if (platform && value.length < 3) onChange([...value, { platform, url: '' }]);
    }} className="min-h-11 text-sm font-semibold text-sarin-blue disabled:opacity-50">Añadir enlace</button>
  </section>;
}
