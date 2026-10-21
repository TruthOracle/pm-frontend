/**
 * /wallet/ramp/mock-checkout — the mock acquirer's "hosted page" (truthoracle-backend
 * docs/RAMP.md §9.2). The route exists only off mainnet (App.tsx), and the page shows its buttons
 * only when the backend itself reports the mock provider — a real deployment shows a dead end,
 * never a fake payment page. A real acquirer collects the card and runs 3-D Secure on its own
 * domain; here the buttons stand in for the cardholder and the issuer, and the backend turns each
 * into the signed webhook a real acquirer would send. The test card picks which saved card the
 * payment creates (card limits, cash-out to a card). With `method=erip` (linked from an ERIP
 * order, whose own id names the payment) the buttons stand in for the payer's bank instead.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FlaskConical, Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { completeMockPayment, fetchRampOverview, rampErrorMessage, type MockCompleteBody } from "@/lib/ramp";
import { primaryBtn, secondaryBtn } from "@/components/Account/accountUi";
import { inputCls } from "./rampUi";

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export default function MockCheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const paymentId = params.get("payment") ?? "";
  const orderId = params.get("order") ?? "";
  const erip = params.get("method") === "erip";
  const valid = ID_RE.test(paymentId) && ID_RE.test(orderId);
  const [mock, setMock] = useState<boolean | null>(null);
  const [cardSeed, setCardSeed] = useState("a");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    fetchRampOverview()
      .then((o) => setMock(o.provider === "mock"))
      .catch(() => setMock(false));
  }, [auth.status]);

  const finish = async (body: MockCompleteBody) => {
    setBusy(true);
    setError(null);
    try {
      await completeMockPayment(paymentId, erip ? body : { ...body, cardSeed });
      navigate(`/wallet/ramp/${encodeURIComponent(orderId)}`);
    } catch (e) {
      setError(rampErrorMessage(e));
      setBusy(false);
    }
  };

  const content = () => {
    if (!valid) return <p className="mt-4 text-sm text-red-700">This checkout link is incomplete.</p>;
    if (auth.status !== "authenticated" && auth.status !== "loading")
      return <p className="mt-4 text-sm text-slate-700">Sign in to finish this test payment.</p>;
    if (auth.status === "loading" || mock === null)
      return (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking the provider…
        </p>
      );
    if (!mock) return <p className="mt-4 text-sm text-red-700">This deployment does not use the mock acquirer.</p>;
    if (erip)
      return (
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void finish({ outcome: "succeeded", channel: "online" })}
            className={primaryBtn}
          >
            Pay from a bank account (online)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void finish({ outcome: "succeeded", channel: "cash" })}
            className={secondaryBtn}
          >
            Pay in cash at a cashier
          </button>
          <button type="button" disabled={busy} onClick={() => void finish({ outcome: "declined" })} className={secondaryBtn}>
            The payment fails
          </button>
        </div>
      );
    return (
      <div className="mt-5 flex flex-col gap-2">
        <label className="text-xs text-amber-900">
          Test card
          <select value={cardSeed} onChange={(e) => setCardSeed(e.target.value)} className={inputCls} disabled={busy}>
            <option value="a">Test card A</option>
            <option value="b">Test card B</option>
            <option value="c">Test card C</option>
            <option value="d">Test card D</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void finish({ outcome: "succeeded" })} className={primaryBtn}>
          Pay (3-D Secure passed)
        </button>
        <button type="button" disabled={busy} onClick={() => void finish({ outcome: "no_3ds" })} className={secondaryBtn}>
          Pay without 3-D Secure (goes to review)
        </button>
        <button type="button" disabled={busy} onClick={() => void finish({ outcome: "declined" })} className={secondaryBtn}>
          Decline the card
        </button>
      </div>
    );
  };

  return (
    <div className="page-container max-w-md py-10 sm:py-14">
      <div className="rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 p-5">
        <div className="flex items-center gap-2 text-amber-900">
          <FlaskConical className="h-5 w-5" />
          <h1 className="text-lg font-bold">{erip ? "Test ERIP payment" : "Test card payment"}</h1>
        </div>
        <p className="mt-2 text-sm text-amber-900">
          {erip
            ? "This deployment uses the mock acquirer. No money moves. Pick how the payer's bank pays this order."
            : "This deployment uses the mock card acquirer. No card is charged. Pick what the bank would do."}
        </p>
        {content()}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
