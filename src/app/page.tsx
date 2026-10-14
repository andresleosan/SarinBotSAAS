import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronRight, Clock3, Link2, MessageCircle, QrCode, ShieldCheck, Sparkles } from "lucide-react";
import { SarinBrand, SarinMark } from "@/components/sarin-brand";

function BookingPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[520px] py-8 lg:py-12">
      <div aria-hidden className="sarin-orbit -inset-x-12 inset-y-10 rotate-[-24deg]" />
      <div aria-hidden className="sarin-orbit -inset-x-5 inset-y-[-8px] rotate-[24deg] opacity-60" />
      <figure className="sarin-surface relative overflow-hidden rounded-[26px] shadow-[0_30px_90px_-35px_#020d20]">
        <figcaption className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7"><span className="sarin-eyebrow text-emerald-500">Una conversación. Una cita.</span><span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-slate-400"><ArrowUpRight className="h-3.5 w-3.5" /></span></figcaption>
        <div className="space-y-5 p-5 sm:p-7">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/10 text-emerald-500"><SarinMark className="h-6 w-6" /></span><div><p className="font-display text-base font-semibold">Tu negocio, con Sarin.</p><p className="text-xs text-slate-400">Un enlace privado para tus clientes</p></div><QrCode className="ml-auto h-6 w-6 text-slate-400" strokeWidth={1.4} /></div>
          <div className="rounded-2xl bg-[#f5f8fb] p-5 text-[#10263a]">
            <div className="flex items-center gap-2 text-xs font-medium text-[#536477]"><MessageCircle className="h-4 w-4" />Así empieza la reserva</div>
            <p className="mt-4 font-display text-[22px] font-medium leading-tight tracking-tight">“Quiero agendar<br />una cita contigo.”</p>
            <div className="mt-5 flex items-center gap-2 border-t border-[#10263a]/10 pt-4 text-xs leading-5 text-[#536477]"><Sparkles className="h-4 w-4 shrink-0 text-[#236a57]" />Sarin consulta tus servicios y horarios.</div>
          </div>
          <div className="flex gap-3"><span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 text-emerald-500"><CalendarDays className="h-[18px] w-[18px]" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium">Un horario que funciona.</p><p className="mt-1 text-xs leading-5 text-slate-400">El cliente elige entre los espacios disponibles de tu agenda.</p><div className="mt-3 flex flex-wrap gap-2">{["Tus servicios", "Tus horarios", "Tu equipo"].map(item => <span key={item} className="rounded-lg border border-white/10 px-2.5 py-1 font-mono text-[10px] text-slate-300">{item}</span>)}</div></div></div>
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/7 px-4 py-3"><Check className="h-4 w-4 text-emerald-500" /><p className="text-xs text-slate-200">La reserva queda en tu agenda.</p><span className="ml-auto font-mono text-[10px] text-emerald-500">TODO EN ORDEN</span></div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3 text-[11px] text-slate-400 sm:px-7"><span>Ejemplo de recorrido</span><span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />Tu negocio tiene su propio espacio</span></div>
      </figure>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="sarin-backdrop min-h-screen overflow-x-clip bg-slate-950 text-slate-100">
      <a href="#main-content" className="sarin-skip">Saltar al contenido</a>
      <header className="mx-auto max-w-[1440px] px-4 pt-4 sm:px-8">
        <div className="flex items-center justify-between gap-3 rounded-[24px] border border-white/10 bg-slate-900/35 px-4 py-4 sm:gap-5 sm:px-7">
          <Link href="/" aria-label="Sarin Bot, inicio"><SarinBrand /></Link>
          <nav aria-label="Navegación principal" className="hidden items-center gap-7 text-xs text-slate-300 md:flex"><a href="#como-funciona" className="hover:text-emerald-500">Cómo funciona</a><a href="#tu-espacio" className="hover:text-emerald-500">Tu espacio</a></nav>
          <Link href="/dashboard" className="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 sm:px-5">Mi negocio<ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
      </header>
      <main id="main-content">
        <section className="relative mx-auto grid max-w-[1280px] items-center gap-6 px-5 pb-12 pt-14 sm:px-10 sm:pt-20 lg:min-h-[740px] lg:grid-cols-[1.06fr_1fr] lg:gap-16 lg:pb-20 lg:pt-12">
          <div className="relative z-10">
            <p className="sarin-eyebrow mb-7 flex items-center gap-2.5 text-emerald-500"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Tu negocio. Su propio espacio.</p>
            <h1 className="text-[clamp(3.4rem,6.4vw,6.5rem)] font-medium leading-[0.99] tracking-[-0.065em]">Tu agenda,<br />un poco<br /><span className="text-emerald-500">más simple.</span></h1>
            <p className="mt-7 max-w-[450px] text-base leading-7 text-slate-400 sm:text-lg sm:leading-8">Menos mensajes por responder. Más tiempo para atender. Sarin conversa con tus clientes y organiza las reservas según tus horarios.</p>
            <div className="mt-8 flex flex-wrap items-center gap-5"><Link href="/dashboard/onboarding" className="inline-flex min-h-12 items-center gap-4 rounded-full bg-emerald-500 px-6 py-3.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">Empezar mi prueba<ArrowUpRight className="h-4 w-4" /></Link><a href="#como-funciona" className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-300 hover:text-white">Conocer Sarin<ArrowDown className="h-4 w-4" /></a></div>
            <p className="mt-4 text-xs text-slate-400">7 días de prueba · Acceso con Google</p>
            <div className="mt-9 flex items-center gap-3"><Image src="/brand/sarin-welcome.png" alt="" width={64} height={76} className="h-[70px] w-[58px] object-contain" /><div><p className="text-xs font-medium text-slate-200">Hola, soy Sarin.</p><p className="mt-1 text-xs text-slate-400">Tu asistente para los días ocupados.</p></div></div>
          </div>
          <BookingPreview />
        </section>
        <div className="border-y border-white/8 bg-white/[0.015]"><div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-4 px-5 py-5 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:px-10 sm:text-xs">{["Tu enlace privado", "Reservas organizadas", "Horarios bajo control", "Un asistente para tu negocio"].map(item => <span key={item} className="flex items-center gap-3"><span aria-hidden className="h-1 w-1 rounded-full bg-emerald-500" />{item}</span>)}</div></div>
        <section id="como-funciona" className="mx-auto max-w-[1280px] px-5 py-16 sm:px-10 sm:py-24">
          <div className="flex flex-wrap items-end justify-between gap-6"><div><p className="sarin-eyebrow mb-4 text-emerald-500">De un enlace a tu agenda</p><h2 className="max-w-xl text-4xl font-medium leading-[1.08] tracking-[-0.055em] sm:text-5xl">Cada cita empieza<br />con una conversación.</h2></div><p className="max-w-xs text-sm leading-7 text-slate-400">Tú defines cómo trabajas. Sarin ayuda a que tus clientes encuentren el momento.</p></div>
          <div className="mt-12 grid gap-0 border-t border-white/10 md:grid-cols-3">{[
            { number: "01", icon: Clock3, title: "Prepara tu espacio.", text: "Agrega tus servicios, profesionales y horarios. Tu prueba empieza al crear el negocio." },
            { number: "02", icon: Link2, title: "Comparte tu enlace.", text: "En tu perfil, por mensaje o con un QR en tu local. Tus clientes llegan a tu propia isla." },
            { number: "03", icon: CalendarDays, title: "Recibe cada reserva.", text: "Consulta tu agenda, bloquea horarios y mantén el control de las citas desde un solo lugar." },
          ].map(({ number, icon: Icon, title, text }) => <article key={number} className="border-b border-white/10 py-8 md:border-b-0 md:pr-8 md:pl-8 md:first:pl-0 md:not-last:border-r"><div className="mb-7 flex items-center justify-between"><span className="font-mono text-xs text-slate-500">{number} /</span><Icon className="h-5 w-5 text-emerald-500" strokeWidth={1.5} /></div><h3 className="text-xl font-medium tracking-tight">{title}</h3><p className="mt-3 max-w-xs text-sm leading-7 text-slate-400">{text}</p></article>)}</div>
        </section>
        <section id="tu-espacio" className="mx-auto max-w-[1280px] px-5 pb-20 sm:px-10 sm:pb-28"><div className="sarin-surface relative overflow-hidden rounded-[28px] px-6 py-10 sm:px-12 sm:py-14"><div aria-hidden className="sarin-orbit -right-12 -top-32 h-[460px] w-[460px] opacity-50" /><div className="relative flex flex-wrap items-center justify-between gap-9"><div className="max-w-xl"><p className="sarin-eyebrow mb-4 text-emerald-500">Hecho para tu día a día</p><h2 className="text-3xl font-medium leading-tight tracking-[-0.05em] sm:text-4xl">Tus clientes más cerca.<br />Tu agenda más clara.</h2><p className="mt-4 max-w-lg text-sm leading-7 text-slate-400">Un espacio propio para tu negocio, con tus servicios y tu forma de atender. Empieza por lo que ya conoces: tu horario.</p></div><Link href="/dashboard/onboarding" className="inline-flex min-h-12 items-center gap-4 rounded-full bg-emerald-500 px-6 py-3.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">Configurar mi negocio<ArrowRight className="h-4 w-4" /></Link></div></div></section>
      </main>
      <footer className="border-t border-white/10"><div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-6 px-5 py-7 sm:px-10"><Link href="/" aria-label="Sarin Bot, inicio"><SarinBrand compact /></Link><p className="text-xs text-slate-400">Un producto de <a href="https://www.alsdevstudio.com/" className="text-slate-200 hover:text-emerald-500">ALS DevStudio<ArrowUpRight className="ml-1 inline h-3 w-3" /></a></p><Link href="/admin" className="flex min-h-10 items-center gap-1.5 text-xs text-slate-400 hover:text-white">Administración<ChevronRight className="h-3 w-3" /></Link></div></footer>
    </div>
  );
}
