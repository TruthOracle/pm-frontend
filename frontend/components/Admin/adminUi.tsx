/** Shared look of the operator console cards (CatalogPanel, MarketPresentationCard). */
export const field = "input-field";
export const label = "mb-1 block text-xs font-semibold text-slate-600";
export const btn = "rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60";
export const btnQuiet = "rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60";

export function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-950">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
