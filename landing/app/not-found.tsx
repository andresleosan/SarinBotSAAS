import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-6 px-6">
      <p className="sarin-eyebrow text-emerald-500">Sarin Bot · 404</p>
      <h1 className="text-4xl font-medium tracking-tight">Esta página no está disponible.</h1>
      <p className="text-slate-400">Estamos preparando el lanzamiento. Puedes conocer Sarin desde la portada.</p>
      <Link href="/" className="rounded-full bg-emerald-500 px-6 py-3 font-semibold text-slate-950 hover:bg-emerald-400">Volver a la portada</Link>
    </main>
  );
}
