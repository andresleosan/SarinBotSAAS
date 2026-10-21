"use client";
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ConsentPanel, useAccountConsent } from '@/components/consent-panel';
import { useConsent } from '@/hooks/useConsent';
import { usePlatformWhatsAppLink } from '@/hooks/usePlatformWhatsAppLink';

const button = 'min-h-11 rounded-[10px] bg-sarin-blue px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'min-h-11 rounded-[10px] border border-sarin-line px-4 py-3 text-sm text-sarin-blue disabled:opacity-50';
const date = (value: number) => new Date(value).toLocaleString('es-CO');
function OwnerLink() {
  const { user } = useAuth();
  const account = useAccountConsent(), support = useConsent(user?.uid, 'platform_support');
  const link = usePlatformWhatsAppLink(account, support);
  const [phone, setPhone] = useState('');
  useEffect(() => { if (link.code || !account.active || !support.active) setPhone(''); }, [link.code, account.active, support.active]);
  const pending = link.status?.pending;
  const confirmed = link.status?.current;
  const livePending = pending && link.clock < pending.expiresAt;
  return <div className="space-y-4">
    <ConsentPanel controller={account} title="Permisos de cuenta" />
    <ConsentPanel controller={support} title="Permisos de soporte de SarinBot" blockedReason={!account.active ? 'Primero revisa los permisos de tu cuenta.' : undefined} />
    <p className="text-sm leading-6 text-sarin-muted">La vinculación acredita el número que controlas para el soporte de SarinBot. No concede acceso de administración ni activa la atención automatizada por WhatsApp.</p>
    {link.loading && <p role="status">Consultando tu vinculación…</p>}
    {link.error && <p role="alert">{link.error}</p>}
    {!link.active && <p role="alert">Vuelve a iniciar sesión para comprobar tu vinculación.</p>}
    {confirmed && <p>Vinculación confirmada: {confirmed.maskedPhone} · {link.clock < confirmed.expiresAt ? 'Vigente hasta ' + date(confirmed.expiresAt) : 'Vencida'}</p>}
    {!confirmed && link.status && <p>No hay una vinculación confirmada en esta lectura.</p>}
    {pending && <p>Solicitud para {pending.maskedPhone} · {livePending ? pending.proof === 'verified' ? 'Número comprobado; falta tu confirmación en esta web.' : 'Esperando el comando desde tu WhatsApp.' : 'Código vencido. Crea otro código para continuar.'}</p>}
    {link.status && !link.status.available && <p>La creación de vínculos no está disponible en este momento. Puedes revocar una vinculación existente.</p>}
    <form onSubmit={event => { event.preventDefault(); link.begin(phone); }} className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="owner-whatsapp-phone">Número de WhatsApp que controlas</label>
      <input id="owner-whatsapp-phone" type="tel" autoComplete="off" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} disabled={!link.canGrant || link.busy} placeholder="+573001234567" aria-describedby="owner-whatsapp-phone-hint" className="min-h-11 w-full rounded-[10px] border border-sarin-line bg-sarin-paper px-3 py-2" />
      <p id="owner-whatsapp-phone-hint" className="text-xs leading-6 text-sarin-muted">Usa formato internacional E164: signo +, indicativo de país y número, sin espacios.</p>
      {pending && <p className="text-sm">Crear otro código invalida la prueba pendiente y consume otra emisión. Tu vínculo confirmado se conserva hasta que confirmes el reemplazo. El servidor limita las emisiones a tres por hora.</p>}
      <button type="submit" className={button} disabled={!link.canGrant || link.busy || Boolean(link.retry) || !/^\+[1-9][0-9]{6,14}$/.test(phone)}>{pending ? 'Crear otro código' : 'Crear código de vinculación'}</button>
    </form>
    {link.code && <div className="min-w-0 space-y-3 rounded-xl border border-sarin-line bg-sarin-soft p-4">
      <p className="text-sm font-semibold">Envía este comando exacto desde el número que controlas</p>
      <code aria-label="Comando temporal de vinculación" className="block select-all break-all whitespace-pre-wrap text-xs leading-6">{link.code.code}</code>
      <p className="text-xs">Vence: {date(link.code.expiresAt)}. El código dura diez minutos y solo aparece en esta sesión. No lo compartas con otras personas.</p>
      <button type="button" className={secondary} onClick={() => void link.copy()}>{link.copied ? 'Comando copiado' : 'Copiar comando'}</button>
      {link.code.whatsappUrl ? <a href={link.code.whatsappUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-flex min-h-11 items-center text-sm text-sarin-blue underline">Abrir chat de vinculación de SarinBot</a> : <p>No hay un destino de vinculación disponible. No envíes el comando a otro contacto; consulta soporte para comprobar el destino.</p>}
      <ol className="list-decimal space-y-2 pl-5 text-sm"><li>Abre el chat de vinculación, copia el comando y pégalo manualmente en WhatsApp.</li><li>Envíalo desde el número indicado. Abrir el chat no envía ningún mensaje.</li><li>Vuelve aquí y actualiza el estado. Cuando el número esté comprobado, confirma en esta web.</li></ol>
    </div>}
    <div className="flex flex-wrap gap-3">
      <button type="button" className={secondary} onClick={link.refresh} disabled={!link.active}>Actualizar estado de vinculación</button>
      {pending?.proof === 'verified' && <button type="button" className={button} onClick={link.confirm} disabled={!link.canGrant || link.busy || Boolean(link.retry) || !livePending}>Confirmar este número en la web</button>}
      {link.status?.revokeGeneration && <button type="button" className={secondary} onClick={link.revoke} disabled={!link.active || link.busy || Boolean(link.retry)}>Revocar vinculación de WhatsApp</button>}
    </div>
    {link.notice && <p role="status" className="text-sm leading-6">{link.notice.message}</p>}
    {link.notice?.recent && link.retry && <button type="button" className={secondary} disabled={link.busy} onClick={() => void link.reauthenticate()}>Volver a verificar mi identidad</button>}
    {link.retry && <button type="button" className={secondary} disabled={!link.canRetry} onClick={link.retryOperation}>Reintentar la misma solicitud</button>}
  </div>;
}
export function PlatformWhatsAppLink() {
  const { user, authEpoch, signingOut, loading, signIn, error } = useAuth();
  return <section aria-label="Vincular mi WhatsApp con SarinBot" className="min-w-0 space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Vincular mi WhatsApp con SarinBot</h2>
    {user && !signingOut ? <OwnerLink key={JSON.stringify([user.uid, authEpoch])} /> : <>
      <p className="text-sm leading-6">Inicia sesión con Google para revisar tus permisos y vincular el número que controlas.</p>
      {error && <p role="alert" className="text-sm">{error}</p>}
      <button type="button" className={button} disabled={loading || signingOut} onClick={() => void signIn()}>Iniciar sesión para vincular WhatsApp</button>
    </>}
  </section>;
}
