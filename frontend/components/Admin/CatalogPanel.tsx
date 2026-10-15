/**
 * Operator console for the market catalog (truthoracle-backend docs/MARKETS.md §2–§4, §8):
 * series and events, the treasury-signed market factory (CreateMarketForm — the only way a
 * market is created from this UI), the market presentation overrides (image and description
 * are backend metadata since truthoracle-v16, not contract fields) and the trading halt.
 * Everything here calls the backend's admin API under the operator session the console shares
 * (BackendOperatorSession.tsx — a wallet-signed challenge, ARCHITECTURE §7.4), so the panel
 * renders nothing until that session exists and never asks for it itself.
 */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { authErrorMessage } from "@/auth/wallet";
import { createEvent, createSeries, setTradingHalt, updateEvent, updateSeries } from "@/lib/backendAdmin";
import { fetchEvents, fetchExchangeStatus, fetchMarketsPage, fetchSeriesList } from "@/lib/marketsApi";
import { eventInstrument, type ApiEvent, type ApiExchangeStatus, type ApiMarket, type ApiSeries } from "@/lib/marketsTypes";
import { formatMoney } from "@/lib/instruments";
import { btn, btnQuiet, Card, field, label, useRun, type Run } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import CreateMarketForm from "./CreateMarketForm";
import MarketPresentationCard from "./MarketPresentationCard";
import { formatDateTimeUTC, utcInputToIso } from "@/lib/time";

const FREQUENCIES: ApiSeries["frequency"][] = ["one_off", "daily", "weekly", "monthly", "quarterly", "annual", "custom"];

export default function CatalogPanel() {
  const toast = useToast();
  const { ready } = useBackendOperator();
  const [series, setSeries] = useState<ApiSeries[]>([]);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [markets, setMarkets] = useState<ApiMarket[]>([]);
  const [exchange, setExchange] = useState<ApiExchangeStatus | null>(null);

  const reload = useCallback(async () => {
    const [s, e, m, x] = await Promise.all([
      fetchSeriesList({ status: "all" }).then((r) => r.items),
      fetchEvents({ status: "all", withNestedMarkets: false, limit: 100 }).then((r) => r.items),
      fetchMarketsPage({ sort: "newest", limit: 100 }).then((r) => r.items),
      fetchExchangeStatus(),
    ]);
    setSeries(s);
    setEvents(e);
    setMarkets(m);
    setExchange(x);
  }, []);
  const { busy, run } = useRun(reload);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    reload().catch((e: unknown) => {
      if (!cancelled) toast({ title: "Could not load the catalog", description: authErrorMessage(e), status: "error", duration: 8000, isClosable: true });
    });
    return () => {
      cancelled = true;
    };
  }, [ready, reload, toast]);

  if (!ready) return null;

  return (
    <div className="space-y-6">
      <HaltCard exchange={exchange} busy={busy} onSet={(active, reason, resume) => run("Trading halt", () => setTradingHalt({ active, reason, estimatedResumeAt: resume || null }), active ? "Trading halted" : "Trading resumed")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SeriesCard series={series} busy={busy} run={run} />
        <EventsCard series={series} events={events} busy={busy} run={run} />
      </div>

      <Card title="Create a market inside an event (treasury-signed)">
        <CreateMarketForm events={events} series={series} busy={busy} run={run} />
      </Card>

      <MarketPresentationCard markets={markets} busy={busy} run={run} />
    </div>
  );
}

