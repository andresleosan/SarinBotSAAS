import type { Metadata } from "next";
import Link from "next/link";
import { SarinBrand } from "@/components/sarin-brand";

export const metadata: Metadata = {
  title: "Privacidad y datos · Sarin Bot",
  description: "Qué datos utiliza Sarin para gestionar cuentas, reservas, pagos y respuestas de inteligencia artificial.",
};

const linkClass = "text-sarin-blue underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-sarin-canvas text-sarin-ink">
      <a href="#contenido" className="sarin-skip">Saltar al contenido</a>
      <header className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 border-b border-sarin-line px-5 py-6 sm:px-8">
        <Link href="/" aria-label="Sarin Bot, inicio"><SarinBrand /></Link>
        <nav aria-label="Información de Sarin" className="flex flex-wrap gap-5 text-sm">
          <Link href="/ayuda" className={`inline-flex min-h-11 items-center ${linkClass}`}>Ayuda</Link>
          <Link href="/privacidad" aria-current="page" className="inline-flex min-h-11 items-center font-semibold">Privacidad</Link>
        </nav>
      </header>
      <main id="contenido" className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Privacidad y datos</h1>
        <p className="mt-3 text-sm leading-7 text-sarin-muted">Esta página explica el funcionamiento actual de Sarin. Última actualización: 16 de octubre de 2026.</p>
        <div className="mt-8 space-y-8 rounded-2xl border border-sarin-line bg-sarin-paper p-5 text-sm leading-7 sm:p-8">
          <section aria-labelledby="cuenta">
            <h2 id="cuenta" className="text-lg font-semibold">Tu cuenta y tus reservas</h2>
            <p className="mt-2">Sarin usa Firebase Authentication con Google para identificarte y comprobar tu acceso. Recibe el identificador de tu cuenta y datos como tu nombre y correo. La autenticación también utiliza información técnica de sesión.</p>
            <p className="mt-3">En Cloudflare D1 se conservan los perfiles y permisos, la configuración del negocio, sus servicios y horarios, las citas y su historial de estados, los datos de contacto y las respuestas que proporciones al reservar. También se guardan los datos de planes, pagos y consumo del servicio.</p>
            <p className="mt-3">Las imágenes de los comprobantes de transferencia se almacenan en Cloudflare R2 privado y se consultan mediante accesos autorizados. Los logos del negocio se guardan por separado y su versión publicada es accesible desde el perfil. El negocio necesita los datos de sus reservas para atender a sus clientes; la administración de Sarin dispone de acceso administrativo para operar la plataforma y revisar pagos.</p>
          </section>
          <section aria-labelledby="publico">
            <h2 id="publico" className="text-lg font-semibold">Información pública del negocio</h2>
            <p className="mt-2">El nombre, los servicios, precios, horarios y contacto comercial del negocio pueden consultarse mediante su enlace. Las citas asociadas a tu cuenta se consultan después de iniciar sesión. El enlace de un negocio es un espacio comercial público; no es un chat personal privado.</p>
          </section>
          <section aria-labelledby="ia">
            <h2 id="ia" className="text-lg font-semibold">Qué recibe la inteligencia artificial</h2>
            <p className="mt-2">Tus mensajes pasan por la aplicación alojada en Cloudflare. Para interpretar tu solicitud, el asistente recibe tu mensaje actual, información del negocio y la selección de servicio, fecha o profesional necesaria para continuar. Si escribes datos personales dentro del mensaje, pueden llegar al proveedor de IA. Evita incluir datos sensibles, diagnósticos o información clínica.</p>
            <p className="mt-3">Con Ollama, el modelo se ejecuta en la Mac operada para Sarin. La conexión remota utiliza HTTPS/TLS, Cloudflare Tunnel y controles de Cloudflare Access. Esto no significa que los mensajes permanezcan únicamente en tu dispositivo.</p>
            <p className="mt-3">La administración puede seleccionar el proveedor de IA para los negocios. Si se habilita y selecciona DeepSeek o Gemini, los mensajes y el contexto necesario se envían a la API externa de ese proveedor. Tener una opción en el sistema no significa que esté activa: requiere configuración. No hay cambio automático de proveedor ante un error.</p>
            <p className="mt-3">Sarin mantiene registros de uso, como contadores de respuestas y datos técnicos de las llamadas al proveedor, y guarda la selección de la conversación y las propuestas de reserva para continuar o recuperar una operación. Puede conservar respuestas temporalmente en memoria para gestionar reintentos. No ofrece una garantía de cero registros ni de ausencia de conservación por los proveedores que intervienen.</p>
          </section>
          <section aria-labelledby="conservacion">
            <h2 id="conservacion" className="text-lg font-semibold">Conservación y solicitudes</h2>
            <p className="mt-2">Actualmente no hay borrado automático general por antigüedad de cuentas, reservas, datos de contacto, comprobantes y registros de uso. Se mantienen copias de recuperación. La política formal de plazos de conservación está pendiente de definición.</p>
            <p className="mt-3">Una propuesta pendiente permite confirmar una nueva cita durante diez minutos y la selección de conversación se reinicia al consultarla después de veinticuatro horas sin actualizar. Esa vigencia funcional no elimina automáticamente los registros guardados; las propuestas confirmadas también se conservan para recuperar operaciones sin duplicarlas.</p>
            <p className="mt-3">Cancelar una cita cambia su estado y no elimina su registro. Cerrar sesión o cerrar una conversación tampoco borra las reservas o los comprobantes. No se promete eliminación inmediata de todos los sistemas, copias o proveedores.</p>
            <p className="mt-3">Para consultar, corregir o solicitar la revisión de la eliminación de tus datos, escribe al contacto de Sarin indicado abajo. Las solicitudes se revisan de forma manual; esta página no fija un plazo automático de atención.</p>
          </section>
          <section aria-labelledby="contacto">
            <h2 id="contacto" className="text-lg font-semibold">Responsable y contacto de Sarin</h2>
            <p className="mt-2">ALS Dev Studio</p>
            <p className="mt-2">Nombre comercial de Andrés Leonardo Santiago González, persona natural que presta servicios de desarrollo web y software desde Medellín, Colombia.</p>
            <dl className="mt-3 space-y-3">
              <div><dt className="font-medium">NIT</dt><dd>7005674733</dd></div>
              <div><dt className="font-medium">Dirección de contacto y notificaciones</dt><dd><address className="not-italic">Carrera 34 Calle 38 # 38, Medellín, Colombia.</address></dd></div>
              <div><dt className="font-medium">Correo para consultas y solicitudes sobre datos</dt><dd><a href="mailto:alsdevstudio@alsdevstudio.com" className={`inline-block min-h-11 break-all py-2 ${linkClass}`}>alsdevstudio@alsdevstudio.com</a></dd></div>
              <div><dt className="font-medium">Teléfono</dt><dd><a href="tel:+573146432135" className={`inline-block min-h-11 py-2 ${linkClass}`}>+57 314 643 2135</a></dd></div>
            </dl>
            <p className="mt-2">Para cambios en el servicio reservado o en tu atención, contacta también al negocio correspondiente.</p>
          </section>
        </div>
        <footer className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/ayuda" className={`inline-flex min-h-11 items-center ${linkClass}`}>Cómo funcionan las citas y los pagos</Link>
          <Link href="/" className={`inline-flex min-h-11 items-center ${linkClass}`}>Volver al inicio</Link>
        </footer>
      </main>
    </div>
  );
}
