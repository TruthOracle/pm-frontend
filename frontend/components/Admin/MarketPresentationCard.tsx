/**
 * Operator override of a market's presentation (truthoracle-backend docs/MARKETS.md): image URL
 * and description live in the backend as market metadata since truthoracle-v16, not on the
 * contract. A market with no override shows its event's image; a blank image URL puts it back
 * there. Everything goes through `PATCH /admin/markets/:market/metadata`, audit-logged.
 */
import { useEffect, useMemo, useState } from "react";
import { updateMarketMetadata } from "@/lib/backendAdmin";
import type { ApiMarket } from "@/lib/marketsTypes";
import { btn, btnQuiet, Card, field, label, type Run } from "./adminUi";

const SHOWN = 50;

export default function MarketPresentationCard({ markets, busy, run }: { markets: ApiMarket[]; busy: string | null; run: Run }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const shown = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const list = needle ? markets.filter((m) => m.ticker.includes(needle) || m.eventTicker.includes(needle)) : markets;
    return list.slice(0, SHOWN);
  }, [markets, q]);

  return (
    <Card
      title={`Market presentation (${markets.length})`}
      aside={<input className={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by ticker" aria-label="Filter markets by ticker" />}
    >
      <p className="mb-3 text-xs text-slate-500">
        Image and description are backend metadata, not contract fields: edit them any time. A market without an override shows its event's image.
      </p>
      <ul className="max-h-[28rem] space-y-1 overflow-auto text-sm">
        {shown.map((m) =>
          editing === m.ticker ? (
            <EditRow key={m.ticker} market={m} busy={busy} run={run} onClose={() => setEditing(null)} />
          ) : (
            <li key={m.ticker} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                {m.imageUrl ? <img src={m.imageUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" /> : <span className="h-6 w-6 shrink-0 rounded bg-slate-200" aria-hidden />}
                <span className="min-w-0 truncate">
                  <span className="font-mono text-xs text-slate-500">{m.ticker}</span> <span className="font-medium">{m.question}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {m.eventTicker} · {m.status} · {m.metadata?.imageUrl ? "own image" : m.imageUrl ? "event image" : "no image"}
                    {m.metadata?.description ? " · described" : ""}
                  </span>
                </span>
              </span>
              <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => setEditing(m.ticker)}>
                Edit
              </button>
            </li>
          ),
        )}
        {markets.length === 0 && <li className="text-xs text-slate-400">No markets indexed yet.</li>}
        {markets.length > 0 && shown.length === 0 && <li className="text-xs text-slate-400">No market matches that filter.</li>}
      </ul>
      {markets.length > SHOWN && shown.length === SHOWN && (
        <p className="mt-2 text-[11px] text-slate-400">Showing the newest {SHOWN}; filter by ticker to reach the rest.</p>
      )}
    </Card>
  );
}

function EditRow({ market, busy, run, onClose }: { market: ApiMarket; busy: string | null; run: Run; onClose: () => void }) {
  const [imageUrl, setImageUrl] = useState(market.metadata?.imageUrl ?? "");
  const [description, setDescription] = useState(market.metadata?.description ?? market.description);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setImageUrl(market.metadata?.imageUrl ?? "");
    setDescription(market.metadata?.description ?? market.description);
  }, [market]);
  const dirty = imageUrl.trim() !== (market.metadata?.imageUrl ?? "") || description.trim() !== (market.metadata?.description ?? market.description);
  const save = async () => {
    const ok = await run(
      "Update presentation",
      () => updateMarketMetadata(market.ticker, { imageUrl: imageUrl.trim(), description: description.trim(), reason: reason.trim() || undefined }),
      `Presentation of ${market.ticker} updated`,
    );
    if (ok) onClose();
  };
  return (
    <li className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="mb-2 text-xs">
        <span className="font-mono text-slate-500">{market.ticker}</span> <span className="font-medium">{market.question}</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label}>Image URL (blank = the event's image)</label>
          <input className={field} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Description (shown on the market card)</label>
          <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description shown on the market card" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Audit note (optional)</label>
          <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why this changed / ticket id" />
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" className={btn} disabled={busy !== null || !dirty} onClick={() => void save()}>
          {busy === "Update presentation" ? "Saving…" : "Save"}
        </button>
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={onClose}>
          Cancel
        </button>
      </div>
    </li>
  );
}
