/**
 * One event on the marketplace, Kalshi's card: artwork, series chip, title, the top outcomes
 * with their chance and Yes / No price pills (a binary event gets one big number instead), and
 * a footer with the event's volume and its time to close.
 */
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Clock, Layers } from "lucide-react";
import { compactCC, formatCents, formatPercent, priceDelta, timeLeft } from "@/lib/chartData";
import { toNumber, type ApiEvent, type ApiMarket } from "@/lib/marketsTypes";
import { cn } from "@/lib/utils";

const MAX_ROWS = 3;

function outcomeLabel(m: ApiMarket): string {
  return m.yesSubTitle && m.yesSubTitle.toLowerCase() !== "yes" ? m.yesSubTitle : m.question;
}

function settledLabel(m: ApiMarket): string {
  if (m.status === "Voided" || m.outcome === "VoidOutcome") return "Void";
  return m.outcome ?? "Settled";
}

export default function EventCard({ event }: { event: ApiEvent }) {
  const navigate = useNavigate();
  const markets = (event.markets ?? []).filter((m) => !m.archived);
  const sorted = [...markets].sort((a, b) => toNumber(b.currentPrice) - toNumber(a.currentPrice));
  const binary = sorted.length === 1;
  const lead = sorted[0];
  const shown = sorted.slice(0, MAX_ROWS);
  const hidden = sorted.length - shown.length;
  const settled = event.status === "settled";
  const go = (path: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(path);
  };
  const open = () => navigate(`/events/${event.ticker}`);

  return (
    <article className="k-card k-card-hover flex cursor-pointer flex-col p-4" onClick={open} onKeyDown={(e) => { if (e.key === "Enter") open(); }} tabIndex={0} role="link" aria-label={event.title}>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200/70">
          {event.imageUrl ? (
            <img src={event.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          ) : (
            <Layers className="h-4 w-4 text-slate-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {event.category && <span className="k-chip-soft">{event.category}</span>}
            {event.mutuallyExclusive && sorted.length > 1 && <span className="k-chip-soft text-violet-700">one winner</span>}
            {settled && <span className="k-chip-soft">Settled</span>}
          </div>
          <h3 className="line-clamp-2 text-[15px] font-bold leading-snug tracking-[-0.01em] text-slate-950">{event.title}</h3>
        </div>
        {binary && lead && !settled && (
          <div className="shrink-0 text-right">
            <div className="k-num text-2xl font-bold leading-none tracking-[-0.03em] text-slate-950">{formatPercent(toNumber(lead.currentPrice))}</div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">chance</div>
          </div>
        )}
      </div>

      <div className="mt-3 flex-1">
        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">No markets listed yet</div>
        ) : binary && lead ? (
          <BinaryRow m={lead} settled={settled} go={go} />
        ) : (
          <ul className="space-y-2">
            {shown.map((m) => {
              const p = toNumber(m.currentPrice);
              const done = m.status === "Resolved" || m.status === "Voided";
              return (
                <li key={m.marketId} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800" title={m.question}>{outcomeLabel(m)}</span>
                  {done ? (
                    <span className={cn("inline-flex items-center gap-1 text-xs font-bold", m.outcome === "Yes" ? "text-oracle-yes" : m.outcome === "No" ? "text-oracle-no" : "text-slate-400")}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> {settledLabel(m)}
                    </span>
                  ) : (
                    <>
                      <span className="k-num w-10 shrink-0 text-right text-sm font-bold text-slate-950">{formatPercent(p)}</span>
                      <button type="button" className="pill-yes" onClick={go(`/markets/${m.ticker}?side=yes`)} aria-label={`Buy Yes on ${outcomeLabel(m)} at ${formatCents(p)}`}>Yes {formatCents(p)}</button>
                      <button type="button" className="pill-no" onClick={go(`/markets/${m.ticker}?side=no`)} aria-label={`Buy No on ${outcomeLabel(m)} at ${formatCents(1 - p)}`}>No {formatCents(1 - p)}</button>
                    </>
                  )}
                </li>
              );
            })}
            {hidden > 0 && <li className="text-[11px] font-medium text-slate-500">+{hidden} more outcome{hidden === 1 ? "" : "s"}</li>}
          </ul>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11px] font-medium text-slate-500">
        <span className="k-num">{compactCC(event.volumeCC)} vol</span>
        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{settled ? "Settled" : timeLeft(event.closeTime)}</span>
      </div>
    </article>
  );
}

function BinaryRow({ m, settled, go }: { m: ApiMarket; settled: boolean; go: (path: string) => (e: React.MouseEvent) => void }) {
  const p = toNumber(m.currentPrice);
  const delta = priceDelta(p, m.previousPrice === null ? null : toNumber(m.previousPrice));
  if (settled || m.status === "Resolved" || m.status === "Voided") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
        <CheckCircle2 className={cn("h-4 w-4", m.outcome === "Yes" ? "text-oracle-yes" : m.outcome === "No" ? "text-oracle-no" : "text-slate-400")} />
        <span className="font-semibold text-slate-950">{settledLabel(m)}</span>
        <span className="ml-auto k-num text-xs text-slate-500">closed at {formatPercent(p)}</span>
      </div>
    );
  }
  return (
    <div>
      <div className="outcome-bar"><span style={{ width: `${Math.round(p * 100)}%` }} /></div>
      <div className="mt-2.5 flex items-center gap-2">
        <button type="button" className="pill-yes pill-lg flex-1" onClick={go(`/markets/${m.ticker}?side=yes`)}>{m.yesSubTitle && m.yesSubTitle.toLowerCase() !== "yes" ? m.yesSubTitle : "Yes"} {formatCents(p)}</button>
        <button type="button" className="pill-no pill-lg flex-1" onClick={go(`/markets/${m.ticker}?side=no`)}>{m.noSubTitle && m.noSubTitle.toLowerCase() !== "no" ? m.noSubTitle : "No"} {formatCents(1 - p)}</button>
      </div>
      {delta && delta.direction !== "flat" && (
        <div className={cn("mt-1.5 k-num text-right text-[11px] font-semibold", delta.direction === "up" ? "delta-up" : "delta-down")}>{delta.text} pts today</div>
      )}
    </div>
  );
}
