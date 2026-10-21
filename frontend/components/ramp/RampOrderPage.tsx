/**
 * /wallet/ramp/:orderId — one order as the backend sees it (truthoracle-backend docs/RAMP.md §4).
 * The acquirer's hosted checkout returns here; ERIP orders show how to pay; a cash-out waits here
 * for its wallet signature. The page decides nothing: it polls the order (lib/rampLogic schedule:
 * backoff to 30 s, paused in a hidden tab, stopped at a final status or a definitive 4xx) and
 * says what happens next in the person's terms. The redirect's own query string is ignored on
 * purpose — only the provider's API, read by the backend, says whether a payment succeeded.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Banknote, Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { BACKEND_UNREACHABLE_SENTENCE } from "@/lib/backendErrors";
import { formatMoney } from "@/lib/instruments";
import { formatDateTimeUTC } from "@/lib/time";
import {
  RAMP_MOCK_PAGES,
  bankAccountLabel,
  cardLabel,
  fetchRampOverview,
  fiatLabel,
  mockCheckoutHref,
  rampCancelOffered,
  rampErrorMessage,
  rampOrderTitle,
  rampStatusSentence,
  rampStatusView,
  readRampSignedAt,
  type RampOrder,
} from "@/lib/ramp";
import { isFinalStatus, safeExternalUrl } from "@/lib/rampLogic";
import { Pill, primaryBtn, secondaryBtn } from "@/components/Account/accountUi";
import { EripInstructions } from "./EripInstructions";
import { RampTimeline } from "./RampTimeline";
import { RampWithdrawStep } from "./RampWithdrawStep";
import { useNow, useRampOrder } from "./hooks";
import { CancelOrderButton, CopyRow, Row } from "./rampUi";

function OrderBody({
  order,
  onOrder,
  refresh,
  bankDays,
  mockProvider,
}: {
  order: RampOrder;
  onOrder: (o: RampOrder) => void;
  refresh: () => void;
  bankDays: number | null;
  /** The backend runs the mock acquirer (and this build has its test page): an ERIP order can be paid there. */
  mockProvider: boolean;
}) {
  const view = rampStatusView(order);
  const buy = order.direction === "onramp";
  const fiat = (v: string) => fiatLabel(v, order.fiatCurrency);
  const tokens = (v: string) => formatMoney(v, order.instrument);
  const next = order.status === "awaiting_payment" ? order.next : null;
  const checkout = next?.kind === "redirect" ? safeExternalUrl(next.url) : null;
  const dest = order.destination;
  // A cash-out's signature in the popup, linking, or on its way hides "Cancel" (review F5).
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const now = useNow(5_000);
  const signedAt = order.direction === "offramp" ? readRampSignedAt(order.id) : null;
  return (
    <>
      <div className="flex items-center gap-3" aria-live="polite">
        <Pill tone={view.tone}>{view.label}</Pill>
        {!isFinalStatus(order.status) && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden />}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{rampStatusSentence(order, { bankDays, signedAt })}</p>
      {next?.kind === "erip" && (
        <EripInstructions
          order={order}
          next={next}
          mockHref={mockProvider ? mockCheckoutHref(order.id, { method: "erip" }) : null}
        />
      )}
      {next?.kind === "redirect" && !checkout && (
        <p className="mt-3 text-sm text-red-700">
          The payment page link is not valid. Cancel this order and start a new one.
        </p>
      )}
      {order.status === "awaiting_withdrawal" && (
        <RampWithdrawStep order={order} onOrder={onOrder} onRefresh={refresh} onBusyChange={setWithdrawBusy} />
      )}
      <div className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
        <Row
          label={buy ? "You pay" : "You withdraw"}
          value={buy ? fiat(order.fiatAmount) : tokens(order.tokenAmount)}
        />
        <Row label="Fee" value={fiat(order.feeAmount)} />
        <Row
          label={buy ? "Credited in-app" : "You receive"}
          value={buy ? tokens(order.tokenAmount) : fiat(order.fiatAmount)}
        />
        {order.card && <Row label="Card" value={cardLabel(order.card)} />}
        {dest?.kind === "card" && <Row label="To card" value={cardLabel(dest)} />}
        {dest?.kind === "bank" && <Row label="To bank account" value={bankAccountLabel(dest)} />}
        {order.payoutReference && <CopyRow label="Reference" value={order.payoutReference} />}
        <Row label="Opened" value={formatDateTimeUTC(order.createdAt)} />
        {order.completedAt && <Row label="Finished" value={formatDateTimeUTC(order.completedAt)} />}
      </div>
      <RampTimeline order={order} />
      <div className="mt-5 flex flex-wrap gap-2">
        {checkout && (
          <a href={checkout} className={primaryBtn} rel="noopener noreferrer">
            Return to card payment
          </a>
        )}
        {rampCancelOffered(order, { busy: withdrawBusy, signedAt, now }) && (
          <CancelOrderButton order={order} onCancelled={onOrder} className={secondaryBtn} />
        )}
        <Link to="/portfolio" className={secondaryBtn}>
          Back to portfolio
        </Link>
        <Link to="/wallet/ramp" className={secondaryBtn}>
          All orders
        </Link>
      </div>
      <p className="mt-4 text-[11px] text-slate-400">
        Order {order.id}
        {order.operator?.name ? ` · operated by ${order.operator.name}` : ""}
      </p>
    </>
  );
}

