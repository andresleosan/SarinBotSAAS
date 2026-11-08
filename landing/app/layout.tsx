import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const dmSans = localFont({ src: "../../public/fonts/dm-sans-latin.woff2", weight: "400 700", variable: "--font-dm-sans", display: "swap" });
const spaceGrotesk = localFont({ src: "../../public/fonts/space-grotesk-latin.woff2", weight: "400 700", variable: "--font-space-grotesk", display: "swap" });
const plexMono = localFont({ src: "../../public/fonts/ibm-plex-mono-latin.woff2", weight: "400", variable: "--font-plex-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL("https://sarinbotsaas.pages.dev"),
  title: "Sarin Bot | Chatbots para webs y emprendimientos",
  description: "Servicio de chatbot de ALS Dev Studio para atender consultas sobre tu negocio. Conoce las opciones de atención web y WhatsApp y solicita una cotización.",
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
    title: "Sarin Bot | Chatbots para webs y emprendimientos",
    description: "Un chatbot para atender a tus clientes, configurado con la información de tu negocio. Desarrollado por ALS Dev Studio.",
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
