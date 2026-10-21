/**
 * /wallet/ramp — everything around the ramp that is not a single order: the order history, the
 * saved cards, and the payout bank accounts. It stays reachable while the ramp is paused (open
 * orders can still be followed and cancelled), and each list loads on its own so one failing
 * read never hides the others.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Banknote, Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { isBackendError } from "@/lib/backend";
import { BACKEND_UNREACHABLE_SENTENCE } from "@/lib/backendErrors";
import {
  fetchBankAccounts,
  fetchRampCards,
  fetchRampOverview,
  type RampBankAccount,
  type RampCard,
  type RampOverview,
} from "@/lib/ramp";
import { primaryBtn } from "@/components/Account/accountUi";
import { RampBankAccounts } from "./RampBankAccounts";
import { RampOrdersHistory } from "./RampOrdersHistory";
import { RampSavedCards } from "./RampSavedCards";
import { PausedBanner } from "./rampUi";

export default function RampAccountsPage() {
  const auth = useAuth();
  const location = useLocation();
  const signedIn = auth.status === "authenticated";
  const [overview, setOverview] = useState<RampOverview | null>(null);
  const [cards, setCards] = useState<RampCard[]>([]);
  const [cardsFailed, setCardsFailed] = useState(false);
  const [accounts, setAccounts] = useState<RampBankAccount[]>([]);
  const [accountsFailed, setAccountsFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!signedIn) return;
    const [o, c, a] = await Promise.allSettled([fetchRampOverview(), fetchRampCards(), fetchBankAccounts()]);
    if (o.status === "fulfilled") setOverview(o.value);
    if (c.status === "fulfilled") setCards(c.value);
    if (a.status === "fulfilled") setAccounts(a.value);
    setCardsFailed(c.status === "rejected");
    // The route always exists (an empty list while the bank rail is off); a 404 from an older or
    // misrouted backend still reads as "no accounts", not a failure.
    setAccountsFailed(a.status === "rejected" && !isBackendError(a.reason, "not_found"));
    setLoaded(true);
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep links (#bank-accounts from the cash-out form) arrive before the sections exist.
  useEffect(() => {
    if (!loaded || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loaded, location.hash]);

  const bankRail = overview?.rails?.some((r) => r.rail === "bank") ?? false;
  const paused = overview ? !overview.enabled || overview.paused?.orders === true : false;

  const body = () => {
    if (auth.status === "loading")
      return (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      );
    if (auth.status === "unreachable") return <p className="text-sm text-slate-600">{BACKEND_UNREACHABLE_SENTENCE}</p>;
    if (auth.status === "unavailable")
      return <p className="text-sm text-slate-600">Accounts are not enabled on this deployment.</p>;
    if (!signedIn)
      return (
        <div className="space-y-3 text-sm text-slate-600">
          <p>Sign in to see your orders, cards and bank accounts.</p>
          <button type="button" className={primaryBtn} onClick={() => auth.openLogin("login")}>
            Sign in
          </button>
        </div>
      );
    return (
      <div className="space-y-6">
        {paused && <PausedBanner />}
        <RampOrdersHistory />
        <RampSavedCards
          cards={cards}
          failed={cardsFailed}
          currency={overview?.fiat.currency ?? "BYN"}
          onChanged={() => void load()}
        />
        {(bankRail || accounts.length > 0 || accountsFailed) && (
          <RampBankAccounts accounts={accounts} failed={accountsFailed} onChanged={() => void load()} />
        )}
      </div>
    );
  };

  return (
    <div className="page-container max-w-3xl py-10 sm:py-14">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Buy and cash out</h1>
        </div>
        <Link to="/portfolio" className="text-sm font-semibold text-primary underline">
          Back to portfolio
        </Link>
      </div>
      {body()}
    </div>
  );
}
