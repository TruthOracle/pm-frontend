/**
 * The portfolio's headline figures over the position rows (portfolioRows.ts): how many markets
 * the party is in, how many are still open or redeemable, and — per collateral instrument,
 * because a cBYN figure and a Canton Coin figure never add up — the lifetime cost basis and what
 * is redeemable right now. In-app balances are the wallet card's; pending payouts the table below.
 */
import { PieChart } from "lucide-react";
import { formatMoney, useInstruments } from "@/lib/instruments";
import { summarizeRows, type ActivityRow } from "./portfolioRows";

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-extrabold tabular-nums text-slate-950">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

/** One line per instrument, or a dash when there is nothing to add up. */
function PerInstrument({ figures }: { figures: { symbol: string; text: string }[] }) {
  if (figures.length === 0) return <>—</>;
  return (
    <div className="space-y-0.5">
      {figures.map((f) => (
        <div key={f.symbol}>{f.text}</div>
      ))}
    </div>
  );
}

function Summary({ rows, loading }: { rows: ActivityRow[]; loading: boolean }) {
  const instruments = useInstruments().data;
  const summary = summarizeRows(rows, instruments);
  const costBasis = summary.byInstrument.map((t) => ({ symbol: t.instrument.symbol, text: formatMoney(t.costBasis, t.instrument, 2) }));
  const redeemable = summary.byInstrument
    .filter((t) => t.redeemable > 0)
    .map((t) => ({ symbol: t.instrument.symbol, text: formatMoney(t.redeemable, t.instrument, 2) }));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60">
      <div className="mb-3 flex items-center gap-2">
        <PieChart className="h-4 w-4 text-primary" />
        <h2 className="text-base font-extrabold text-slate-950">Summary</h2>
      </div>
      {loading && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Loading positions...</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Markets" value={String(summary.markets)} hint={`${summary.open} open · ${summary.redeemableMarkets} redeemable`} />
          <Tile label="Cost basis" value={<PerInstrument figures={costBasis} />} hint="lifetime collateral spent, per instrument" />
          <Tile label="Redeemable now" value={<PerInstrument figures={redeemable} />} hint="winning shares and void refunds, per instrument" />
          <Tile
            label="Instruments"
            value={summary.byInstrument.length === 0 ? "—" : summary.byInstrument.map((t) => t.instrument.symbol).join(" · ")}
            hint={summary.byInstrument.map((t) => `${t.markets} in ${t.instrument.symbol}`).join(" · ") || "no positions yet"}
          />
        </div>
      )}
    </section>
  );
}

export default Summary;
