import { googleMapsLocationUrl, normalizeBusinessLocation } from '@/lib/business-location';

const modalityLabels = { at_business: 'En el local', at_client: 'A domicilio', online: 'En línea' };

export function BusinessLocation({ location: input }: { location?: unknown }) {
  const location = normalizeBusinessLocation(input);
  if (!location) return null;
  const mapsUrl = googleMapsLocationUrl(location);

  return <section aria-label="Ubicación y modalidad" className="min-w-0 rounded-2xl border border-sarin-line bg-sarin-paper p-5 [overflow-wrap:anywhere] sm:p-6">
    <h2 className="text-lg font-semibold">Ubicación y modalidad</h2>
    <p className="mt-3 text-sm font-medium">{modalityLabels[location.mode]}</p>
    {location.mode === 'at_business' && location.address && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-sarin-muted">{location.address}</p>}
    {location.instructions && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-sarin-muted">{location.instructions}</p>}
    {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="mt-2 inline-flex min-h-11 max-w-full items-center py-2 text-sm text-sarin-blue underline underline-offset-4 transition hover:text-sarin-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue">Cómo llegar</a>}
  </section>;
}
