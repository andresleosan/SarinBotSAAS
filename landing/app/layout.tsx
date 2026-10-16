import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const dmSans = localFont({ src: "../../public/fonts/dm-sans-latin.woff2", weight: "400 700", variable: "--font-dm-sans", display: "swap" });
const spaceGrotesk = localFont({ src: "../../public/fonts/space-grotesk-latin.woff2", weight: "400 700", variable: "--font-space-grotesk", display: "swap" });
const plexMono = localFont({ src: "../../public/fonts/ibm-plex-mono-latin.woff2", weight: "400", variable: "--font-plex-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL("https://sarinbotsaas.pages.dev"),
  title: "Sarin Bot — Reservas por conversación y agenda para tu negocio",
  description: "Servicios, disponibilidad, citas confirmadas y agenda para tu negocio. Conoce la prueba de $5.000 COP con diez citas y los planes Sarin Esencial.",
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/sarin-face.ico?v=1", type: "image/x-icon", sizes: "16x16 32x32 48x48" },
      { url: "/sarin-face-32.png?v=1", type: "image/png", sizes: "32x32" },
      { url: "/sarin-face-48.png?v=1", type: "image/png", sizes: "48x48" },
    ],
    apple: [{ url: "/sarin-face-apple.png?v=1", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website", locale: "es_CO", siteName: "Sarin Bot",
    title: "Sarin Bot — Menos mensajes. Más citas en orden.",
    description: "Reservas por conversación, enlace y QR para tus clientes, agenda e imagen de la cita descargable. Un producto de ALS DevStudio.",
    url: "/",
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-scroll-behavior="smooth" className={`${dmSans.variable} ${spaceGrotesk.variable} ${plexMono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
