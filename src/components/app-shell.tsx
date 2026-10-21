"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Bot, CalendarDays, ChevronRight, CreditCard, LayoutDashboard, LogOut, QrCode, Settings2, ShieldCheck, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { SarinBrand } from "@/components/sarin-brand";
import { UserAvatar } from "@/components/user-avatar";
import { ConsentPanel, useAccountConsent } from './consent-panel';

interface NavigationItem { href: string; label: string; icon: LucideIcon }
const businessLinks: NavigationItem[] = [
  { href: "/dashboard", label: "Mi agenda", icon: CalendarDays },
  { href: "/dashboard/onboarding", label: "Mi negocio", icon: Settings2 },
  { href: "/dashboard/qr-kit", label: "Enlace y QR", icon: QrCode },
  { href: "/dashboard/billing", label: "Suscripción", icon: CreditCard },
];
const adminLinks: NavigationItem[] = [
  { href: "/admin", label: "Control de SarinBot", icon: LayoutDashboard },
  { href: "/admin/assistant", label: "Asistente", icon: Bot },
  { href: "/dashboard", label: "Mi negocio", icon: CalendarDays },
];

export function AppShell({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const { user, signOut, isSuperadmin } = useAuth();
  const accountConsent = useAccountConsent();
  const pathname = usePathname();
  const links = admin ? adminLinks : businessLinks;
  const active = links.find(item => item.href === pathname);
  const name = user?.displayName || user?.email || "Mi cuenta";
  return (
    <div className="min-h-screen bg-sarin-canvas text-sarin-ink lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <a href="#workspace-content" className="sarin-skip">Saltar al contenido</a>
      <aside className="border-b border-sarin-line bg-sarin-paper lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-5 lg:px-6 lg:py-8">
          <Link href="/" aria-label="SarinBot, inicio"><SarinBrand /></Link>
          <span className="rounded-full border border-sarin-line px-2.5 py-1 text-xs text-sarin-muted lg:hidden">{admin ? "ADMIN" : "NEGOCIO"}</span>
        </div>
        <p className="sarin-eyebrow mb-3 hidden px-7 text-sarin-muted lg:block">{admin ? "Administración" : "Espacio de trabajo"}</p>
        <nav aria-label={admin ? "Navegación de administración" : "Navegación del negocio"} className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-4">
          {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center gap-3 rounded-[10px] px-3 py-3 text-[13px] font-medium ${pathname === href ? "bg-sarin-soft text-sarin-blue" : "text-sarin-muted hover:bg-sarin-canvas hover:text-sarin-ink"}`}><Icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} /><span>{label}</span>{pathname === href && <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-sarin-blue lg:block" />}</Link>)}
        </nav>
        <div className="mt-auto hidden px-6 pb-6 pt-10 lg:block">
          {isSuperadmin && !admin && <Link href="/admin" className="mb-5 flex min-h-11 items-center gap-2 text-xs text-sarin-muted hover:text-sarin-blue"><ShieldCheck aria-hidden="true" className="h-4 w-4" />Consola de administración<ArrowUpRight aria-hidden="true" className="ml-auto h-3.5 w-3.5" /></Link>}
          <div className="border-t border-sarin-line pt-5"><p className="text-sm text-sarin-ink">Un poco más de orden.</p><p className="mt-1 text-xs leading-6 text-sarin-muted">Un poco más de tiempo para ti.</p></div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-sarin-line bg-sarin-paper px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 text-xs text-sarin-muted"><span className="hidden sm:inline">{admin ? "Administración" : "Mi espacio"}</span><ChevronRight aria-hidden="true" className="hidden h-3.5 w-3.5 sm:block" /><span className="truncate text-sarin-ink">{active?.label ?? "SarinBot"}</span></div>
          <div className="flex shrink-0 items-center gap-3"><UserAvatar name={name} photoURL={user?.photoURL} /><span className="hidden max-w-44 truncate text-xs text-sarin-muted sm:block">{name}</span><button onClick={() => void signOut()} aria-label="Cerrar sesión" title="Cerrar sesión" className="grid h-11 w-11 place-items-center rounded-[10px] text-sarin-muted hover:bg-sarin-soft hover:text-sarin-blue"><LogOut aria-hidden="true" className="h-4 w-4" /></button></div>
        </header>
        <main id="workspace-content" className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{!admin && <ConsentPanel controller={accountConsent} title="Permisos de mi cuenta" />}{children}</main>
      </div>
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <p
      role={error ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm leading-6 ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-sarin-line bg-sarin-paper text-sarin-muted"}`}
    >
      {children}
    </p>
  );
}
export const fieldClass =
  "min-h-11 min-w-0 w-full rounded-[10px] border border-sarin-line bg-sarin-paper px-3.5 py-2.5 text-sm text-sarin-ink outline-none transition placeholder:text-sarin-muted focus:border-sarin-blue focus:ring-2 focus:ring-sarin-blue focus:ring-offset-2 focus:ring-offset-sarin-paper disabled:cursor-not-allowed disabled:bg-sarin-canvas disabled:opacity-70";
export const buttonClass =
  "min-h-11 rounded-[10px] bg-sarin-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#244dd0] disabled:cursor-not-allowed disabled:opacity-50";
