import Link from "next/link";
import { paidTrialRemaining } from "@/lib/paid-trial";
import type { Business } from "@/types/firestore";

export function PaidTrialStatus({ subscription }: { subscription: Business["subscription"] }) {
  const trial = subscription.status === "trial" ? subscription.paidTrial : undefined;
  if (!trial) return null;
  const remaining = paidTrialRemaining(subscription);
  return (
    <section aria-label="Citas de la prueba pagada" className="space-y-2 rounded-2xl border border-sarin-line bg-sarin-paper p-4 sm:p-5">
      <h2 className="font-semibold">Prueba pagada · sin caducidad</h2>
      <p className="tabular-nums text-sm">{trial.appointmentsUsed} de {trial.appointmentLimit} citas utilizadas · {remaining} disponibles</p>
      <p className="text-sm text-sarin-muted">{remaining === 0 ? "Elige un plan para continuar. Puedes consultar y cancelar tus citas existentes." : "La configuración y la atención de reservas están incluidas. Las cancelaciones no devuelven citas a la prueba."}</p>
      <Link href="/dashboard/billing" className="inline-flex min-h-11 items-center text-sm font-semibold text-sarin-blue underline">Ver planes</Link>
    </section>
  );
}
