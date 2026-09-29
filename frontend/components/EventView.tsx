/**
 * Event page (`/events/:ticker`): one dated question with its N binary pm-AMM markets, the way
 * Kalshi lays out an event — header, the legs table with Yes / No prices and 24 h figures,
 * and one chart with every leg's Yes price (truthoracle-backend docs/MARKETS.md §3).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Clock, Layers, Loader2, ShieldCheck } from "lucide-react";
import { formatCents } from "@/lib/marketPricing";
import { fetchCandlesticks, fetchEvent } from "@/lib/marketsApi";
import { toNumber, type ApiCandle, type ApiEvent, type ApiMarket } from "@/lib/marketsTypes";
import { cn } from "@/lib/utils";

const LEG_COLORS = ["#138b61", "#2563eb", "#d97706", "#9333ea", "#dc2626", "#0891b2", "#4b5563"];
const STATUS_LABEL: Record<ApiEvent["status"], string> = {
  unopened: "Opens soon",
  open: "Trading",
  closed: "Awaiting resolution",
  settled: "Settled",
};

function LegsChart({ legs }: { legs: ApiMarket[] }) {
  const [series, setSeries] = useState<Map<number, ApiCandle[]>>(new Map());
  const shown = legs.slice(0, LEG_COLORS.length);
  useEffect(() => {
    let cancelled = false;
    const nowSec = Math.floor(Date.now() / 1000);
    const earliest = Math.min(...shown.map((m) => Math.floor(Date.parse(m.createdAt) / 1000)));
    const startTs = Math.max(earliest, nowSec - 30 * 86_400);
    Promise.all(
      shown.map((m) =>
        fetchCandlesticks(m.marketId, { startTs, endTs: nowSec, periodInterval: 60 })
          .then((r): [number, ApiCandle[]] => [m.marketId, r.candlesticks])
          .catch((): [number, ApiCandle[]] => [m.marketId, []]),
      ),
    ).then((pairs) => {
      if (!cancelled) setSeries(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs.map((m) => m.marketId).join(",")]);

  const W = 940;
  const H = 178;
  const paths = useMemo(() => {
    const all = [...series.values()].flat();
    if (all.length === 0) return [];
    const minTs = Math.min(...all.map((c) => c.startTs));
    const maxTs = Math.max(...all.map((c) => c.endTs));
    const span = Math.max(1, maxTs - minTs);
    return shown.map((m, i) => {
      const candles = series.get(m.marketId) ?? [];
      const d = candles
        .map((c, j) => `${j === 0 ? "M" : "L"}${((c.startTs - minTs) / span) * 880} ${2 + (1 - toNumber(c.price.close)) * (H - 2)}`)
        .join(" ");
      return { marketId: m.marketId, d, color: LEG_COLORS[i % LEG_COLORS.length] };
    });
  }, [series, shown]);

  return (
    <section className="market-history-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <p className="eyebrow !mb-0">Yes price of every market · last 30 days · hourly</p>
        <div className="flex flex-wrap gap-3 text-xs">
          {shown.map((m, i) => (
            <span key={m.marketId} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: LEG_COLORS[i % LEG_COLORS.length] }} />
              {m.yesSubTitle || m.ticker}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 30}`} className="h-56 w-full" role="img" aria-label="Yes price of every market in this event">
        <path d={`M0 ${H}H880 M0 134H880 M0 90H880 M0 46H880 M0 2H880`} className="chart-grid" />
        {paths.map((p) => (
          <path key={p.marketId} d={p.d} fill="none" stroke={p.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {[100, 75, 50, 25, 0].map((label, index) => (
          <text key={label} x="895" y={6 + index * 44} className="market-chart-axis-label">
            {label}%
          </text>
        ))}
        {paths.length === 0 && (
          <text x={W / 2 - 80} y={H / 2} className="market-chart-axis-label">
            No price history yet.
          </text>
        )}
      </svg>
    </section>
  );
}

export default function EventView() {
  const { ticker = "" } = useParams<{ ticker: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<ApiEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchEvent(ticker)
        .then((e) => {
          if (cancelled) return;
          setEvent(e);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError((e as { status?: number }).status === 404 ? "This event does not exist." : "Could not load the event.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ticker]);

  if (loading && !event) {
    return (
      <div className="page-container flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!event) {
    return (
      <div className="page-container py-16 text-center text-sm text-muted-foreground">
        {error ?? "Event not found."}{" "}
        <Link to="/marketplace" className="quiet-link">
          Back to markets
        </Link>
      </div>
    );
  }

  const legs = (event.markets ?? []).filter((m) => !m.archived);
  const yesSum = legs.filter((m) => m.status === "Trading").reduce((acc, m) => acc + toNumber(m.currentPrice), 0);
  const close = event.closeTime ? new Date(event.closeTime) : null;

  return (
    <div className="page-container space-y-6 py-6">
      <div>
        <Link to="/marketplace" className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-primary">
          <ArrowLeft className="h-3.5 w-3.5" /> All markets
        </Link>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="rounded-full bg-secondary px-3 py-1 font-mono">{event.ticker}</span>
          {event.category && <span className="text-oracle-blue">{event.category}</span>}
          <Link to={`/marketplace?series=${event.seriesTicker}`} className="hover:text-primary">
            Series {event.seriesTicker}
          </Link>
          <span className={cn("font-semibold", event.status === "open" ? "text-emerald-700" : "text-slate-500")}>{STATUS_LABEL[event.status]}</span>
        </div>
        <h1 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">{event.title}</h1>
        {event.subTitle && <p className="mt-1 text-base text-muted-foreground">{event.subTitle}</p>}
        {event.description && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{event.description}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Markets</div>
          <div className="mt-1 text-xl font-bold text-foreground">{legs.length}</div>
          <div className="text-[11px] text-muted-foreground">{event.mutuallyExclusive ? "mutually exclusive — one resolves Yes" : "independent outcomes"}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Volume</div>
          <div className="mt-1 text-xl font-bold text-foreground">{toNumber(event.volumeCC).toFixed(1)} CC</div>
          <div className="text-[11px] text-muted-foreground">across every market</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Closes</div>
          <div className="mt-1 text-xl font-bold text-foreground">{close ? close.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</div>
          <div className="text-[11px] text-muted-foreground">{close ? close.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "no markets yet"}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{event.mutuallyExclusive ? "Σ Yes prices" : "Strike"}</div>
          <div className="mt-1 text-xl font-bold text-foreground">
            {event.mutuallyExclusive ? `${(yesSum * 100).toFixed(0)}%` : event.strikeDate ? new Date(event.strikeDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : (event.strikePeriod ?? "—")}
          </div>
          <div className="text-[11px] text-muted-foreground">{event.mutuallyExclusive ? "independent pools; arbitrage keeps this near 100%" : "date this event is about"}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Layers className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Markets in this event</h2>
        </div>
        {legs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No markets listed yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Outcome</th>
                <th className="px-2 py-2 text-right">Yes</th>
                <th className="px-2 py-2 text-right">24h</th>
                <th className="hidden px-2 py-2 text-right sm:table-cell">Volume</th>
                <th className="hidden px-2 py-2 text-right md:table-cell">Open interest</th>
                <th className="px-4 py-2 text-right">Trade</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((m, i) => {
                const p = toNumber(m.currentPrice);
                const change = m.priceChange24h === null ? null : toNumber(m.priceChange24h) * 100;
                const done = m.status === "Resolved" || m.status === "Voided";
                return (
                  <tr key={m.marketId} className="border-t border-border">
                    <td className="px-4 py-3">
                      <Link to={`/market/${m.ticker}`} className="flex items-center gap-2 font-medium text-foreground hover:text-primary">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LEG_COLORS[i % LEG_COLORS.length] }} />
                        <span>
                          {m.yesSubTitle || m.question}
                          <span className="ml-2 font-mono text-[11px] text-muted-foreground">{m.ticker}</span>
                        </span>
                      </Link>
                      {m.yesSubTitle && <div className="pl-[18px] text-[11px] text-muted-foreground">{m.question}</div>}
                    </td>
                    <td className="px-2 py-3 text-right text-base font-bold text-foreground">
                      {done ? (m.outcome === "VoidOutcome" || m.status === "Voided" ? "Void" : m.outcome) : `${(p * 100).toFixed(1)}%`}
                    </td>
                    <td className={cn("px-2 py-3 text-right text-xs font-semibold", change === null ? "text-muted-foreground" : change >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}`}
                    </td>
                    <td className="hidden px-2 py-3 text-right text-xs text-muted-foreground sm:table-cell">{toNumber(m.totalVolumeCC).toFixed(1)} CC</td>
                    <td className="hidden px-2 py-3 text-right text-xs text-muted-foreground md:table-cell">{toNumber(m.openInterest.total).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right">
                      {done ? (
                        <Link to={`/market/${m.ticker}`} className="quiet-link text-xs">
                          View
                        </Link>
                      ) : (
                        <div className="inline-flex gap-1.5">
                          <button className="btn-yes !w-auto !px-2.5 !py-1 !text-xs" onClick={() => navigate(`/market/${m.ticker}?side=yes`)}>
                            Yes {formatCents(p)}
                          </button>
                          <button className="btn-no !w-auto !px-2.5 !py-1 !text-xs" onClick={() => navigate(`/market/${m.ticker}?side=no`)}>
                            No {formatCents(1 - p)}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {legs.length > 0 && <LegsChart legs={legs} />}

      {event.settlementSources.length > 0 && (
        <div className="rounded-xl border border-primary/20 border-l-4 border-l-primary bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Settlement sources</h2>
          </div>
          <ul className="space-y-1 text-sm">
            {event.settlementSources.map((s) => (
              <li key={`${s.name}-${s.url}`}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
              </li>
            ))}
          </ul>
          {close && (
            <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Every market resolves from its own rules after it closes; the event settles once all of them have.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