function HaltCard({ exchange, busy, onSet }: { exchange: ApiExchangeStatus | null; busy: string | null; onSet: (active: boolean, reason: string, resume: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const [resume, setResume] = useState("");
  const halted = exchange?.halt.active ?? false;
  return (
    <Card
      title="Exchange status"
      aside={
        exchange && (
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${exchange.tradingActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            {exchange.tradingActive ? "Trading active" : "Trading halted"}
          </span>
        )
      }
    >
      {exchange && (
        <p className="mb-3 text-xs text-slate-500">
          Index {exchange.ledger.indexEnabled ? (exchange.ledger.indexRunning ? "running" : "enabled, not the streaming replica") : "disabled"} · offset {exchange.ledger.offset}
          {exchange.ledger.lag !== null ? ` · lag ${exchange.ledger.lag}` : ""} {exchange.ledger.stale ? "· STALE" : ""}
          {exchange.ledger.lastError ? ` · error: ${exchange.ledger.lastError}` : ""}
        </p>
      )}
      {halted ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-amber-800">
            Halted{exchange?.halt.since ? ` since ${formatDateTimeUTC(exchange.halt.since)}` : ""}: {exchange?.halt.reason}
          </p>
          <button type="button" className={btn} disabled={busy !== null} onClick={() => void onSet(false, "resumed by operator", "")}>
            Resume trading
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label className={label}>Reason (shown to traders)</label>
            <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. participant maintenance" />
          </div>
          <div>
            <label className={label}>Expected resume, UTC (optional)</label>
            <input className={field} type="datetime-local" value={resume} onChange={(e) => setResume(e.target.value)} />
          </div>
          <button
            type="button"
            className={btn}
            disabled={busy !== null || !reason.trim()}
            onClick={() => void onSet(true, reason.trim(), utcInputToIso(resume) ?? "")}
          >
            Halt trading
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-400">
        Trades are user-signed on-ledger: a halt disables the trade controls and order preparation, it cannot stop a party that crafts its own command.
      </p>
    </Card>
  );
}

function SeriesCard({ series, busy, run }: { series: ApiSeries[]; busy: string | null; run: Run }) {
  const [form, setForm] = useState({ ticker: "", title: "", category: "", frequency: "one_off" as ApiSeries["frequency"], tags: "", sourceName: "", sourceUrl: "" });
  const submit = async () => {
    const ok = await run(
      "Create series",
      () =>
        createSeries({
          ticker: form.ticker,
          title: form.title,
          category: form.category || undefined,
          frequency: form.frequency,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
          settlementSources: form.sourceName ? [{ name: form.sourceName, url: form.sourceUrl }] : [],
        }),
      `Series ${form.ticker.toUpperCase()} created`,
    );
    if (ok) setForm({ ticker: "", title: "", category: "", frequency: "one_off", tags: "", sourceName: "", sourceUrl: "" });
  };
  return (
    <Card title={`Series (${series.length})`}>
      <ul className="mb-4 max-h-56 space-y-1 overflow-auto text-sm">
        {series.map((s) => (
          <li key={s.ticker} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-1.5">
            <span className="min-w-0 truncate">
              <span className="font-mono text-xs text-slate-500">{s.ticker}</span> <span className="font-medium">{s.title}</span>
              <span className="ml-2 text-xs text-slate-400">
                {s.category || "—"} · {s.frequency} · {s.eventCount} events · {s.marketCount} markets
              </span>
            </span>
            <button
              type="button"
              className={btnQuiet}
              disabled={busy !== null}
              onClick={() => void run("Update series", () => updateSeries(s.ticker, { status: s.status === "active" ? "archived" : "active" }), `Series ${s.ticker} ${s.status === "active" ? "archived" : "restored"}`)}
            >
              {s.status === "active" ? "Archive" : "Restore"}
            </button>
          </li>
        ))}
        {series.length === 0 && <li className="text-xs text-slate-400">No series yet.</li>}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className={label}>Ticker</label>
          <input className={field} value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} placeholder="FED" />
        </div>
        <div>
          <label className={label}>Title</label>
          <input className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Fed rate decisions" />
        </div>
        <div>
          <label className={label}>Category</label>
          <input className={field} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Economics" />
        </div>
        <div>
          <label className={label}>Frequency</label>
          <select className={field} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as ApiSeries["frequency"] })}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Tags (comma-separated)</label>
          <input className={field} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="rates, macro" />
        </div>
        <div>
          <label className={label}>Settlement source (name · URL)</label>
          <div className="flex gap-1">
            <input className={field} value={form.sourceName} onChange={(e) => setForm({ ...form, sourceName: e.target.value })} placeholder="FOMC statement" />
            <input className={field} value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://…" />
          </div>
        </div>
      </div>
      <button type="button" className={`${btn} mt-3`} disabled={busy !== null || !form.ticker || !form.title} onClick={() => void submit()}>
        Create series
      </button>
    </Card>
  );
}

