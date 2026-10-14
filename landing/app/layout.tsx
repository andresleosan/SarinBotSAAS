import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const dmSans = localFont({ src: "../../public/fonts/dm-sans-latin.woff2", weight: "400 700", variable: "--font-dm-sans", display: "swap" });
const spaceGrotesk = localFont({ src: "../../public/fonts/space-grotesk-latin.woff2", weight: "400 700", variable: "--font-space-grotesk", display: "swap" });
const plexMono = localFont({ src: "../../public/fonts/ibm-plex-mono-latin.woff2", weight: "400", variable: "--font-plex-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL("https://sarinbotsaas.pages.dev"),
  title: "Sarin Bot — Tu agenda, un poco más simple. Próximamente",
  description: "Conoce Sarin Bot, el asistente para organizar las citas de tu negocio. Estamos preparando el lanzamiento; registro, reservas y chats próximamente.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", locale: "es_CO", siteName: "Sarin Bot",
    title: "Sarin Bot — Próximamente",
    description: "Menos mensajes por responder. Más tiempo para atender. Conoce el proyecto de ALS DevStudio.",
    url: "/",
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${dmSans.variable} ${spaceGrotesk.variable} ${plexMono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
