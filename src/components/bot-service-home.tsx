import Image from 'next/image';
import { SarinBrand } from './sarin-brand';
import { BotServicePricing } from './bot-service-pricing';
import { sarinWhatsAppUrl } from '@/lib/sarin-contact';
import './bot-service-home.css';

export function BotServiceHome({ standalone = false }: { standalone?: boolean }) {
  const adminHref = standalone ? 'https://sarinbotsaas.pages.dev/admin' : '/admin';
  return <div className="bot-service">
    <a href="#bot-main" className="sarin-skip">Saltar al contenido</a>
    <header className="bot-container bot-header">
      <a href="/" aria-label="Sarin Bot, inicio"><SarinBrand hub /></a>
      <nav aria-label="Servicio de chatbot"><a href="#servicio">Qué hace</a><a href="#planes">Planes</a><a href="#contacto">Contacto</a></nav>
      <a href={adminHref} className="bot-admin">Administración</a>
    </header>
    <main id="bot-main">
      <section className="bot-container bot-hero" aria-labelledby="bot-heading">
        <div>
          <p className="bot-eyebrow">Chatbots para webs y emprendimientos</p>
          <h1 id="bot-heading">Un chatbot para atender a tus clientes.</h1>
          <p className="bot-intro">Un punto de atención para consultar los servicios y la información de tu negocio. Definimos contigo el canal, las respuestas y la configuración.</p>
          <div className="bot-actions"><a href={sarinWhatsAppUrl} className="bot-button" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Cotizar mi chatbot</a><a href="#planes" className="bot-link">Consultar planes</a></div>
        </div>
        <figure className="bot-character"><Image src="/brand/sarin-welcome.png" alt="Sarin Bot, asistente virtual de ALS Dev Studio" width={320} height={480} priority /><figcaption>Sarin Bot <span>Asistente virtual de ALS Dev Studio</span></figcaption></figure>
      </section>
      <section id="servicio" className="bot-container bot-section" aria-labelledby="bot-service-heading">
        <div className="bot-section-heading"><h2 id="bot-service-heading">La información de tu negocio,<br />al alcance de una conversación.</h2><p>El alcance se configura con tus servicios, horarios y datos publicados.</p></div>
        <dl className="bot-capabilities">
          <div><dt>Respuestas con contexto</dt><dd>El asistente consulta la información configurada del negocio para responder sobre servicios, precios, horarios y contacto.</dd></div>
          <div><dt>Atención web y WhatsApp</dt><dd>Revisamos cómo enlazar el espacio de conversación con tu página. El canal de WhatsApp se configura y verifica antes de habilitar la atención.</dd></div>
          <div><dt>Consumo bajo control</dt><dd>La administración permite consultar el uso de IA, definir límites de respuestas y revisar el estado de los canales conectados.</dd></div>
        </dl>
      </section>
      <section id="planes" className="bot-container bot-section" aria-labelledby="bot-plans-heading">
        <div className="bot-section-heading"><h2 id="bot-plans-heading">Planes para tu forma de atender.</h2><p>Una escala por volumen de respuestas, con configuración acordada para tu negocio.</p></div>
        <BotServicePricing />
      </section>
      <section id="contacto" className="bot-container bot-contact" aria-labelledby="bot-contact-heading"><div><h2 id="bot-contact-heading">Hablemos de tu negocio.</h2><p>Cuéntanos dónde atiendes a tus clientes, qué consultas recibes y qué canal quieres conectar.</p></div><a href={sarinWhatsAppUrl} className="bot-button" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Hablar con ALS Dev Studio</a></section>
    </main>
    <footer className="bot-container bot-footer"><SarinBrand compact hub /><p>Desarrollado por <a href="https://www.alsdevstudio.com/">ALS Dev Studio</a></p></footer>
  </div>;
}
