"use client";

import { businessSocialLabel, businessSocialPlatformLabels } from '@/lib/business-branding';
import type { PublicBusinessProfile } from '@/types/firestore';

const weekDays = [
  { day: 1, label: 'Lunes' },
  { day: 2, label: 'Martes' },
  { day: 3, label: 'Miércoles' },
  { day: 4, label: 'Jueves' },
  { day: 5, label: 'Viernes' },
  { day: 6, label: 'Sábado' },
  { day: 0, label: 'Domingo' },
];
const contactClass = 'inline-flex min-h-11 min-w-0 max-w-full items-center py-2 text-sm text-sarin-blue underline underline-offset-4 [overflow-wrap:anywhere] hover:text-sarin-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue';

type PublicService = PublicBusinessProfile['services'][number];

function ServiceCards({ services, grouped = false, onReserve }: { services: readonly PublicService[]; grouped?: boolean; onReserve?: (serviceId: string) => void }) {
  const Heading = grouped ? 'h4' : 'h3';
  return <ul className="mt-4 space-y-3">
    {services.map(service => <li key={service.id} className="min-w-0 rounded-xl border border-sarin-line p-4">
      <Heading className="font-semibold leading-snug">{service.name}</Heading>
      {service.description?.trim() && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-sarin-muted">{service.description}</p>}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
        <p className="font-semibold">{service.price.toLocaleString('es-CO')} COP</p>
        <p className="text-sarin-muted">{service.durationMinutes} minutos</p>
      </div>
      {onReserve && <button type="button" aria-label={`Reservar este servicio: ${service.name}`} onClick={() => onReserve(service.id)} className="mt-3 inline-flex min-h-11 max-w-full items-center rounded-[10px] border border-sarin-line px-3 py-2 text-left text-sm font-semibold text-sarin-blue hover:border-sarin-blue hover:bg-sarin-soft focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue">Reservar este servicio</button>}
    </li>)}
  </ul>;
}

function categoryGroups(services: readonly PublicService[]) {
  const groups = new Map<string, { label: string; services: PublicService[] }>();
  for (const service of services) {
    const label = service.category?.trim() ?? '';
    const key = label.normalize('NFC').toLocaleLowerCase('es-CO');
    const group = groups.get(key);
    if (group) group.services.push(service);
    else groups.set(key, { label: label || 'Sin categoría', services: [service] });
  }
  return [...groups.entries()];
}

export function BusinessPublicProfile({ profile, onContinue }: { profile: PublicBusinessProfile; onContinue: (serviceId?: string) => void }) {
  const telephone = profile.phoneWhatsApp.replace(/\D/g, '');
  const hasContact = Boolean(telephone || profile.socialLinks?.length);
  const hasCategories = profile.services.some(service => Boolean(service.category?.trim()));

  return <main className="mx-auto min-h-dvh w-full max-w-4xl space-y-4 bg-sarin-canvas px-4 py-5 text-sarin-ink [overflow-wrap:anywhere] sm:px-6 sm:py-8">
    <header className="rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6">
      <div className="flex min-w-0 items-center gap-4">
        {profile.logo && <img src={`/api/public/businesses/${encodeURIComponent(profile.slug)}/logo/${profile.logo.sha256}`} alt={`Logo de ${profile.name}`} width={64} height={64} className="h-16 w-16 shrink-0 rounded-xl object-contain" />}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{profile.name}</h1>
          {profile.category && <p className="mt-2 text-sm text-sarin-muted">{profile.category}</p>}
        </div>
      </div>
    </header>

    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <p className="min-w-0 text-sm text-sarin-muted">{profile.bookingAvailable ? 'Consulta la disponibilidad para reservar tu cita.' : 'Las nuevas reservas están en pausa. Puedes consultar y cancelar tus citas existentes.'}</p>
      <button type="button" onClick={() => onContinue()} className="min-h-11 shrink-0 rounded-[10px] bg-sarin-blue px-6 py-3 text-sm font-semibold text-white hover:bg-[#244dd0] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue">{profile.bookingAvailable ? 'Reservar' : 'Ver mis citas'}</button>
    </div>

    <div className="grid min-w-0 items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
      <section aria-label="Servicios del negocio" className="min-w-0 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Servicios</h2>
        {profile.services.length ? hasCategories ? <div className="mt-5 space-y-6">
          {categoryGroups(profile.services).map(([key, group]) => <div key={key} className="min-w-0">
            <h3 className="font-semibold">{group.label}</h3>
            <ServiceCards services={group.services} grouped onReserve={profile.bookingAvailable ? onContinue : undefined} />
          </div>)}
        </div> : <ServiceCards services={profile.services} onReserve={profile.bookingAvailable ? onContinue : undefined} /> : <p className="mt-3 text-sm text-sarin-muted">El negocio aún no ha publicado sus servicios.</p>}
      </section>

      <div className="min-w-0 space-y-4">
        <section aria-label="Horario del negocio" className="rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Horario de atención</h2>
          <p className="mt-1 text-xs text-sarin-muted">Hora de Colombia</p>
          <ul className="mt-3 divide-y divide-sarin-line text-sm">
            {weekDays.map(({ day, label }) => {
              const schedule = profile.weeklySchedule[day];
              return <li key={day} className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 py-2.5">
                <span className="font-medium">{label}</span>
                <div className="min-w-0 text-right tabular-nums text-sarin-muted">
                  {!schedule || (schedule.isOpen && !schedule.intervals.length) ? <p>Sin horario publicado</p> : !schedule.isOpen ? <p>Cerrado</p> : schedule.intervals.map(interval => <p key={`${interval.start}-${interval.end}`}>{interval.start}–{interval.end}</p>)}
                </div>
              </li>;
            })}
          </ul>
        </section>

        {hasContact && <section className="min-w-0 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Contacto</h2>
          <nav aria-label="Contacto del negocio" className="mt-2 flex min-w-0 flex-col items-start">
            {telephone && <a href={`tel:+${telephone}`} className={contactClass}>+{telephone}</a>}
            {(profile.socialLinks ?? []).map(link => <a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer" className={contactClass}>{businessSocialPlatformLabels[link.platform]} · {businessSocialLabel(link)}</a>)}
          </nav>
        </section>}
      </div>
    </div>

  </main>;
}
