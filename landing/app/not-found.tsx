import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-6 px-6">
      <p className="text-sm font-medium text-sarin-blue">Sarin Bot · 404</p>
      <h1 className="text-4xl font-medium tracking-tight">Esta página no está disponible.</h1>
      <p className="text-sarin-muted">Vuelve a la portada para consultar el servicio de chatbot y contactar a ALS Dev Studio.</p>
      <Link href="/" className="inline-flex min-h-12 items-center rounded-[10px] bg-sarin-blue px-6 py-3 font-semibold text-white hover:bg-sarin-blue/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sarin-blue">Volver a la portada</Link>
    </main>
  );
}
