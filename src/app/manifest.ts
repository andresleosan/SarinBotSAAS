import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sarin Bot', short_name: 'Sarin', lang: 'es',
    description: 'Agenda de negocios y asistente personal privado.',
    start_url: '/dashboard', scope: '/', display: 'standalone',
    background_color: '#020617', theme_color: '#020617',
    icons: [{ src: '/sarin-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
