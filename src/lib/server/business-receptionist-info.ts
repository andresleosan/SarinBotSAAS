import type { Business, TenantService } from '@/types/firestore';
import { normalizeBusinessLocation } from '@/lib/business-location';
import { serviceCatalogMetadata } from '@/lib/service-catalog';

type BusinessServiceInformationInput = {
  business: Pick<Business, 'name' | 'services'>;
  intent: 'services' | 'service_details' | 'price';
  serviceId?: string;
};

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

function contactInformation(phone: unknown): string | undefined {
  if (typeof phone !== 'string') return undefined;
  const match = /^\+?[1-9]\d{7,14}$/.exec(phone);
  return match && match[0].length === phone.length ? `Puedes consultar los detalles en ${phone}.` : undefined;
}

export function renderBusinessLocationInformation(business: Pick<Business, 'location' | 'phoneWhatsApp'>): string {
  const location = normalizeBusinessLocation(business.location);
  const contact = contactInformation(business.phoneWhatsApp);
  const fallback = contact ?? 'Contacta directamente al negocio para confirmarlo.';
  if (!location) return `El negocio no ha publicado una ubicación o modalidad válida en SarinBot. ${fallback}`;

  let text: string;
  if (location.mode === 'at_business') {
    text = location.address
      ? `Atención en el local.\nDirección: ${location.address}`
      : `Atención en el local. El negocio no ha publicado la dirección exacta en SarinBot. ${fallback}`;
  } else if (location.mode === 'at_client') {
    text = location.instructions
      ? 'Atención a domicilio.'
      : 'Atención a domicilio. Confirma con el negocio la zona y las condiciones de atención.';
  } else {
    text = location.instructions
      ? 'Atención en línea.'
      : 'Atención en línea. Contacta al negocio para conocer las indicaciones de conexión.';
  }
  if (location.mode !== 'at_business' && !location.instructions && contact) text += ` ${contact}`;
  if (location.instructions) text += `\nIndicaciones publicadas por el negocio:\n${location.instructions}`;
  return text;
}

function hasValidBasicInformation(service: TenantService): boolean {
  return !!service
    && typeof service.name === 'string'
    && service.name.trim().length >= 1
    && service.name.trim().length <= 120
    && typeof service.price === 'number'
    && Number.isFinite(service.price)
    && service.price >= 0
    && service.price <= 100000000
    && Number.isInteger(service.durationMinutes)
    && service.durationMinutes >= 5
    && service.durationMinutes <= 720;
}

function basicServiceInformation(service: TenantService): string {
  return `${service.name.trim()}: ${money(service.price)} · ${service.durationMinutes} minutos.`;
}

export function renderBusinessServiceInformation({ business, intent, serviceId }: BusinessServiceInformationInput): string {
  if (!business.services.length) return 'El negocio todavía no ha publicado sus servicios. Contacta al negocio para confirmarlos.';
  if (intent === 'services') {
    if (!business.services.every(hasValidBasicInformation)) return 'El negocio debe revisar su catálogo. Contacta al negocio para confirmarlo.';
    return `Servicios de ${business.name}:\n${business.services.map(basicServiceInformation).join('\n')}`;
  }
  if (!serviceId) return intent === 'price' ? '¿De qué servicio quieres conocer el precio?' : '¿De qué servicio quieres conocer los detalles?';
  const service = business.services.find(item => item?.id === serviceId);
  if (!service) return 'Ese servicio no está disponible en el catálogo actual. Consulta los servicios del negocio.';
  if (!hasValidBasicInformation(service)) return 'El negocio debe revisar la información de este servicio. Contacta al negocio para confirmarla.';
  const basic = basicServiceInformation(service);
  if (intent === 'price') return basic;
  const { category, description } = serviceCatalogMetadata(service);
  return [
    basic,
    ...(category ? [`Categoría: ${category}`] : []),
    description ? `Descripción publicada por el negocio:\n${description}` : 'El negocio no ha publicado una descripción adicional de este servicio.',
  ].join('\n');
}
