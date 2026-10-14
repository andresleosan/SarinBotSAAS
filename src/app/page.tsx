import Link from "next/link";
import { ArrowRight, Bot, Calendar, QrCode, ShieldCheck } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold">
            <Bot className="h-7 w-7 text-emerald-400" />
            Sarin Bot
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-slate-300 hover:text-white">
              Mi negocio
            </Link>
            <Link
              href="/admin"
              className="rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:border-slate-500"
            >
              Administración
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
        <div className="max-w-3xl">
          <p className="mb-5 text-xs uppercase tracking-[0.2em] text-emerald-400">
            Tu negocio. Su propia agenda.
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Menos mensajes pendientes.
            <br />
            <span className="text-emerald-400">Más citas organizadas.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
            Dale a tus clientes un enlace para hablar con Sarin, consultar tus
            servicios y reservar contigo. Tú mantienes el control de horarios,
            profesionales y agenda.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard/onboarding"
              className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3.5 font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Configurar mi negocio
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard"
              className="rounded-xl border border-slate-700 px-5 py-3.5 font-semibold text-slate-200 transition hover:bg-slate-900"
            >
              Abrir mi agenda
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Inicio de sesión con Google · 7 días de prueba para negocios nuevos
          </p>
        </div>
        <div className="mt-16 grid gap-5 sm:grid-cols-3">
          {[
            {
              icon: QrCode,
              title: "Una isla para tu negocio",
              text: "Comparte tu enlace o imprime tu QR. Tus clientes llegan directamente a tus servicios.",
            },
            {
              icon: Calendar,
              title: "Horarios que se respetan",
              text: "Reservas según tu disponibilidad, duración de cada servicio y tiempos de preparación.",
            },
            {
              icon: ShieldCheck,
              title: "Tu agenda bajo control",
              text: "Consulta tus citas, bloquea horarios y administra tu suscripción desde un solo lugar.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <article
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"
              key={title}
            >
              <Icon className="mb-5 h-7 w-7 text-emerald-400" />
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                {text}
              </p>
            </article>
          ))}
        </div>
      </main>
      <footer className="border-t border-slate-800 px-5 py-6 text-center text-xs text-slate-500">
        Sarin Bot · Agenda inteligente para negocios por citas
      </footer>
    </div>
  );
}
