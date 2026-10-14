import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarCheck2, CalendarDays, Clock3, Link2, MessageCircle, ShieldCheck } from "lucide-react";
import { AgendaPreview } from "./agenda-preview";
import "./marketing-home.css";

function MarketingBrand() {
  return <span className="agenda-brand"><CalendarCheck2 aria-hidden="true" strokeWidth={1.8} /><span>sarin<span className="agenda-brand-suffix">bot</span></span></span>;
}

const steps = [
  { icon: Clock3, title: "Prepara tu espacio", text: "Agrega tus servicios, profesionales y horarios. Tu prueba empieza al crear el negocio." },
  { icon: Link2, title: "Comparte tu enlace", text: "En tu perfil, por mensaje o con un QR en tu local. Tus clientes llegan a tu propio espacio." },
  { icon: CalendarDays, title: "Recibe cada reserva", text: "Consulta tu agenda, bloquea horarios y mantén el control de las citas desde un solo lugar." },
];

export function MarketingHome({ comingSoon = false }: { comingSoon?: boolean }) {
  return (
    <div className="agenda-home">
      <a href="#main-content" className="sarin-skip">Saltar al contenido</a>
      <header className="agenda-header agenda-container">
        <Link href="/" aria-label="Sarin Bot, inicio"><MarketingBrand /></Link>
        <nav aria-label="Navegación principal" className="agenda-nav">
          <a href="#como-funciona">El asistente</a>
          <a href="#tu-agenda">Tu agenda</a>
        </nav>
        <Link href={comingSoon ? "#lanzamiento" : "/dashboard"} className="agenda-button agenda-button-small">
          {comingSoon ? "Próximamente" : "Mi negocio"}<ArrowUpRight aria-hidden="true" />
        </Link>
      </header>
      <main id="main-content">
        <section className="agenda-hero agenda-container" aria-labelledby="agenda-heading">
          <p className="agenda-eyebrow"><span aria-hidden="true" />Un asistente para tu negocio</p>
          <h1 id="agenda-heading">Menos mensajes.<br /><span>Más citas en orden.</span></h1>
          <p className="agenda-intro">Un enlace para tus clientes. Una agenda para ti.<br className="agenda-desktop-break" /> {comingSoon ? "Estamos preparando a Sarin para encargarse de la conversación." : "Sarin se encarga de la conversación."}</p>
          <div className="agenda-hero-actions">
            <Link href={comingSoon ? "#como-funciona" : "/dashboard/onboarding"} className="agenda-button">
              {comingSoon ? "Ver cómo funcionará" : "Empezar mi prueba"}<ArrowRight aria-hidden="true" />
            </Link>
            <a href="#tu-agenda" className="agenda-text-link">Explorar la agenda<ArrowDown aria-hidden="true" /></a>
          </div>
          <p className="agenda-launch-note">{comingSoon ? "Próximamente · El registro, las reservas y los chats aún no están disponibles." : "7 días de prueba · Acceso con Google"}</p>
          <AgendaPreview />
          <div className="agenda-mascot">
            <Image src="/brand/sarin-welcome.png" alt="" width={64} height={96} className="agenda-mascot-image" />
            <p><strong>Hola, soy Sarin.</strong><span>Tu asistente para los días ocupados.</span></p>
          </div>
        </section>
        <section id="como-funciona" className="agenda-how agenda-container" aria-labelledby="how-heading">
          <div className="agenda-section-heading">
            <div><p className="agenda-eyebrow">De un enlace a tu agenda</p><h2 id="how-heading">Tú atiendes.<br />Sarin organiza la conversación.</h2></div>
            <p>Tú defines cómo trabajas. Sarin ayuda a que tus clientes encuentren el momento.</p>
          </div>
          <ol className="agenda-steps">
            {steps.map(({ icon: Icon, title, text }, index) => <li key={title}>
              <div className="agenda-step-top"><span>Paso {index + 1}</span><Icon aria-hidden="true" strokeWidth={1.7} /></div>
              <h3>{title}</h3><p>{text}</p>
            </li>)}
          </ol>
        </section>
        <section id="tu-espacio" className="agenda-details agenda-container" aria-labelledby="space-heading">
          <h2 id="space-heading" className="agenda-sr-only">Tu espacio con Sarin</h2>
          <div className="agenda-detail"><MessageCircle aria-hidden="true" /><div><h3>Una conversación, una cita</h3><p>El cliente consulta tus servicios y elige un horario que encaje en tu agenda.</p></div></div>
          <div className="agenda-detail"><ShieldCheck aria-hidden="true" /><div><h3>Tu negocio tiene su propio espacio</h3><p>Tus servicios, tus horarios y un enlace privado para compartir con tus clientes.</p></div></div>
        </section>
        <section id={comingSoon ? "lanzamiento" : "empezar"} className="agenda-launch agenda-container" aria-labelledby="launch-heading">
          <p className="agenda-eyebrow">{comingSoon ? "Estamos preparando el lanzamiento" : "Hecho para tu día a día"}</p>
          <h2 id="launch-heading">Tu próxima cita,<br /><span>un poco más simple.</span></h2>
          <p>{comingSoon ? "El registro de negocios, las reservas y los chats se habilitarán con el lanzamiento. Mientras tanto, conoce al estudio detrás de Sarin." : "Un espacio propio para tu negocio, con tus servicios y tu forma de atender. Empieza por lo que ya conoces: tu horario."}</p>
          {comingSoon ? <a href="https://www.alsdevstudio.com/" className="agenda-button">Conocer ALS DevStudio<ArrowUpRight aria-hidden="true" /></a> : <Link href="/dashboard/onboarding" className="agenda-button">Configurar mi negocio<ArrowRight aria-hidden="true" /></Link>}
        </section>
      </main>
      <footer className="agenda-footer agenda-container">
        <Link href="/" aria-label="Sarin Bot, inicio"><MarketingBrand /></Link>
        <p>Un producto de <a href="https://www.alsdevstudio.com/">ALS DevStudio<ArrowUpRight aria-hidden="true" /></a></p>
        {comingSoon ? <span>Sitio en preparación</span> : <Link href="/admin" className="agenda-text-link">Administración<ArrowRight aria-hidden="true" /></Link>}
      </footer>
    </div>
  );
}
