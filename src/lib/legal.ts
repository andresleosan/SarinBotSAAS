export type ConsentScope = 'account' | 'business_client' | 'platform_support';
export type ConsentBusiness = { id: string; name: string; phoneWhatsApp: string };
export const LEGAL_VERSION = '2026-10-18.2';
export const legalContact = {
  "name": "ALS Dev Studio",
  "holder": "Andrés Leonardo Santiago González",
  "nit": "7005674733",
  "address": "Carrera 34 Calle 38 # 38, Medellín, Colombia.",
  "phone": "+57 314 643 2135",
  "email": "alsdevstudio@alsdevstudio.com"
} as const;
export const privacySections = [
  {
    "id": "reservas-representadas",
    "title": "Reservas de salud y para menores representados",
    "paragraphs": [
      "Los negocios habilitados utilizan un formulario sin IA para reservas de salud o para menores representados por un adulto. Antes de recoger sus datos se solicita una autorización específica para esa reserva; los permisos de cuenta y negocio no la sustituyen. Se guarda la referencia del caso, calidad declarada y decisiones; para un menor, solo un nombre breve en la cita privada, separado de la cuenta del adulto que la gestiona.",
      "Google no acredita edad, parentesco o tutela. El negocio revisa dudas de representación por su procedimiento. No se recoge historia clínica ni consentimiento médico. Una selección de salud puede revelar datos sensibles aunque no incluya diagnósticos. La autorización sensible es facultativa: el contacto directo del negocio permite solicitar una alternativa. El formulario sin IA sigue utilizando la infraestructura de autenticación y almacenamiento descrita aquí."
    ]
  },
  {
    "id": "cuenta",
    "title": "Tu cuenta y tus reservas",
    "paragraphs": [
      "SarinBot usa Firebase Authentication con Google para identificarte y comprobar tu acceso. Recibe el identificador de tu cuenta y datos como tu nombre y correo. La autenticación también utiliza información técnica de sesión.",
      "En Cloudflare D1 se conservan los perfiles y permisos, la configuración del negocio, sus servicios y horarios, las citas y su historial de estados, los datos de contacto y las respuestas que proporciones al reservar. También se guardan los datos de planes, pagos y consumo del servicio.",
      "Las imágenes de los comprobantes de transferencia se almacenan en Cloudflare R2 privado y se consultan mediante accesos autorizados. Los logos del negocio se guardan por separado y su versión publicada es accesible desde el perfil. El negocio necesita los datos de sus reservas para atender a sus clientes; la administración de SarinBot dispone de acceso administrativo para operar la plataforma y revisar pagos."
    ]
  },
  {
    "id": "publico",
    "title": "Información pública del negocio",
    "paragraphs": [
      "El nombre, los servicios, precios, horarios y contacto comercial del negocio pueden consultarse mediante su enlace. Las citas asociadas a tu cuenta se consultan después de iniciar sesión. El enlace de un negocio es un espacio comercial público; no es un chat personal privado."
    ]
  },
  {
    "id": "ia",
    "title": "Qué recibe la inteligencia artificial",
    "paragraphs": [
      "Tus mensajes pasan por la aplicación alojada en Cloudflare. Para interpretar tu solicitud, el asistente recibe tu mensaje actual, información del negocio y la selección de servicio, fecha o profesional necesaria para continuar. Si escribes datos personales dentro del mensaje, pueden llegar al proveedor de IA. Evita incluir datos sensibles, diagnósticos o información clínica.",
      "Con Ollama, el modelo se ejecuta en la Mac operada para SarinBot. La conexión remota utiliza HTTPS/TLS, Cloudflare Tunnel y controles de Cloudflare Access. Esto no significa que los mensajes permanezcan únicamente en tu dispositivo.",
      "La administración puede seleccionar el proveedor de IA para los negocios. Si se habilita y selecciona DeepSeek o Gemini, los mensajes y el contexto necesario se envían a la API externa de ese proveedor. Tener una opción en el sistema no significa que esté activa: requiere configuración. No hay cambio automático de proveedor ante un error.",
      "SarinBot mantiene registros de uso, como contadores de respuestas y datos técnicos de las llamadas al proveedor, y guarda la selección de la conversación y las propuestas de reserva para continuar o recuperar una operación. Puede conservar respuestas temporalmente en memoria para gestionar reintentos. No ofrece una garantía de cero registros ni de ausencia de conservación por los proveedores que intervienen."
    ]
  },
  {
    "id": "autorizacion",
    "title": "Tus decisiones y su constancia",
    "paragraphs": [
      "Las condiciones de uso y la autorización de datos se presentan como decisiones separadas, sin casillas premarcadas. La aceptación de cuenta no autoriza automáticamente el chat ni las reservas con todos los negocios. Antes de nuevas operaciones se solicita la autorización correspondiente al negocio identificado.",
      "Se conservan constancias privadas de aceptación y revocación con tu identificador de cuenta, el negocio cuando corresponde, los textos y sus versiones, las finalidades, las decisiones afirmativas y la fecha del servidor. No es necesario guardar tu IP ni el contenido de conversaciones en esas constancias. Puedes consultarlas y retirar la autorización desde el apartado de permisos. Retirarla impide nuevas operaciones de ese ámbito; permite consultar y cancelar citas existentes y ejercer tus derechos. No borra automáticamente los registros ni las obligaciones de conservación aplicables."
    ]
  },
  {
    "id": "conservacion",
    "title": "Conservación y solicitudes",
    "paragraphs": [
      "Actualmente no hay borrado automático general por antigüedad de cuentas, reservas, datos de contacto, comprobantes y registros de uso. Se mantienen copias de recuperación. La política formal de plazos de conservación está pendiente de definición.",
      "Una propuesta pendiente permite confirmar una nueva cita durante diez minutos y la selección de conversación se reinicia al consultarla después de veinticuatro horas sin actualizar. Esa vigencia funcional no elimina automáticamente los registros guardados; las propuestas confirmadas también se conservan para recuperar operaciones sin duplicarlas.",
      "Cancelar una cita cambia su estado y no elimina su registro. Cerrar sesión o cerrar una conversación tampoco borra las reservas o los comprobantes. No se promete eliminación inmediata de todos los sistemas, copias o proveedores.",
      "Para consultar, corregir o solicitar la revisión de la eliminación de tus datos, escribe al contacto de SarinBot indicado abajo. Las consultas y reclamos se atienden manualmente dentro de los plazos legales aplicables. Puedes solicitar acceso, corrección, supresión, copia de tu autorización o su revocación por el correo de contacto."
    ]
  }
] as const;
export const termsSections = [
  {
    "title": "Servicio y cuenta",
    "paragraphs": [
      "SarinBot, prestado por ALS Dev Studio, permite a los negocios administrar servicios y horarios y a sus clientes consultar y solicitar citas. Debes usar tu propia cuenta y aportar datos correctos para las operaciones que solicites. Google identifica tu cuenta; iniciar sesión no sustituye una autorización para todas las finalidades."
    ]
  },
  {
    "title": "Reservas y atención del negocio",
    "paragraphs": [
      "La disponibilidad y el precio se muestran antes de confirmar. Una propuesta no bloquea el horario: la cita queda confirmada cuando se guarda y recibes su confirmación. Las citas usan la zona horaria de Colombia. El negocio presta el servicio reservado y atiende sus cambios, precios y condiciones particulares; puedes contactarlo por el número mostrado.",
      "Puedes consultar y cancelar tus citas desde Mis citas. Cancelar conserva el registro y no devuelve automáticamente los cupos de la prueba del negocio. Cualquier pago, devolución o condición particular del servicio del negocio debe consultarse directamente con él, sin renunciar a los derechos que te correspondan."
    ]
  },
  {
    "title": "Planes, prueba e invitaciones",
    "paragraphs": [
      "Los precios y capacidades vigentes de SarinBot se muestran antes del pago. La prueba de pago incluye diez citas y setecientas respuestas totales, sin vencimiento por días; una invitación válida puede regalar esa misma capacidad. El importe vigente se consulta en Planes y pagos. Las invitaciones pueden estar vinculadas al correo verificado y ser revocadas o suspendidas por la administración.",
      "Los comprobantes de transferencia se revisan manualmente. No se realizan cobros recurrentes automáticos. Una cuota o un presupuesto de IA agotado puede pausar nuevas respuestas; el acceso a citas existentes sigue disponible. Las solicitudes sobre pagos y derechos se atienden por el contacto de soporte."
    ]
  },
  {
    "title": "Uso del asistente y protección",
    "paragraphs": [
      "SarinBot utiliza IA para interpretar solicitudes del negocio y de reservas. Puede pedir aclaraciones o no estar disponible; revisa los datos antes de confirmar. No utilices el asistente como una herramienta general de investigación, para enviar spam ni para intentar acceder a información ajena. Evita datos sensibles, diagnósticos e información clínica.",
      "Los límites y controles pueden detener nuevas operaciones ante uso indebido o capacidad agotada. Esto no elimina tus citas ni impide ejercer tus derechos. No se incorporan aquí renuncias a derechos legales ni una autorización para finalidades futuras indeterminadas."
    ]
  },
  {
    "title": "Datos, cambios y contacto",
    "paragraphs": [
      "La autorización de datos se solicita separadamente y se describe en Privacidad y datos. Si cambian los textos o las finalidades aplicables, se pedirá una nueva decisión antes de nuevas operaciones cuando corresponda; no se considera aceptada por continuar conectado.",
      "ALS Dev Studio recibe solicitudes sobre SarinBot en alsdevstudio@alsdevstudio.com y +57 314 643 2135, Carrera 34 Calle 38 # 38, Medellín, Colombia. Los reclamos y consultas se atienden dentro de los plazos legales."
    ]
  }
] as const;

