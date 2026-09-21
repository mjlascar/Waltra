import Link from "next/link";

export default function NotFound() {
  return (
    <div className="pt-20 text-center">
      <p className="eyebrow mb-3">Página inexistente</p>
      <h1 className="text-[20px] font-semibold tracking-tight">Acá no hay nada</h1>
      <Link href="/" className="btn btn-primary mt-6 inline-flex">
        Volver al resumen
      </Link>
    </div>
  );
}
