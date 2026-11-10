"use client";

import { useState, type ReactNode } from 'react';
import { useOwnerBookingDeclaration } from '@/hooks/use-owner-booking-declaration';
import { BOOKING_DECLARATION_TEXT } from '@/lib/booking-declaration';
import { Notice, buttonClass } from '@/components/app-shell';

export type OwnerBookingDeclarationProps = {
  businessId: string;
  uid: string;
  authEpoch: number;
  className?: string;
};

export function OwnerBookingDeclaration({
  businessId,
  uid,
  authEpoch,
  className = '',
}: OwnerBookingDeclarationProps) {
  const { view, loading, error, pending, declare, withdraw, refresh } = useOwnerBookingDeclaration(uid, authEpoch, businessId);
  const [accepted, setAccepted] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  if (loading && !view) {
    return (
      <section aria-label="Declaración de reservas del negocio" className={`rounded-2xl border border-sarin-line bg-sarin-paper p-5 ${className}`}>
        <p role="status" className="text-sm text-sarin-muted">Consultando clasificación de reservas…</p>
      </section>
    );
  }

  const capability = view?.capability;
  const admission = capability?.admission ?? 'classification_required';
  const isHealth = capability?.dataMode === 'health';
  const isOwnerOrigin = view?.origin === 'owner';
  const isAdminOrigin = view?.origin === 'admin';

  return (
    <section aria-label="Declaración de reservas del negocio" className={`space-y-4 rounded-2xl border border-sarin-line bg-sarin-paper p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Clasificación de reservas</h2>
        <span
          className="rounded-full border border-sarin-line px-3 py-1 text-xs font-medium text-sarin-ink"
          data-admission-state={admission}
        >
          {admission === 'active' && (isHealth ? 'Salud · Formulario sin IA' : 'Clasificación activa')}
          {admission === 'classification_required' && 'Requiere clasificación'}
          {admission === 'withdrawn' && 'Declaración retirada'}
          {admission === 'administrative_review' && 'Requiere revisión administrativa'}
          {admission === 'transitioning' && 'En transición'}
        </span>
      </div>

      {error && (
        <div className="space-y-2">
          <Notice error>{error}</Notice>
          <button type="button" className="min-h-11 text-sm text-sarin-blue underline" onClick={refresh} disabled={pending}>
            Consultar clasificación actual
          </button>
        </div>
      )}

      {view?.outcome === 'pending' && (
        <div className="space-y-2">
          <Notice>La operación quedó pendiente de resolución. Puedes consultar el estado actual sin repetir la solicitud.</Notice>
          <button type="button" className="min-h-11 text-sm text-sarin-blue underline" onClick={refresh} disabled={pending}>
            Consultar resultado de la operación
          </button>
        </div>
      )}

      {admission === 'classification_required' && (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-sarin-muted">
            Para habilitar nuevas reservas de clientes y la atención con SarinBot, debes confirmar que este negocio ofrece servicios generales para adultos.
          </p>
          <blockquote className="rounded-xl border border-sarin-line bg-sarin-canvas p-4 text-sm italic leading-relaxed text-sarin-ink">
            &ldquo;{BOOKING_DECLARATION_TEXT}&rdquo;
          </blockquote>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              aria-label="Acepto la declaración de clasificación"
              checked={accepted}
              disabled={pending}
              onChange={e => setAccepted(e.target.checked)}
              className="h-5 w-5 rounded border-sarin-line accent-sarin-blue"
            />
            <span>Confirmo que he leído y acepto la declaración para este negocio.</span>
          </label>
          <div>
            <button
              type="button"
              className={buttonClass}
              disabled={!accepted || pending}
              onClick={async () => {
                if (!accepted || pending) return;
                await declare();
                setAccepted(false);
              }}
            >
              {pending ? 'Guardando declaración…' : 'Declarar servicios generales para adultos'}
            </button>
          </div>
        </div>
      )}

      {admission === 'active' && (
        <div className="space-y-3 text-sm">
          {isOwnerOrigin && (
            <>
              <p className="text-sarin-muted">
                Declarado por el dueño · versión de texto {view.declaration?.textVersion ?? 'general-adults-v1'}.
              </p>
              {view.declaration?.receiptId && (
                <p className="text-xs text-sarin-muted">
                  Comprobante privado: <span className="font-mono">{view.declaration.receiptId}</span>
                </p>
              )}
              {!confirmWithdraw ? (
                <button
                  type="button"
                  className="min-h-11 text-sm text-rose-700 underline"
                  disabled={pending}
                  onClick={() => setConfirmWithdraw(true)}
                >
                  Retirar declaración de reservas
                </button>
              ) : (
                <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-rose-900">
                  <p className="font-medium">
                    ¿Retirar la declaración? Se suspenderán nuevas reservas y la atención con IA, conservando tus citas y configuración existentes.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="min-h-11 rounded-lg bg-rose-700 px-4 py-2 font-medium text-white hover:bg-rose-800 disabled:opacity-50"
                      disabled={pending}
                      onClick={async () => {
                        await withdraw();
                        setConfirmWithdraw(false);
                      }}
                    >
                      {pending ? 'Retirando…' : 'Confirmar retirada'}
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={pending}
                      onClick={() => setConfirmWithdraw(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {isAdminOrigin && (
            <p className="text-sarin-muted">
              Clasificación establecida por superadministración · versión {capability?.revision ?? 0}.
              {isHealth ? ' Salud: las reservas usan formulario estructurado sin IA.' : ' Servicios generales para adultos.'}
            </p>
          )}
        </div>
      )}

      {admission === 'withdrawn' && (
        <div className="space-y-4 text-sm">
          <Notice>
            La declaración fue retirada por el dueño. Nuevas reservas y atención por IA están pausadas. Tus citas existentes y configuración permanecen intactas.
          </Notice>
          <blockquote className="rounded-xl border border-sarin-line bg-sarin-canvas p-4 italic leading-relaxed text-sarin-ink">
            &ldquo;{BOOKING_DECLARATION_TEXT}&rdquo;
          </blockquote>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              aria-label="Acepto la declaración de clasificación"
              checked={accepted}
              disabled={pending}
              onChange={e => setAccepted(e.target.checked)}
              className="h-5 w-5 rounded border-sarin-line accent-sarin-blue"
            />
            <span>Deseo declarar nuevamente servicios generales para adultos.</span>
          </label>
          <div>
            <button
              type="button"
              className={buttonClass}
              disabled={!accepted || pending}
              onClick={async () => {
                if (!accepted || pending) return;
                await declare();
                setAccepted(false);
              }}
            >
              {pending ? 'Guardando declaración…' : 'Declarar de nuevo'}
            </button>
          </div>
        </div>
      )}

      {admission === 'administrative_review' && (
        <div className="space-y-2 text-sm text-sarin-muted">
          <p>
            Este negocio requiere revisión administrativa para admitir nuevas reservas. Las citas existentes se conservan. Para reactivar las reservas, contacta a administración.
          </p>
        </div>
      )}

      {admission === 'transitioning' && (
        <div className="space-y-3 text-sm text-sarin-muted">
          <p>
            La clasificación de reservas está actualizándose. Esperando la resolución de despachos en curso…
          </p>
          <button type="button" className={buttonClass} onClick={refresh} disabled={pending}>
            Consultar resultado
          </button>
        </div>
      )}
    </section>
  );
}
