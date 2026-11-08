import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sarin Bot Admin Hub', short_name: 'Sarin Bot', lang: 'es',
    description: 'Centro de control de ALS Dev Studio para negocios enlazados, WhatsApp e inteligencia artificial.',
    start_url: '/admin', scope: '/', display: 'standalone',
    background_color: '#f7f9ff', theme_color: '#315ff3',
    icons: [
      { src: '/brand/sarin-face-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/sarin-face-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
