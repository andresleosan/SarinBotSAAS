import type { ReactNode } from 'react';

export function BusinessAssistantScopeNotice({ configured, dataMode, representedMinorsEnabled }: {
  configured: boolean;
  dataMode: 'general' | 'health';
  representedMinorsEnabled: boolean;
}): ReactNode {
  return <details className="min-w-0 rounded-xl border border-sarin-line bg-sarin-canvas p-3 text-sm">
    <summary className="min-h-11 cursor-pointer rounded-lg py-3 font-semibold text-sarin-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sarin-blue focus-visible:ring-offset-2">Información y alcance de Sarin</summary>
    <div className="space-y-3 break-words pt-2 leading-6 text-sarin-muted">
      {dataMode === 'health' ? <p>Este negocio utiliza reservas mediante formulario, sin IA. La ubicación y el contacto publicados siguen disponibles en su página de reservas.</p> : <>
        <p>Sarin utiliza la configuración guardada de tu negocio para responder sobre servicios, precios, horarios, contacto y modalidad de atención. Los cambios que todavía estás editando no se utilizan hasta guardar.</p>
        <dl className="space-y-3">
          <div><dt className="font-semibold text-sarin-ink">Catálogo</dt><dd>Servicios, precios, duración y descripción.</dd></div>
          <div><dt className="font-semibold text-sarin-ink">Datos del negocio</dt><dd>Ubicación y contacto.</dd></div>
          <div><dt className="font-semibold text-sarin-ink">Horarios</dt><dd>Horario publicado y consulta de disponibilidad.</dd></div>
          <div><dt className="font-semibold text-sarin-ink">Confirmación</dt><dd>Propuesta revisable y botón Confirmar cita.</dd></div>
        </dl>
        <p>La cita solo queda registrada después de revisar la propuesta y pulsar Confirmar cita.</p>
        <p>El tono y las indicaciones no crean precios, servicios ni acciones nuevas.</p>
      </>}
      {!configured && <p>Al guardar la configuración se actualiza tu página de reservas.</p>}
      {representedMinorsEnabled && <p>Las reservas para menores usan el formulario y la representación autorizada; no se gestionan mediante este chat general.</p>}
    </div>
  </details>;
}
