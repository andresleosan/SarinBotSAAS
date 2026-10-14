"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, CalendarDays, ChevronRight, CreditCard, LayoutDashboard, LockKeyhole, LogOut, QrCode, Settings2, ShieldCheck, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { SarinBrand } from "@/components/sarin-brand";

interface NavigationItem { href: string; label: string; icon: LucideIcon }
const businessLinks: NavigationItem[] = [
  { href: "/dashboard", label: "Mi agenda", icon: CalendarDays },
  { href: "/dashboard/onboarding", label: "Mi negocio", icon: Settings2 },
  { href: "/dashboard/qr-kit", label: "Enlace y QR", icon: QrCode },
  { href: "/dashboard/billing", label: "Suscripción", icon: CreditCard },
];
const adminLinks: NavigationItem[] = [
  { href: "/admin", label: "Negocios y pagos", icon: LayoutDashboard },
  { href: "/admin/vault", label: "Sarin Vault", icon: LockKeyhole },
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
  const pathname = usePathname();
  const links = admin ? adminLinks : businessLinks;
  const active = links.find(item => item.href === pathname);
  const name = user?.displayName || user?.email || "Mi cuenta";
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <a href="#workspace-content" className="sarin-skip">Saltar al contenido</a>
      <aside className="border-b border-white/8 bg-[#081d33] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-5 lg:px-6 lg:py-8">
          <Link href="/" aria-label="Sarin Bot, inicio"><SarinBrand /></Link>
          <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] tracking-wide text-slate-400 lg:hidden">{admin ? "ADMIN" : "NEGOCIO"}</span>
        </div>
        <p className="sarin-eyebrow mb-3 hidden px-7 text-slate-500 lg:block">{admin ? "Administración" : "Espacio de trabajo"}</p>
        <nav aria-label={admin ? "Navegación de administración" : "Navegación del negocio"} className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-4">
          {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium ${pathname === href ? "bg-emerald-500/12 text-emerald-500" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}><Icon className="h-[18px] w-[18px]" strokeWidth={1.7} /><span>{label}</span>{pathname === href && <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-emerald-500 lg:block" />}</Link>)}
        </nav>
        <div className="mt-auto hidden px-6 pb-6 pt-10 lg:block">
          {isSuperadmin && !admin && <Link href="/admin" className="mb-5 flex items-center gap-2 text-xs text-slate-300 hover:text-emerald-500"><ShieldCheck className="h-4 w-4" />Consola de administración<ArrowUpRight className="ml-auto h-3.5 w-3.5" /></Link>}
          <div className="border-t border-white/8 pt-5"><p className="font-display text-sm text-slate-200">Un poco más de orden.</p><p className="mt-1 text-xs leading-6 text-slate-500">Un poco más de tiempo para ti.</p></div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-[76px] items-center justify-between gap-4 border-b border-white/8 px-4 sm:px-8 lg:px-10">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400"><span className="hidden sm:inline">{admin ? "Administración" : "Mi espacio"}</span><ChevronRight className="hidden h-3.5 w-3.5 text-slate-600 sm:block" /><span className="truncate text-slate-200">{active?.label ?? "Sarin Bot"}</span></div>
          <div className="flex items-center gap-3"><span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 font-display text-xs font-semibold text-emerald-300">{name.charAt(0).toUpperCase()}</span><span className="hidden max-w-44 truncate text-xs text-slate-300 sm:block">{name}</span><button onClick={() => void signOut()} aria-label="Cerrar sesión" title="Cerrar sesión" className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white"><LogOut className="h-4 w-4" /></button></div>
        </header>
        <main id="workspace-content" className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 lg:px-10 lg:py-9">{children}</main>
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
      className={`rounded-xl border p-4 text-sm leading-6 ${error ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-white/10 bg-slate-900/50 text-slate-300"}`}
    >
      {children}
    </p>
  );
}
export const fieldClass =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
export const buttonClass =
  "min-h-11 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50";
