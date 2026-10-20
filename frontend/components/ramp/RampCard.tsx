/**
 * Buy and cash out BYN (truthoracle-backend docs/RAMP.md) — the card under the in-app wallet on
 * /portfolio. It loads three things separately (GET /ramp, the saved cards, the bank accounts) so
 * a failing list never hides the orders in flight; a paused ramp (a runtime halt or the static
 * switch) keeps its open orders on screen with a banner instead of vanishing. A deployment
 * without the ramp shows nothing. Order pages, history, cards and bank accounts live at
 * /wallet/ramp; the forms are RampBuyForm and RampCashOutForm, gated by the consent step.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, Banknote } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { isBackendError } from "@/lib/backend";
import {
  fetchBankAccounts,
  fetchRampCards,
  fetchRampOverview,
  rampErrorMessage,
  type RampBankAccount,
  type RampCard as SavedCard,
  type RampDirection,
  type RampOrder,
  type RampOverview,
} from "@/lib/ramp";
import { RampBuyForm } from "./RampBuyForm";
import { RampCashOutForm } from "./RampCashOutForm";
import { RampConsent } from "./RampConsent";
import { RampOrderLine } from "./RampOrderLine";
import { PausedBanner } from "./rampUi";

/** No ramp on this backend at all: render nothing rather than a dead control. */
function isAbsent(e: unknown): boolean {
  return isBackendError(e, "not_found") || isBackendError(e, "backend_unconfigured");
}

export function RampCard({ reloadKey = 0 }: { reloadKey?: number }) {
  const auth = useAuth();
  const [overview, setOverview] = useState<RampOverview | null>(null);
  const [overviewError, setOverviewError] = useState<unknown>(null);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [accounts, setAccounts] = useState<RampBankAccount[]>([]);
  const [listsFailed, setListsFailed] = useState(false);
  const [tab, setTab] = useState<RampDirection>("onramp");
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mySeq = ++seq.current;
    if (auth.status !== "authenticated") {
      setOverview(null);
      return;
    }
    const [o, c, a] = await Promise.allSettled([fetchRampOverview(), fetchRampCards(), fetchBankAccounts()]);
    if (mySeq !== seq.current) return;
    // A failed refresh keeps the last overview on screen (with a note) instead of dropping the open orders.
    if (o.status === "fulfilled") {
      setOverview(o.value);
      setOverviewError(null);
    } else setOverviewError(o.reason);
    if (c.status === "fulfilled") setCards(c.value);
    if (a.status === "fulfilled") setAccounts(a.value);
    setListsFailed(c.status === "rejected" || (a.status === "rejected" && !isAbsent(a.reason)));
  }, [auth.status]);

  useEffect(() => {
    void reload();
  }, [reload, reloadKey]);

  const onOrderChanged = (next: RampOrder) => {
    setOverview((o) => (o ? { ...o, openOrders: o.openOrders.map((x) => (x.id === next.id ? next : x)) } : o));
    void reload();
  };

  if (auth.status !== "authenticated") return null;
  if (!overview) {
    if (!overviewError || isAbsent(overviewError)) return null;
    return (
      <div className="rounded-xl border border-slate-200 bg-card px-5 py-4 text-xs text-slate-600 shadow-sm">
        Buying and cashing out could not be loaded: {rampErrorMessage(overviewError)}{" "}
        <button type="button" onClick={() => void reload()} className="font-semibold text-primary underline">
          Retry
        </button>
      </div>
    );
  }
  const openOrders = overview.openOrders ?? [];
  const configured = !!overview.provider && !!overview.instrument;
  if (!configured && openOrders.length === 0) return null;

  const paused = !overview.enabled || overview.paused?.orders === true || !configured;
  const canBuy = overview.methods.length > 0;
  const canCashOut = overview.rails.length > 0;
  const active: RampDirection = tab === "offramp" && canCashOut ? "offramp" : canBuy ? "onramp" : "offramp";
  const token = overview.instrument;
  const tabBtn = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
      on ? "bg-primary text-primary-foreground" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <div className="rounded-xl border border-slate-200 bg-card px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Buy and cash out</h2>
          {token && (
            <span className="text-xs text-muted-foreground">
              1 {overview.fiat.currency} = 1 {token.symbol}
            </span>
          )}
        </div>
        {!paused && !overview.consent.required && (
          <div className="flex gap-1" role="tablist">
            {canBuy && (
              <button
                type="button"
                role="tab"
                aria-selected={active === "onramp"}
                className={tabBtn(active === "onramp")}
                onClick={() => setTab("onramp")}
              >
                <ArrowDownToLine className="h-3.5 w-3.5" /> Buy
              </button>
            )}
            {canCashOut && (
              <button
                type="button"
                role="tab"
                aria-selected={active === "offramp"}
                className={tabBtn(active === "offramp")}
                onClick={() => setTab("offramp")}
              >
                <ArrowUpFromLine className="h-3.5 w-3.5" /> Cash out
              </button>
            )}
          </div>
        )}
      </div>

      {overviewError != null && (
        <p className="mt-2 text-[11px] text-red-700">
          Could not refresh: {rampErrorMessage(overviewError)}{" "}
          <button type="button" onClick={() => void reload()} className="font-semibold underline">
            Retry
          </button>
        </p>
      )}

      {paused ? (
        <PausedBanner />
      ) : overview.consent.required ? (
        <RampConsent overview={overview} onDone={() => void reload()} />
      ) : active === "onramp" ? (
        <RampBuyForm overview={overview} paused={paused} />
      ) : (
        <RampCashOutForm
          overview={overview}
          paused={paused}
          cards={cards}
          accounts={accounts}
          listsFailed={listsFailed}
        />
      )}

      {openOrders.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {openOrders.map((o) => (
            <RampOrderLine key={o.id} order={o} onChanged={onOrderChanged} />
          ))}
        </ul>
      )}
      <div className="mt-3 border-t border-slate-100 pt-2 text-xs">
        <Link to="/wallet/ramp" className="font-semibold text-primary underline">
          Order history, cards and bank accounts
        </Link>
      </div>
    </div>
  );
}

export default RampCard;
