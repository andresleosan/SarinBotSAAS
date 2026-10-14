"use client";

import { useState } from "react";
import { CalendarDays, Check } from "lucide-react";

const times = ["09:00", "10:30", "14:00"] as const;
type ExampleTime = (typeof times)[number];

export function AgendaPreview() {
  const [selected, setSelected] = useState<ExampleTime>("10:30");

  return <figure id="tu-agenda" className="agenda-preview">
    <figcaption className="agenda-preview-heading">
      <span><CalendarDays aria-hidden="true" />Tu semana, de un vistazo</span>
      <span className="agenda-example-label">Agenda de ejemplo</span>
    </figcaption>
    <table className="agenda-week">
      <caption className="agenda-sr-only">Agenda ilustrativa. Estos servicios y horarios no son reservas reales.</caption>
      <thead><tr><th scope="col"><span className="agenda-sr-only">Hora</span></th><th scope="col">Lun</th><th scope="col">Mar</th><th scope="col">Mié</th></tr></thead>
      <tbody>
        <tr><th scope="row">09:00</th><td><span className="agenda-event">Consulta</span></td><td /><td /></tr>
        <tr><th scope="row">10:00</th><td /><td><span className="agenda-event">Corte</span></td><td /></tr>
        <tr><th scope="row">11:00</th><td /><td /><td><span className="agenda-event">Asesoría</span></td></tr>
      </tbody>
    </table>
    <div className="agenda-availability">
      <div><p className="agenda-availability-title">El cliente elige su horario</p><p className="agenda-selection" aria-live="polite">Ejemplo: {selected} seleccionado</p></div>
      <div className="agenda-slots" role="group" aria-label="Elegir horario de ejemplo">
        {times.map(time => <button key={time} type="button" aria-pressed={selected === time} onClick={() => setSelected(time)}>{selected === time && <Check aria-hidden="true" />}{time}</button>)}
      </div>
    </div>
  </figure>;
}
