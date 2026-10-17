import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sarin Bot', short_name: 'Sarin', lang: 'es',
    description: 'Agenda de negocios y asistente personal privado.',
    start_url: '/dashboard', scope: '/', display: 'standalone',
    background_color: '#020617', theme_color: '#020617',
    icons: [
      { src: '/brand/sarin-face-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/sarin-face-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
