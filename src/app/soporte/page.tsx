"use client";
import Link from 'next/link';
import { AuthGate } from '@/components/auth-provider';
import { PlatformSupportChat } from '@/components/platform-support-chat';
export default function SupportPage() {
  return <AuthGate><main className="mx-auto min-w-0 max-w-3xl space-y-6 px-4 py-8"><h1 className="text-3xl font-semibold">Soporte privado de SarinBot</h1><Link href="/ayuda" className="inline-flex min-h-11 items-center text-sarin-blue underline">Volver a Ayuda</Link><PlatformSupportChat /></main></AuthGate>;
}
