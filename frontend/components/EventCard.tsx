import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Clock, Layers, TrendingUp } from "lucide-react";
import { formatCents } from "@/lib/marketPricing";
import { toNumber, type ApiEvent, type ApiMarket } from "@/lib/marketsTypes";
import { cn } from "@/lib/utils";

function closeLabel(closeTime: string | null): string {
  if (!closeTime) return "No markets yet";
  const s = Math.floor((Date.parse(closeTime) - Date.now()) / 1000);
  if (s <= 0) return "Closed";
  const d = Math.floor(s / 86400);
  if (d > 0) return `${d}d left`;
  const h = Math.floor(s / 3600);
  if (h > 0) return `${h}h left`;
  return `${Math.floor(s / 60)}m left`;
}

const STATUS_LABEL: Record<ApiEvent["status"], string> = {
  unopened: "Opens soon",
  open: "Trading",
  closed: "Awaiting resolution",
  settled: "Settled",
};

/** One event on the marketplace: its legs with their Yes prices, Kalshi's event-card layout. */
export default function EventCard({ event }: { event: ApiEvent }) {
  const navigate = useNavigate();
  const legs = (event.markets ?? []).filter((m) => !m.archived);
  const shown = legs.slice(0, 4);
  const settled = event.status === "settled";

  const legLabel = (m: ApiMarket): string => m.yesSubTitle || m.question;

  return (
    <article className="market-card cursor-pointer p-4" onClick={() => navigate(`/events/${event.ticker}`)}>
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary ring-1 ring-border">
          {event.imageUrl ? (
            <img src={event.imageUrl} alt="" className="h-full w-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          ) : (
            <Layers className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{event.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {event.category && <span className="text-oracle-blue">{event.category}</span>}
            <span className="font-mono">{event.ticker}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {closeLabel(event.closeTime)}
            </span>
            {event.mutuallyExclusive && <span className="text-oracle-purple">one outcome</span>}
          </div>
        </div>
      </div>

      {legs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No markets listed yet.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((m) => {
            const p = toNumber(m.currentPrice);
            const done = m.status === "Resolved" || m.status === "Voided";
            return (
              <li key={m.marketId} className="flex items-center gap-2 text-xs">
                <Link
                  to={`/market/${m.ticker}`}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-primary"
                  title={m.question}
                >
                  {legLabel(m)}
                </Link>
                {done ? (
                  <span className={cn("inline-flex items-center gap-1 font-semibold", m.outcome === "Yes" ? "text-oracle-yes" : m.outcome === "No" ? "text-oracle-no" : "text-muted-foreground")}>
                    <CheckCircle2 className="h-3 w-3" />
                    {m.outcome === "VoidOutcome" || m.status === "Voided" ? "Void" : m.outcome}
                  </span>
                ) : (
                  <>
                    <span className="w-12 text-right font-semibold text-foreground">{Math.round(p * 100)}%</span>
                    <button
                      className="btn-yes !w-auto !px-2 !py-1 !text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/market/${m.ticker}?side=yes`);
                      }}
                    >
                      Yes {formatCents(p)}
                    </button>
                    <button
                      className="btn-no !w-auto !px-2 !py-1 !text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/market/${m.ticker}?side=no`);
                      }}
                    >
                      No {formatCents(1 - p)}
                    </button>
                  </>
                )}
              </li>
            );
          })}
          {legs.length > shown.length && (
            <li className="text-[11px] text-muted-foreground">+{legs.length - shown.length} more market{legs.length - shown.length === 1 ? "" : "s"}</li>
          )}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-3 w-3" />
          {toNumber(event.volumeCC).toFixed(1)} CC volume
        </span>
        <span className={cn("font-medium", settled ? "text-muted-foreground" : "text-emerald-700")}>{STATUS_LABEL[event.status]}</span>
      </div>
    </article>
  );
}
