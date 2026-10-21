/**
 * Cash out, step 2 of 2 (order page, `awaiting_withdrawal`): sign `UserWallet.Withdraw` for
 * exactly the order's amount. Everything the click needs is read BEFORE it — the party's
 * PendingPayouts (to tell the new one apart), its current UserWallet id, and whether a matching
 * withdrawal is already signed — because the wallet popup must be the first thing the click
 * does (wallets/cantor8/popupGesture.ts; lib/ramp.ts signRampWithdrawal).
 *
 * A signature is never offered twice by mistake: when the participant shows a signed withdrawal
 * of exactly this amount, the page attaches it instead, and only the backend's "not this order's"
 * (409 ramp_order_state) lets it go — a matched withdrawal the answer says is not bound yet
 * (`bindPending`, why in `bindReason`) keeps being attached, with backoff, and the page says why
 * in the payee's words (review F6); right after signing on this device it waits (the network can
 * take a moment) rather than offering "Sign" again. The popup is not offered in the deadline's last
 * minutes (rampSignBy, F5). Errors before the signature say nothing left the balance; nothing after
 * the signature is reported as a failure — the backend binds the withdrawal by itself and this page
 * follows the order. A popup that timed out unanswered may still sign, so the page holds as after a
 * signature and says so (R3-04).
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, PenLine } from "lucide-react";
import { useAccountWallet } from "@/auth/AuthContext";
import { authErrorMessage } from "@/auth/wallet";
import { WALLET_DISPLAY_NAME } from "@/config";
import { formatMoney } from "@/lib/instruments";
import { shortPartyId } from "@/lib/party";
import { formatDateTimeUTC } from "@/lib/time";
import {
  RAMP_WALLET_UNANSWERED_SENTENCE,
  RampNotSignedError,
  SIGNED_GRACE_MS,
  attachOutcome,
  attachRetryDelayMs,
  attachWaitSentence,
  attachWithdrawal,
  rampSignBy,
  readRampSignedAt,
  readWithdrawalContext,
  rememberRampSigned,
  signRampWithdrawal,
  type RampOrder,
  type WithdrawalContext,
} from "@/lib/ramp";
import { formatCountdown } from "@/lib/rampLogic";
import { useCantonWallet } from "@/wallets";
import { primaryBtn, secondaryBtn } from "@/components/Account/accountUi";
import { useNow } from "./hooks";

const READ_WAIT_MS = 3_000;

export function RampWithdrawStep({
  order,
  onOrder,
  onRefresh,
  onBusyChange,
}: {
  order: RampOrder;
  onOrder: (order: RampOrder) => void;
  onRefresh: () => void;
  /** True while a signature is in the popup, linking, or on its way: the page hides "Cancel" (F5). */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { me } = useAccountWallet();
  const { account, connect, signAndSubmitTransaction } = useCantonWallet();
  const primary = me?.capabilities.primaryPartyId ?? null;
  const connected = account?.address ?? null;
  const isPrimary = !!primary && connected === primary;
  const [ctx, setCtx] = useState<WithdrawalContext | null>(null);
  const [phase, setPhase] = useState<"idle" | "signing" | "linking">("idle");
  const [signedAt, setSignedAt] = useState<number | null>(() => readRampSignedAt(order.id));
  // The last popup timed out unanswered (R3-04): it may still sign, so the page holds as after a signature.
  const [unanswered, setUnanswered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // "Sign" waits for the first participant read (the snapshot that tells the new PendingPayout
  // apart), but never longer than READ_WAIT_MS: a slow participant must not block the cash-out.
  const [ready, setReady] = useState(false);
  const rejected = useRef(new Set<string>());
  // Per signed withdrawal: how often it was attached, and when last (a matched one is retried, F6).
  const attachTried = useRef(new Map<string, { tries: number; at: number }>());
  // The last attach answered "matched, not bound yet" (F6 bindPending): why, for the page's sentence.
  const [bindWait, setBindWait] = useState<{ reason: string | null } | null>(null);
  const latest = useRef(order);
  latest.current = order;
  const now = useNow(1_000);
  const amount = order.withdraw?.amount ?? null;

  // The participant, read ahead of any click and every 5 s while the step is on screen.
  useEffect(() => {
    if (!isPrimary || !primary || !amount) return;
    let stop = false;
    const read = () =>
      readWithdrawalContext(primary, latest.current, rejected.current)
        .then((c) => !stop && setCtx(c))
        .catch(() => undefined);
    void read().finally(() => !stop && setReady(true));
    const wait = window.setTimeout(() => setReady(true), READ_WAIT_MS);
    const t = window.setInterval(() => !document.hidden && void read(), 5_000);
    return () => {
      stop = true;
      window.clearTimeout(wait);
      window.clearInterval(t);
    };
  }, [isPrimary, primary, amount, order.id]);

  // A withdrawal of exactly this amount is already signed: attach it instead of asking again. A
  // matched one the backend cannot bind yet (its settlement is held or in flight) answers 200 with
  // `bindPending`: it stays signed and is attached again after a backoff (F6).
  const signedCid = ctx?.signed?.contractId ?? null;
  const attachDue = (() => {
    if (!signedCid || rejected.current.has(signedCid)) return false;
    const last = attachTried.current.get(signedCid);
    return !last || now - last.at >= attachRetryDelayMs(last.tries);
  })();
  useEffect(() => {
    if (!signedCid || !attachDue || phase !== "idle") return;
    const last = attachTried.current.get(signedCid);
    attachTried.current.set(signedCid, { tries: (last?.tries ?? 0) + 1, at: Date.now() });
    setPhase("linking");
    attachWithdrawal(order.id, signedCid)
      .then((r) => {
        onOrder(r.order);
        setBindWait(attachOutcome(r) === "pending" ? { reason: r.bindReason } : null);
      })
      .catch((e) => {
        // Only "not this order's" lets it go (bound elsewhere, another amount); anything else is
        // transient — the backend's own scan binds the withdrawal.
        if (attachOutcome({ error: e }) === "not_this_order") rejected.current.add(signedCid);
        // A withdrawal that is not this order's no longer waits to be bound here.
        if (rejected.current.has(signedCid)) setBindWait(null);
      })
      .finally(() => {
        setPhase("idle");
        onRefresh();
      });
  }, [signedCid, attachDue, phase, order.id, onOrder, onRefresh]);

  // A signature, or a popup that may still sign: "Sign" and "Cancel" wait SIGNED_GRACE_MS.
  const hold = () => {
    const at = Date.now();
    rememberRampSigned(order.id, at);
    setSignedAt(at);
  };

  const sign = () => {
    if (!connected) return;
    setError(null);
    setUnanswered(false);
    setPhase("signing");
    // No await before this call: the wallet popup opens inside the click.
    signRampWithdrawal({
      order,
      userParty: connected,
      primaryParty: primary,
      context: ctx,
      signAndSubmitTransaction,
      onSigned: () => {
        hold();
        setPhase("linking");
      },
    })
      .then((res) => {
        if (!res.attached) {
          if (res.unanswered) {
            hold();
            setUnanswered(true);
          }
          return;
        }
        onOrder(res.order);
        setBindWait(attachOutcome(res) === "pending" ? { reason: res.bindReason } : null);
      })
      .catch((e) =>
        setError(
          `Not signed — nothing left your balance. ${authErrorMessage(e instanceof RampNotSignedError ? e.cause : e)}`,
        ),
      )
      .finally(() => {
        setPhase("idle");
        onRefresh();
      });
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await connect();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setConnecting(false);
    }
  };

  const deadline = order.expiresAt ? Date.parse(order.expiresAt) : NaN;
  const signBy = rampSignBy(order);
  const tooLate = signBy !== null && now > signBy;
  const waitingAfterSign = signedAt !== null && now - signedAt < SIGNED_GRACE_MS;
  const alreadySigned = !!signedCid && !rejected.current.has(signedCid);
  const busy = phase !== "idle" || waitingAfterSign || alreadySigned;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const amountText = order.withdraw ? formatMoney(order.withdraw.amount, order.instrument) : "";

  let body;
  if (!me) {
    body = (
      <p className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your account…
      </p>
    );
  } else if (!connected) {
    body = (
      <>
        <p>Connect your {WALLET_DISPLAY_NAME} wallet to sign the withdrawal.</p>
        <button type="button" className={secondaryBtn} disabled={connecting} onClick={() => void handleConnect()}>
          {connecting ? "Waiting for your wallet…" : `Connect ${WALLET_DISPLAY_NAME}`}
        </button>
      </>
    );
  } else if (!isPrimary) {
    body = (
      <p>
        The connected wallet is not this account's primary wallet{primary ? ` (${shortPartyId(primary)})` : ""}. Connect
        the primary wallet to sign the cash-out.
      </p>
    );
  } else if (phase === "linking" || alreadySigned) {
    body = (
      <p className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />{" "}
        {bindWait ? attachWaitSentence(bindWait.reason) : "Your withdrawal is signed. Linking it to this cash-out — this page updates by itself."}
      </p>
    );
  } else if (waitingAfterSign) {
    body = (
      <p className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />{" "}
        {unanswered ? RAMP_WALLET_UNANSWERED_SENTENCE : "Signed in your wallet. Waiting for the network to confirm it — this page updates by itself."}
      </p>
    );
  } else {
    body = (
      <>
        {signedAt !== null && (
          <p className="text-xs text-slate-500">
            {unanswered
              ? RAMP_WALLET_UNANSWERED_SENTENCE
              : "Your earlier signature has not shown up. If your wallet says the withdrawal failed, sign again."}
          </p>
        )}
        <button type="button" className={primaryBtn} disabled={phase === "signing" || !ready || tooLate} onClick={sign}>
          {phase === "signing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
          {phase === "signing" ? "Waiting for your wallet…" : `Sign in wallet: withdraw ${amountText}`}
        </button>
      </>
    );
  }

  return (
    <section className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm text-slate-700">
      {body}
      {signBy !== null && Number.isFinite(deadline) && (
        <p className="text-xs text-slate-500">
          {tooLate
            ? `Too close to the deadline (${formatDateTimeUTC(deadline)}) to sign safely: a signature arriving after it would not reach this cash-out. Cancel it and start a new one.`
            : `Start signing before ${formatDateTimeUTC(signBy)} (${formatCountdown(signBy - now)} left); the cash-out expires at ${formatDateTimeUTC(deadline)}.`}
        </p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  );
}

export default RampWithdrawStep;