export function legalText(sections: readonly { title: string; paragraphs: readonly string[] }[]) {
  return sections.map(section => [section.title, ...section.paragraphs].join('\n')).join('\n\n');
}
export function consentContent(scope: ConsentScope, business?: ConsentBusiness) {
  if (scope === 'business_client' && !business) throw new Error('Falta el negocio de la autorización.');
  if (scope === 'platform_support') return {
    version: LEGAL_VERSION, scope, business: null,
    termsAcceptance: 'Acepto las condiciones del soporte de la plataforma SarinBot, prestado por ALS Dev Studio, separadas de las reservas de los negocios.',
    dataAuthorization: 'Autorizo a ALS Dev Studio a tratar mi identidad de Firebase, contacto y consultas de texto o audio para atender el soporte de la plataforma SarinBot por WhatsApp según este aviso. Esta decisión no autoriza reservas, pagos ni operaciones de un negocio.',
    notice: 'Este permiso corresponde al soporte de la plataforma SarinBot, sin negocio destinatario. Requiere una autorización de cuenta vigente y una decisión independiente de soporte. Las capacidades de WhatsApp, audio e IA descritas requieren habilitación; aceptar este permiso no las activa. No envíes datos sensibles, diagnósticos, información clínica ni credenciales.',
    purposes: ['platform_support_identity', 'platform_support_text_audio', 'platform_support_security'],
    terms: legalText([
      { title: 'Soporte de la plataforma SarinBot', paragraphs: ['ALS Dev Studio presta soporte sobre el uso de SarinBot. Este ámbito no representa a un negocio ni permite solicitar o confirmar sus citas, autorizar pagos o cambiar la configuración por el contenido de una conversación. La identidad procede de tu sesión autenticada de Firebase; un mensaje o una transcripción nunca acredita identidad ni sustituye una decisión legal o de pago.'] },
      { title: 'Canal y asistencia sujetos a habilitación', paragraphs: ['Si se habilita el canal, YCloud transportará los mensajes de WhatsApp para la consulta de soporte. Si se habilita audio, Cloudflare Workers AI Whisper transcribirá el audio para esa consulta. Si se habilita la asistencia de IA, DeepSeek interpretará el texto y el contexto mínimo de soporte para preparar la respuesta. Estas capacidades no se consideran encendidas por presentar o aceptar estos documentos. Revisa las respuestas de IA y solicita aclaración cuando sea necesario.'] },
      { title: 'Retirada y constancias', paragraphs: ['Puedes retirar este permiso. La retirada detiene nuevas consultas de soporte por WhatsApp en este ámbito y no revoca por sí sola las decisiones de cuenta o de los negocios. Puedes seguir ejerciendo tus derechos mediante el contacto de ALS Dev Studio. Las constancias legales tienen una política separada: retirar el permiso no elimina automáticamente la evidencia histórica ni las obligaciones de conservación aplicables.'] },
    ]),
    privacy: legalText([
      { title: 'Identidad y finalidad del soporte', paragraphs: ['Firebase Authentication identifica la cuenta autenticada. ALS Dev Studio trata su identificador y los datos de contacto necesarios junto con el texto o audio que decidas aportar exclusivamente para atender tu consulta de soporte de SarinBot y sus controles de seguridad. El permiso de cuenta y el permiso de soporte son decisiones independientes; los permisos de reservas no sustituyen este último.'] },
      { title: 'Proveedores del canal, audio e IA', paragraphs: ['Cuando las funciones correspondientes estén habilitadas, YCloud recibirá el contacto y los mensajes necesarios para transportar WhatsApp; Cloudflare Workers AI Whisper recibirá el audio para transcribir la consulta; DeepSeek recibirá el texto, incluida la transcripción cuando corresponda, y el contexto mínimo para asistir en la respuesta de soporte. La transcripción es contenido de consulta, nunca identidad, aceptación legal ni autoridad de pago. La aceptación no habilita por sí sola ninguna de estas funciones.'] },
      { title: 'Conservación del canal y evidencia legal', paragraphs: ['El contacto y contenido del canal de soporte se conservarán cifrados durante un máximo de 24 horas; el control mínimo necesario para seguridad y continuidad, durante un máximo de 30 días. El audio original se tratará solo en memoria, sin almacenamiento persistente. Estos límites del canal no son los plazos de las constancias legales de aceptación y revocación. Las constancias conservan la identidad, versión, documentos, decisiones y fecha del servidor bajo su política separada; no se promete su borrado automático ni se necesitan conversaciones o IP para acreditarlas.'] },
      { title: 'Consulta, corrección y revocación', paragraphs: ['Puedes consultar o descargar tu constancia, retirar el permiso y solicitar acceso, corrección, supresión o revisión del tratamiento mediante el contacto de ALS Dev Studio. La retirada impide nuevas operaciones de soporte de este ámbito y no borra automáticamente registros históricos. Las consultas y reclamos se atienden manualmente dentro de los plazos legales aplicables.'] },
    ]) + '\n\n' + Object.values(legalContact).join('\n'),
  };
  const termsAcceptance = 'Acepto los Términos y condiciones de uso de SarinBot, prestado por ALS Dev Studio.';
  const dataAuthorization = scope === 'account'
    ? 'Autorizo a ALS Dev Studio a tratar mis datos de identificación y contacto para autenticarme, administrar mi cuenta y atender mis solicitudes, según la Política de tratamiento de datos. Si administro un negocio, incluye gestionar mis pagos y publicar los datos comerciales que decida mostrar.'
    : `Autorizo el tratamiento de mis datos de identificación, contacto, mensajes y reserva para atender mis solicitudes y gestionar mis citas con ${business!.name}, mediante SarinBot, según este aviso y la Política de tratamiento de datos.`;
  const notice = scope === 'account'
    ? 'Tu nombre y correo proceden de Google. Puedes iniciar sesión para consultar o cancelar citas y ejercer tus derechos sin autorizar nuevas operaciones.'
    : `Negocio destinatario: ${business!.name}. Contacto: ${business!.phoneWhatsApp}. El negocio utiliza tus datos para atender sus citas; ALS Dev Studio opera SarinBot y sus controles de cuenta, seguridad y soporte. Este asistente utiliza IA: tu mensaje y el contexto necesario pueden enviarse al proveedor configurado. Evita diagnósticos u otros datos sensibles. Consulta Privacidad y datos para conocer el tratamiento y ejercer tus derechos.`;
  return { version: LEGAL_VERSION, scope, business: scope === 'business_client' ? business! : null, termsAcceptance, dataAuthorization, notice,
    purposes: scope === 'account' ? ['account_authentication', 'account_support', 'owner_payments_when_requested', 'owner_commercial_publication_when_requested'] : ['business_booking', 'business_chat_ai', 'booking_support_security'],
    terms: legalText(termsSections), privacy: legalText(privacySections) + '\n\n' + Object.values(legalContact).join('\n'),
  };
}
export type ConsentDocuments = ReturnType<typeof consentContent> & { fingerprint: string };
export interface ConsentReceipt { uid: string; scope: ConsentScope; businessId: string | null; requestId: string; action: 'accept' | 'revoke'; revision: number; occurredAt: number; preauthorizedAt: number | null; termsAccepted: boolean; dataAuthorized: boolean; documents: ConsentDocuments; }
export interface ConsentStatus { active: boolean; revision: number; documents: ConsentDocuments; receipt: ConsentReceipt | null; }