function EventsCard({ series, events, busy, run }: { series: ApiSeries[]; events: ApiEvent[]; busy: string | null; run: Run }) {
  const [form, setForm] = useState({ ticker: "", seriesTicker: "", title: "", subTitle: "", imageUrl: "", mutuallyExclusive: true, strikeDate: "" });
  const submit = async () => {
    const ok = await run(
      "Create event",
      () =>
        createEvent({
          ticker: form.ticker,
          seriesTicker: form.seriesTicker,
          title: form.title,
          subTitle: form.subTitle || undefined,
          imageUrl: form.imageUrl.trim() || undefined,
          mutuallyExclusive: form.mutuallyExclusive,
          strikeDate: utcInputToIso(form.strikeDate),
        }),
      `Event ${form.ticker.toUpperCase()} created`,
    );
    if (ok) setForm({ ticker: "", seriesTicker: form.seriesTicker, title: "", subTitle: "", imageUrl: "", mutuallyExclusive: true, strikeDate: "" });
  };
  return (
    <Card title={`Events (${events.length})`}>
      <ul className="mb-4 max-h-56 space-y-1 overflow-auto text-sm">
        {events.map((e) => (
          <li key={e.ticker} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-1.5">
            <span className="min-w-0 truncate">
              <span className="font-mono text-xs text-slate-500">{e.ticker}</span> <span className="font-medium">{e.title}</span>
              <span className="ml-2 text-xs text-slate-400">
                {e.seriesTicker} · {e.status} · {e.marketCount} markets · {formatMoney(e.volume, eventInstrument(e), 1)}
                {e.archived ? " · archived" : ""}
              </span>
            </span>
            <button
              type="button"
              className={btnQuiet}
              disabled={busy !== null}
              onClick={() => void run("Update event", () => updateEvent(e.ticker, { archived: !e.archived }), `Event ${e.ticker} ${e.archived ? "restored" : "archived"}`)}
            >
              {e.archived ? "Restore" : "Archive"}
            </button>
          </li>
        ))}
        {events.length === 0 && <li className="text-xs text-slate-400">No events yet.</li>}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className={label}>Series</label>
          <select className={field} value={form.seriesTicker} onChange={(e) => setForm({ ...form, seriesTicker: e.target.value })}>
            <option value="">Select a series…</option>
            {series.filter((s) => s.status === "active").map((s) => (
              <option key={s.ticker} value={s.ticker}>
                {s.ticker} — {s.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Event ticker</label>
          <input className={field} value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} placeholder="FED-26MAR" />
        </div>
        <div>
          <label className={label}>Title</label>
          <input className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Fed decision, March 2026" />
        </div>
        <div>
          <label className={label}>Subtitle</label>
          <input className={field} value={form.subTitle} onChange={(e) => setForm({ ...form, subTitle: e.target.value })} placeholder="March meeting" />
        </div>
        <div>
          <label className={label}>Strike date, UTC (optional)</label>
          <input className={field} type="datetime-local" value={form.strikeDate} onChange={(e) => setForm({ ...form, strikeDate: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Image URL (optional — the default image of every market in this event)</label>
          <input className={field} value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…" />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.mutuallyExclusive} onChange={(e) => setForm({ ...form, mutuallyExclusive: e.target.checked })} />
          Mutually exclusive (one market resolves Yes)
        </label>
      </div>
      <button type="button" className={`${btn} mt-3`} disabled={busy !== null || !form.ticker || !form.title || !form.seriesTicker} onClick={() => void submit()}>
        Create event
      </button>
    </Card>
  );
}
