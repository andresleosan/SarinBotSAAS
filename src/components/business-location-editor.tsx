"use client";

import { useId } from 'react';
import { fieldClass } from '@/components/app-shell';
import { BUSINESS_LOCATION_ADDRESS_MAX_LENGTH, BUSINESS_LOCATION_INSTRUCTIONS_MAX_LENGTH, type BusinessLocation } from '@/lib/business-location';

export function BusinessLocationEditor({ value, onChange }: { value: BusinessLocation | null; onChange: (location: BusinessLocation | null) => void }) {
  const helpId = useId();
  return <section aria-label="Ubicación del negocio" className="min-w-0 space-y-3">
    <h3 className="font-semibold">Ubicación y modalidad</h3>
    <p id={helpId} className="text-sm text-sarin-muted">Esta información se mostrará en tu ficha pública</p>
    <label className="block text-xs text-sarin-muted">
      Modalidad de atención
      <select aria-label="Modalidad de atención" aria-describedby={helpId} value={value?.mode ?? ''} className={`${fieldClass} mt-1.5 min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue`} onChange={event => {
        const mode = event.target.value;
        if (!mode) { onChange(null); return; }
        if (mode !== 'at_business' && mode !== 'at_client' && mode !== 'online') return;
        onChange({ mode, ...(value?.instructions !== undefined ? { instructions: value.instructions } : {}) });
      }}>
        <option value="">Sin publicar</option>
        <option value="at_business">En el local</option>
        <option value="at_client">A domicilio</option>
        <option value="online">En línea</option>
      </select>
    </label>
    {value?.mode === 'at_business' && <label className="block text-xs text-sarin-muted">
      Dirección del local
      <input aria-label="Dirección del local" aria-describedby={helpId} value={value.address ?? ''} maxLength={BUSINESS_LOCATION_ADDRESS_MAX_LENGTH} onChange={event => onChange({ ...value, address: event.target.value })} className={`${fieldClass} mt-1.5 min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue`} />
    </label>}
    {value && <label className="block text-xs text-sarin-muted">
      Indicaciones
      <textarea aria-label="Indicaciones de ubicación" aria-describedby={helpId} value={value.instructions ?? ''} maxLength={BUSINESS_LOCATION_INSTRUCTIONS_MAX_LENGTH} onChange={event => onChange({ ...value, instructions: event.target.value })} className={`${fieldClass} mt-1.5 min-h-24 resize-y focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sarin-blue`} />
    </label>}
  </section>;
}
