/**
 * Operator console for the market catalog (truthoracle-backend docs/MARKETS.md §2–§4, §8):
 * series and events, the treasury-signed market factory (a market inside an event, with its
 * ticker and Yes / No labels on-ledger) and the trading halt. Everything here calls the backend's admin API, so it needs a backend
 * operator session (a wallet-signed challenge, ARCHITECTURE §7.4) — separate from the older
 * `to_admin` relay session the rest of /admin uses.
 */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { useCantonWallet } from "@/wallets";
import { authErrorMessage } from "@/auth/wallet";
import { probeBackend, type BackendAvailability } from "@/lib/backend";
import {
  createEvent,
  createMarketViaBackend,
  createSeries,
  fetchBackendAdminSession,
  setTradingHalt,
  signInAsBackendAdmin,
  signOutBackendAdmin,
  updateEvent,
  updateSeries,
} from "@/lib/backendAdmin";
import { fetchEvents, fetchExchangeStatus, fetchSeriesList } from "@/lib/marketsApi";
import { toNumber, type ApiEvent, type ApiExchangeStatus, type ApiSeries } from "@/lib/marketsTypes";
import { WALLET_DISPLAY_NAME } from "@/config";

const FREQUENCIES: ApiSeries["frequency"][] = ["one_off", "daily", "weekly", "monthly", "quarterly", "annual", "custom"];

const field = "input-field";
const label = "mb-1 block text-xs font-semibold text-slate-600";
const btn = "rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60";
const btnQuiet = "rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60";

function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
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

