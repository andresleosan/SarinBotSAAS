import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { OwnerConfigurationProvider } from "@/components/owner-configuration-provider";

const dmSans = localFont({ src: "../../public/fonts/dm-sans-latin.woff2", weight: "400 700", variable: "--font-dm-sans", display: "swap" });
const spaceGrotesk = localFont({ src: "../../public/fonts/space-grotesk-latin.woff2", weight: "400 700", variable: "--font-space-grotesk", display: "swap" });
const plexMono = localFont({ src: "../../public/fonts/ibm-plex-mono-latin.woff2", weight: "400", variable: "--font-plex-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "SarinBot — Plataforma Inteligente de Citas con IA",
  description:
    "Agenda automatizada con SarinBot para emprendedores y negocios por citas.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" data-scroll-behavior="smooth" className={`${dmSans.variable} ${spaceGrotesk.variable} ${plexMono.variable}`}>
      <body className="min-h-screen antialiased selection:bg-sarin-blue selection:text-white">
        <AuthProvider><OwnerConfigurationProvider>{children}</OwnerConfigurationProvider></AuthProvider>
      </body>
    </html>
  );
}
