"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, LogOut } from "lucide-react";
import { type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";

export function AppShell({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const links = admin
    ? [
        ["/admin", "Negocios y pagos"],
        ["/admin/vault", "Sarin Vault"],
        ["/dashboard", "Mi negocio"],
      ]
    : [
        ["/dashboard", "Agenda"],
        ["/dashboard/onboarding", "Configurar"],
        ["/dashboard/qr-kit", "Kit QR"],
        ["/dashboard/billing", "Suscripción"],
      ];
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <Bot className="h-6 w-6 text-emerald-400" />
            Sarin Bot
          </Link>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="max-w-40 truncate">
              {user?.displayName || user?.email}
            </span>
            <button
              onClick={() => void signOut()}
              aria-label="Cerrar sesión"
              className="rounded-lg border border-slate-800 p-2 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex w-full flex-wrap gap-2 text-sm">
            {links.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={`rounded-lg px-3 py-2 transition ${pathname === href ? "bg-emerald-500/15 text-emerald-300" : "text-slate-400 hover:bg-slate-900 hover:text-white"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
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
      className={`rounded-xl border p-4 text-sm ${error ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-slate-800 bg-slate-900 text-slate-300"}`}
    >
      {children}
    </p>
  );
}
export const fieldClass =
  "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";
export const buttonClass =
  "rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50";