export default function CatalogPanel() {
  const toast = useToast();
  const { account, connected, connect, signMessage } = useCantonWallet();
  const [availability, setAvailability] = useState<BackendAvailability | "probing">("probing");
  const [session, setSession] = useState<{ authenticated: boolean; isAdmin: boolean; partyId: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [series, setSeries] = useState<ApiSeries[]>([]);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [exchange, setExchange] = useState<ApiExchangeStatus | null>(null);

  const fail = (title: string, e: unknown) =>
    toast({ title, description: authErrorMessage(e), status: "error", duration: 8000, isClosable: true });

  const reload = useCallback(async () => {
    const [s, e, x] = await Promise.all([
      fetchSeriesList({ status: "all" }).then((r) => r.items),
      fetchEvents({ status: "all", withNestedMarkets: false, limit: 100 }).then((r) => r.items),
      fetchExchangeStatus(),
    ]);
    setSeries(s);
    setEvents(e);
    setExchange(x);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const a = await probeBackend();
      if (cancelled) return;
      setAvailability(a);
      if (a !== "ok") return;
      try {
        setSession(await fetchBackendAdminSession());
        await reload();
      } catch (e) {
        if (!cancelled) fail("Could not load the catalog", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const signIn = async () => {
    if (!account?.partyId) {
      toast({ title: `Connect your ${WALLET_DISPLAY_NAME} wallet first`, status: "info", duration: 4000, isClosable: true });
      return;
    }
    setBusy("sign-in");
    try {
      await signInAsBackendAdmin({ partyId: account.partyId, publicKey: account.publicKey, signMessage });
      setSession(await fetchBackendAdminSession());
      await reload();
    } catch (e) {
      fail("Operator sign-in failed", e);
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    try {
      await signOutBackendAdmin();
    } finally {
      setSession(await fetchBackendAdminSession());
    }
  };

  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await fn();
      await reload();
      toast({ title: done, status: "success", duration: 5000, isClosable: true });
      return true;
    } catch (e) {
      fail(`${what} failed`, e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (availability === "probing") return null;
  if (availability !== "ok") {
    return (
      <Card title="Catalog (series · events · markets)">
        <p className="text-sm text-slate-600">
          {availability === "unconfigured"
            ? "This deployment has no accounts backend, so there is no catalog: markets are read straight from the ledger."
            : "The accounts backend is not reachable right now; the catalog console retries when you reload."}
        </p>
      </Card>
    );
  }

  if (!session?.isAdmin) {
    return (
      <Card title="Catalog (series · events · markets)">
        <p className="text-sm text-slate-600">
          The catalog, the market factory and the trading halt live in the accounts backend. Sign in there as an operator: connect
          your {WALLET_DISPLAY_NAME} wallet and approve a short message (a signature, not a transaction). Only parties in the
          backend's <code className="font-mono">ADMIN_OPERATORS</code> are accepted.
        </p>
        {session?.authenticated && !session.isAdmin && (
          <p className="mt-2 text-xs text-amber-700">You are signed in to the backend as a user; sign out there before signing in as an operator.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!connected || !account?.partyId ? (
            <button type="button" className={btn} disabled={busy !== null} onClick={() => void connect().catch((e: unknown) => fail("Could not connect", e))}>
              Connect {WALLET_DISPLAY_NAME} wallet
            </button>
          ) : (
            <button type="button" className={btn} disabled={busy !== null} onClick={() => void signIn()}>
              {busy === "sign-in" ? "Waiting for your wallet…" : "Sign in to the backend as operator"}
            </button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
        <span>
          Backend operator session: <code className="font-mono">{session.partyId ?? "operator"}</code>
        </span>
        <button type="button" className={btnQuiet} onClick={() => void signOut()}>
          Sign out of the backend
        </button>
      </div>

      <HaltCard exchange={exchange} busy={busy} onSet={(active, reason, resume) => run("Trading halt", () => setTradingHalt({ active, reason, estimatedResumeAt: resume || null }), active ? "Trading halted" : "Trading resumed")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SeriesCard series={series} busy={busy} run={run} />
        <EventsCard series={series} events={events} busy={busy} run={run} />
      </div>

      <CreateMarketCard events={events} series={series} busy={busy} run={run} />
    </div>
  );
}

type Run = (what: string, fn: () => Promise<unknown>, done: string) => Promise<boolean>;

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
            Halted{exchange?.halt.since ? ` since ${new Date(exchange.halt.since).toLocaleString()}` : ""}: {exchange?.halt.reason}
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
            <label className={label}>Expected resume (optional)</label>
            <input className={field} type="datetime-local" value={resume} onChange={(e) => setResume(e.target.value)} />
          </div>
          <button
            type="button"
            className={btn}
            disabled={busy !== null || !reason.trim()}
            onClick={() => void onSet(true, reason.trim(), resume ? new Date(resume).toISOString() : "")}
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
  const [form, setForm] = useState({ ticker: "", seriesTicker: "", title: "", subTitle: "", mutuallyExclusive: true, strikeDate: "" });
  const submit = async () => {
    const ok = await run(
      "Create event",
      () =>
        createEvent({
          ticker: form.ticker,
          seriesTicker: form.seriesTicker,
          title: form.title,
          subTitle: form.subTitle || undefined,
          mutuallyExclusive: form.mutuallyExclusive,
          strikeDate: form.strikeDate ? new Date(form.strikeDate).toISOString() : null,
        }),
      `Event ${form.ticker.toUpperCase()} created`,
    );
    if (ok) setForm({ ticker: "", seriesTicker: form.seriesTicker, title: "", subTitle: "", mutuallyExclusive: true, strikeDate: "" });
  };
  return (
    <Card title={`Events (${events.length})`}>
      <ul className="mb-4 max-h-56 space-y-1 overflow-auto text-sm">
        {events.map((e) => (
          <li key={e.ticker} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-1.5">
            <span className="min-w-0 truncate">
              <span className="font-mono text-xs text-slate-500">{e.ticker}</span> <span className="font-medium">{e.title}</span>
              <span className="ml-2 text-xs text-slate-400">
                {e.seriesTicker} · {e.status} · {e.marketCount} markets · {toNumber(e.volumeCC).toFixed(1)} CC
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
          <label className={label}>Strike date (optional)</label>
          <input className={field} type="datetime-local" value={form.strikeDate} onChange={(e) => setForm({ ...form, strikeDate: e.target.value })} />
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

function CreateMarketCard({ events, series, busy, run }: { events: ApiEvent[]; series: ApiSeries[]; busy: string | null; run: Run }) {
  const open = events.filter((e) => !e.archived);
  const [form, setForm] = useState({
    eventTicker: "",
    suffix: "",
    question: "",
    yesSubTitle: "",
    noSubTitle: "",
    resolutionDescription: "",
    expiresAt: "",
    initialProbability: 50,
    initialValueCC: 100,
    feeBps: 30,
    isDynamic: true,
    liquidityPeriodMinutes: 5,
    operatorResolution: true,
    sources: "",
  });
  const event = open.find((e) => e.ticker === form.eventTicker);
  const category = event ? (series.find((s) => s.ticker === event.seriesTicker)?.category ?? "") : "";
  const ticker = form.eventTicker && form.suffix ? `${form.eventTicker}-${form.suffix.toUpperCase()}` : "";
  const submit = async () => {
    const ok = await run(
      "Create market",
      () =>
        createMarketViaBackend({
          eventTicker: form.eventTicker,
          ticker,
          question: form.question,
          yesSubTitle: form.yesSubTitle || undefined,
          noSubTitle: form.noSubTitle || undefined,
          resolutionDescription: form.resolutionDescription || undefined,
          category: category || undefined,
          expiresAt: new Date(form.expiresAt).toISOString(),
          isDynamic: form.isDynamic,
          liquidityPeriodSecs: form.isDynamic ? Math.max(0, Math.round(form.liquidityPeriodMinutes * 60)) : 0,
          initialProbability: (Math.min(99, Math.max(1, form.initialProbability)) / 100).toFixed(4),
          initialValueCC: String(form.initialValueCC),
          feeBps: form.feeBps,
          policy: { operatorResolution: form.operatorResolution, sources: form.sources.split(",").map((s) => s.trim()).filter(Boolean) },
        }),
      `CreateMarket submitted for ${ticker} — it appears once the indexer sees it`,
    );
    if (ok) setForm({ ...form, suffix: "", question: "", yesSubTitle: "", noSubTitle: "" });
  };
  const valid = form.eventTicker && form.suffix && form.question && form.expiresAt && form.initialValueCC > 0;
  return (
    <Card title="Create a market inside an event (treasury-signed)">
      <p className="mb-3 text-xs text-slate-500">
        The backend builds <code className="font-mono">MarketCounter.CreateMarket</code> with the ticker, event and side labels on-ledger (mandatory on truthoracle-v15) and submits
        it through the Enterprise Wallet. Same ticker twice collides on the ledger's command dedup.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className={label}>Event</label>
          <select className={field} value={form.eventTicker} onChange={(e) => setForm({ ...form, eventTicker: e.target.value })}>
            <option value="">Select an event…</option>
            {open.map((e) => (
              <option key={e.ticker} value={e.ticker}>
                {e.ticker} — {e.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Ticker suffix → {ticker || "…"}</label>
          <input className={field} value={form.suffix} onChange={(e) => setForm({ ...form, suffix: e.target.value.toUpperCase() })} placeholder="CUT25" />
        </div>
        <div>
          <label className={label}>Expiry (trading stops)</label>
          <input className={field} type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
        </div>
        <div className="sm:col-span-3">
          <label className={label}>Question</label>
          <input className={field} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="Will the Fed cut by at least 25 bps in March 2026?" />
        </div>
        <div>
          <label className={label}>Yes label</label>
          <input className={field} value={form.yesSubTitle} onChange={(e) => setForm({ ...form, yesSubTitle: e.target.value })} placeholder="Cut ≥ 25 bps" />
        </div>
        <div>
          <label className={label}>No label</label>
          <input className={field} value={form.noSubTitle} onChange={(e) => setForm({ ...form, noSubTitle: e.target.value })} placeholder="Smaller or none" />
        </div>
        <div>
          <label className={label}>Category</label>
          <input className={field} value={category} readOnly placeholder="from the series" />
        </div>
        <div className="sm:col-span-3">
          <label className={label}>Resolution criteria</label>
          <input className={field} value={form.resolutionDescription} onChange={(e) => setForm({ ...form, resolutionDescription: e.target.value })} placeholder="FOMC statement, target range upper bound" />
        </div>
        <div>
          <label className={label}>Initial probability (%)</label>
          <input className={field} type="number" min={1} max={99} value={form.initialProbability} onChange={(e) => setForm({ ...form, initialProbability: Number(e.target.value) })} />
        </div>
        <div>
          <label className={label}>Initial pool value (CC)</label>
          <input className={field} type="number" min={1} step="any" value={form.initialValueCC} onChange={(e) => setForm({ ...form, initialValueCC: Number(e.target.value) })} />
        </div>
        <div>
          <label className={label}>Fee (bps)</label>
          <input className={field} type="number" min={0} max={1000} value={form.feeBps} onChange={(e) => setForm({ ...form, feeBps: Number(e.target.value) })} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.isDynamic} onChange={(e) => setForm({ ...form, isDynamic: e.target.checked })} /> Dynamic pm-AMM
        </label>
        {form.isDynamic && (
          <div>
            <label className={label}>Liquidity period (min)</label>
            <input className={field} type="number" min={0} value={form.liquidityPeriodMinutes} onChange={(e) => setForm({ ...form, liquidityPeriodMinutes: Number(e.target.value) })} />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.operatorResolution} onChange={(e) => setForm({ ...form, operatorResolution: e.target.checked })} /> T0 operator resolution
        </label>
        <div className="sm:col-span-3">
          <label className={label}>Allowlisted source URIs (comma-separated)</label>
          <input className={field} value={form.sources} onChange={(e) => setForm({ ...form, sources: e.target.value })} placeholder="https://…" />
        </div>
      </div>
      <button type="button" className={`${btn} mt-3`} disabled={busy !== null || !valid} onClick={() => void submit()}>
        {busy === "Create market" ? "Submitting…" : "Create market on-ledger"}
      </button>
    </Card>
  );
}
