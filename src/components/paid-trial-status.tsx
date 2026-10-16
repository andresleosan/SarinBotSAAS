import Link from "next/link";
import { paidTrialRemaining } from "@/lib/paid-trial";
import type { Business } from "@/types/firestore";

export function PaidTrialStatus({ subscription }: { subscription: Business["subscription"] }) {
  const trial = subscription.status === "trial" ? subscription.paidTrial : undefined;
  if (!trial) return null;
  const remaining = paidTrialRemaining(subscription);
  const courtesy = trial.source === 'invitation';
  return (
    <section aria-label={courtesy ? 'Citas de la prueba de cortesía' : 'Citas de la prueba pagada'} className="space-y-2 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5">
      <h2 className="font-semibold">{courtesy ? 'Prueba de cortesía' : 'Prueba pagada'} · sin caducidad</h2>
      {courtesy && <p className="text-sm text-sarin-muted">Diez citas y 700 respuestas; sin cobro.{trial.accessSuspended && ' Acceso de cortesía suspendido. Puedes consultar y cancelar tus citas; contacta a administración.'}</p>}
      <p className="tabular-nums text-sm">{trial.appointmentsUsed} de {trial.appointmentLimit} citas utilizadas · {remaining} disponibles</p>
      <p className="text-sm text-sarin-muted">{remaining === 0 ? "Elige un plan para continuar. Puedes consultar y cancelar tus citas existentes." : "La configuración y la atención de reservas están incluidas. Las cancelaciones no devuelven citas a la prueba."}</p>
      <Link href="/dashboard/billing" className="inline-flex min-h-11 items-center text-sm font-semibold text-sarin-blue underline">Ver planes</Link>
    </section>
  );
}