export default function RampOrderPage() {
  const { orderId = "" } = useParams();
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";
  const { order, error, state, accept, refresh } = useRampOrder(orderId, signedIn);
  const [bankDays, setBankDays] = useState<number | null>(null);
  const [mockProvider, setMockProvider] = useState(false);
  const onOrder = useCallback((o: RampOrder) => accept(o), [accept]);

  // The bank rail's ETA for the "sent" sentence, and whether the mock acquirer runs; the page works without them.
  useEffect(() => {
    if (!signedIn) return;
    fetchRampOverview()
      .then((o) => {
        setBankDays(o.rails?.find((r) => r.rail === "bank")?.eta.businessDays ?? null);
        setMockProvider(RAMP_MOCK_PAGES && o.provider === "mock");
      })
      .catch(() => undefined);
  }, [signedIn]);

  const body = () => {
    if (auth.status === "loading")
      return (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      );
    if (auth.status === "unreachable")
      return <p className="text-sm text-slate-600">{BACKEND_UNREACHABLE_SENTENCE} This page retries by itself.</p>;
    if (auth.status === "unavailable")
      return <p className="text-sm text-slate-600">Accounts are not enabled on this deployment.</p>;
    if (!signedIn)
      return (
        <div className="space-y-3 text-sm text-slate-600">
          <p>Sign in to see this order.</p>
          <button type="button" className={primaryBtn} onClick={() => auth.openLogin("login")}>
            Sign in
          </button>
        </div>
      );
    if (!order)
      return error ? (
        <div className="space-y-3">
          <p className="text-sm text-red-700">{rampErrorMessage(error)}</p>
          {state !== "stopped" && <p className="text-xs text-slate-500">Retrying…</p>}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the order…
        </p>
      );
    return (
      <>
        {state === "retrying" && (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Connection lost — showing the last known state and retrying.
          </p>
        )}
        {state === "stopped" && error != null && <p className="mb-3 text-xs text-red-700">{rampErrorMessage(error)}</p>}
        <OrderBody order={order} onOrder={onOrder} refresh={refresh} bankDays={bankDays} mockProvider={mockProvider} />
      </>
    );
  };

  return (
    <div className="page-container max-w-xl py-10 sm:py-14">
      <div className="mb-6 flex items-center gap-2">
        <Banknote className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">{rampOrderTitle(order)}</h1>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60">{body()}</div>
    </div>
  );
}
