import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { Clock3, Play, Undo2 } from "lucide-react";
import { useCantonWallet } from "@/wallets";
import { useAccountWallet, useAuth } from "@/auth/AuthContext";
import type { Payout } from "@/auth/types";
import { fetchPendingPayouts, fetchUserWallet, type PendingPayoutRecord } from "@/utils/activeContracts";
import { buildCancelPayoutParams } from "@/utils/cantonCommands";
import { fetchBackendPayouts, moneyErrorMessage, payoutBlockedSentence, settlePayoutWithBackend } from "@/lib/inAppWallet";
import { shortPartyId } from "@/lib/party";
import { authErrorMessage } from "@/auth/wallet";
import { ConfirmDialog, Pill, type PillTone } from "@/components/Account/accountUi";
import { fmtCC } from "@/components/market/marketHelpers";
import { formatDateTimeUTC } from "@/lib/time";

/** Status pill per backend `Payout.status` (API.md). */
function statusView(p: Payout | undefined): { label: string; tone: PillTone; verifyLink?: boolean } {
  if (!p) return { label: "Queued", tone: "neutral" };
  switch (p.status) {
    case "queued":
      return { label: "Queued", tone: "neutral" };
    case "settling":
      return { label: "Settling", tone: "pending" };
    case "blocked_kyc":
      return { label: "Waiting for identity verification", tone: "warn", verifyLink: true };
    case "blocked_wallet_revoked":
      return { label: "Wallet unlinked", tone: "warn" };
    case "blocked_unknown_user":
    case "blocked_unknown_reason":
      return { label: "Needs review", tone: "warn" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    case "settled_external":
    case "settled_in_app":
      return { label: "Settled", tone: "ok" };
    case "archived":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: p.status, tone: "neutral" };
  }
}

/**
 * A user-signed CancelPayout is only safe while the backend has NOT started settling:
 * the external path calls transfer() BEFORE MarkPaid (§9.4), so a cancel that lands in
 * between refunds the in-app balance on top of the CC already sent. Allowed: blocked
 * rows (nothing is moving) and a queued row the processor has not touched. Refused:
 * settling, anything settled, failed, and a row the backend does not know at all once
 * an account is signed in (it will pick it up within a scan and may settle it).
 */
function cancelAllowed(p: Payout | undefined): boolean {
  if (!p) return false;
  switch (p.status) {
    case "blocked_kyc":
    case "blocked_wallet_revoked":
    case "blocked_unknown_user":
      return true;
    case "queued":
      return p.attempts === 0;
    default:
      return false;
  }
}

const CANCEL_REFUSED = "This withdrawal is being sent right now (or was already settled) and can no longer be cancelled.";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lists CC payouts the treasury owes the connected user. Each row is a `PendingPayout`
 * contract on-ledger — Sell, Merge, resolved-winner shares and withdrawals all flow
 * through this queue, and the accounts backend settles them (real CC out via the
 * Enterprise Wallet, or in-app for bonds / prizes).
 *
 * Anonymous: read-only — the on-ledger rows and nothing else. With an account signed
 * in, the backend's view of each row (queued / settling / blocked on KYC / failed) is
 * merged in, and `withdraw` rows can be settled now or cancelled back into the in-app
 * balance (user-signed CancelPayout with the refund variant — never the forfeiting one).
 */
function PendingPayouts({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const { account, signAndSubmitTransaction } = useCantonWallet();
  const auth = useAuth();
  const { me, primaryPartyId } = useAccountWallet();
  const toast = useToast();
  const [rows, setRows] = useState<PendingPayoutRecord[]>([]);
  const [backend, setBackend] = useState<Map<string, Payout>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PendingPayoutRecord | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const withAccount = me !== null;
  const connected = account?.address ?? null;
  // Which parties' rows the account can act on through the backend (§9.4: payee must
  // be one of the caller's wallets). A fresh Set per /me is fine — only `refresh`'s
  // primitive deps drive refetches.
  const accountParties = new Set<string>(me ? me.wallets.filter((w) => w.status === "active").map((w) => w.partyId) : []);
  if (primaryPartyId) accountParties.add(primaryPartyId);

  // Every refresh() elsewhere (KYC poll, deposit, expiry timer) produces a new `me`
  // object; only the primitives below should trigger a re-read of the ledger.
  const seqRef = useRef(0);
  const refresh = useCallback(async () => {
    const mySeq = ++seqRef.current;
    if (!connected) {
      setRows([]);
      setBackend(new Map());
      return;
    }
    setLoading(true);
    try {
      // The account's payouts are addressed to its primary party; the connected party
      // may be a different linked wallet with rows of its own. Read both, once each.
      const parties = Array.from(new Set([connected, primaryPartyId].filter((p): p is string => !!p)));
      const [lists, statuses] = await Promise.all([
        Promise.all(parties.map((p) => fetchPendingPayouts(p).then((l) => l.filter((r) => r.user === p)))),
        // Backend status is a decoration on the ledger rows; its absence must not hide them.
        withAccount ? fetchBackendPayouts().catch(() => [] as Payout[]) : Promise.resolve([] as Payout[]),
      ]);
      // An older read landing after a newer one would resurrect a row that just settled.
      if (mySeq !== seqRef.current) return;
      const seen = new Set<string>();
      const merged = lists
        .flat()
        .filter((r) => (seen.has(r.contractId) ? false : (seen.add(r.contractId), true)))
        .sort((a, b) => b.createdAt - a.createdAt);
      setRows(merged);
      setBackend(new Map(statuses.map((p) => [p.pendingPayoutCid, p])));
      setLoadError(null);
    } catch (e) {
      if (mySeq !== seqRef.current) return;
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mySeq === seqRef.current) setLoading(false);
    }
  }, [connected, primaryPartyId, withAccount]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const settleNow = async (r: PendingPayoutRecord) => {
    setActing(r.contractId);
    try {
      const outcome = await settlePayoutWithBackend(r.contractId);
      if (outcome.settled) {
        toast({
          title: "Payout settled",
          description:
            outcome.mode === "in_app"
              ? `${fmtCC(r.amountCC)} CC credited to your in-app balance.`
              : `${fmtCC(r.amountCC)} CC sent.`,
          status: "success",
          duration: 6000,
          isClosable: true,
        });
        await onChanged?.();
      } else {
        toast({
          title: outcome.blocked === "kyc" ? "Identity verification required" : "Not settled yet",
          description: outcome.detail,
          status: "warning",
          duration: 8000,
          isClosable: true,
        });
      }
      await refresh();
    } catch (e) {
      toast({ title: "Could not settle", description: moneyErrorMessage(e), status: "error", duration: 8000, isClosable: true });
    } finally {
      setActing(null);
    }
  };

  const linkConnected = async () => {
    setLinking(true);
    try {
      await auth.linkConnectedWallet();
      toast({ title: "Wallet linked to your account", status: "success", duration: 4000, isClosable: true });
      await refresh();
    } catch (e) {
      toast({ title: "Could not link wallet", description: authErrorMessage(e), status: "error", duration: 8000, isClosable: true });
    } finally {
      setLinking(false);
    }
  };

  const cancelAndRefund = async () => {
    const r = cancelTarget;
    if (!r) return;
    setActing(r.contractId);
    setCancelError(null);
    try {
      // Re-read the backend's status RIGHT BEFORE signing: the snapshot in `backend` may
      // be minutes old, the processor scans every 30 s, and the confirm dialog waited on
      // a human. The on-ledger design cannot fully close the window (Daml permits the
      // cancel at any time); this shrinks it to the wallet popup's duration.
      if (withAccount) {
        const latest = (await fetchBackendPayouts()).find((p) => p.pendingPayoutCid === r.contractId);
        if (!cancelAllowed(latest)) {
          setBackend((m) => (latest ? new Map(m).set(r.contractId, latest) : m));
          throw new Error(latest ? CANCEL_REFUSED : "The server has not recorded this withdrawal yet; try again in a minute.");
        }
      }
      // The UserWallet contract id changes on every trade, so read it right before
      // signing; a stale cid would make the refund fail on-ledger.
      // These two reads are DELIBERATELY awaited in front of the wallet popup, unlike
      // deposit and withdraw (lib/inAppWallet.ts): the cancel command cannot be built
      // without the fresh contract id, and signing a cancel the backend has already
      // started settling would double-pay. On WebKit an awaited read can cost the click's
      // user activation, so the popup may be blocked here — that surfaces as the
      // "browser blocked the wallet popup" sentence and the person retries
      // (frontend/wallets/cantor8/popupGesture.ts). Correctness first; never reorder these
      // reads after the signature.
      const w = await fetchUserWallet(r.user);
      if (!w) throw new Error("No in-app wallet found for this party, so there is nothing to refund into.");
      const before = w.balanceCC;
      await signAndSubmitTransaction(buildCancelPayoutParams(r.user, r.contractId, w.contractId));
      // The wallet resolves on `txInitiated` (submitted, not committed). Wait for the
      // contract to disappear so the row is not re-offered for a second, doomed cancel
      // and the balance card shows the refund; `acting` stays set the whole time.
      const deadline = Date.now() + 15_000;
      let gone = false;
      while (Date.now() < deadline && !gone) {
        await sleep(1_000);
        const [stillThere, latestWallet] = await Promise.all([
          fetchPendingPayouts(r.user).then((l) => l.some((p) => p.contractId === r.contractId)),
          fetchUserWallet(r.user),
        ]);
        gone = !stillThere || (latestWallet?.balanceCC ?? 0) >= before + r.amountCC - 1e-6;
      }
      setCancelTarget(null);
      toast({
        title: gone ? "Refunded to in-app wallet" : "Cancellation submitted",
        description: gone
          ? `${fmtCC(r.amountCC)} CC is back in your in-app balance.`
          : `The cancellation was submitted; ${fmtCC(r.amountCC)} CC returns to your in-app balance once it commits.`,
        status: gone ? "success" : "info",
        duration: 6000,
        isClosable: true,
      });
      await refresh();
      await onChanged?.();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(null);
    }
  };

  if (!account) return null;

  const total = rows.reduce((sum, r) => sum + r.amountCC, 0);
  const kycGated = me?.capabilities.kycRequiredForWithdrawal === true;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-primary" />
            <h2 className="text-base font-extrabold text-slate-950">Pending Payouts</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            CC owed after sells, merged pairs, resolved winning shares or withdrawals. Paid asynchronously via the
            Enterprise Wallet
            {withAccount
              ? kycGated
                ? "; withdrawals settle once your identity is verified, bonds and prizes settle into your in-app balance."
                : "; bonds and prizes settle into your in-app balance."
              : "."}
          </p>
        </div>
        <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-primary">
          {total.toFixed(4)} CC
        </div>
      </div>

      {loadError && (
        <div className="flex flex-wrap items-center gap-2 border-b border-red-100 bg-red-50 px-6 py-2 text-xs text-red-700">
          <span>Could not load payouts: {loadError}</span>
          <button type="button" onClick={() => void refresh()} className="font-semibold underline underline-offset-2">
            Retry
          </button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">Loading payouts...</div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">No pending payouts.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 font-bold sm:px-6">Market</th>
                <th className="px-5 py-3 font-bold sm:px-6">Reason</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">Amount</th>
                <th className="px-5 py-3 font-bold sm:px-6">Created</th>
                {withAccount && <th className="px-5 py-3 font-bold sm:px-6">Status</th>}
                {withAccount && <th className="px-5 py-3 font-bold sm:px-6"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rows.map((r) => {
                const b = backend.get(r.contractId);
                const isWithdraw = r.reason === "withdraw";
                const settled = b?.status === "settled_external" || b?.status === "settled_in_app";
                const canSign = connected === r.user;
                // §9.4: the backend settles a row only when its payee is one of the
                // account's wallets. Anything else (state C's own rows, a party linked
                // to nobody) would 404, so offer the link instead of a doomed button.
                const ownedByAccount = withAccount && accountParties.has(r.user);
                const view = ownedByAccount || !withAccount ? statusView(b) : { label: "Not linked to your account", tone: "warn" as PillTone };
                // Cancelling while the transfer may already be in flight would pay twice;
                // cancelAndRefund re-checks right before signing.
                const cancellable = isWithdraw && !settled && b?.status !== "settling" && b?.status !== "failed";
                // blocked_kyc always answers 409 kyc_required — the pill already says so.
                const canSettle = ownedByAccount && !settled && (!b || b.status === "queued");
                return (
                  <tr key={r.contractId} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-4 font-bold text-slate-950 sm:px-6">{r.marketId === 0 ? "—" : `#${r.marketId}`}</td>
                    <td className="px-5 py-4 sm:px-6">
                      {r.reason}
                      {withAccount && primaryPartyId && r.user !== primaryPartyId && (
                        <div className="font-mono text-[11px] text-slate-400" title={r.user}>
                          to {shortPartyId(r.user)}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-primary sm:px-6">{r.amountCC.toFixed(4)} CC</td>
                    <td className="px-5 py-4 text-slate-500 sm:px-6">{formatDateTimeUTC(r.createdAt * 1000)}</td>
                    {withAccount && (
                      <td className="px-5 py-4 sm:px-6">
                        <div className="flex flex-col items-start gap-1">
                          {view.verifyLink ? (
                            <Link to="/account#verification">
                              <Pill tone={view.tone}>{view.label}</Pill>
                            </Link>
                          ) : (
                            <Pill tone={view.tone}>{view.label}</Pill>
                          )}
                          {!ownedByAccount && (
                            <span className="text-[11px] text-slate-500">{payoutBlockedSentence("blocked_unknown_user")}</span>
                          )}
                          {b?.retryAfterKyc && !settled && (
                            <span className="text-[11px] text-slate-500">Retries automatically after verification</span>
                          )}
                          {b?.status === "failed" && b.lastError && (
                            <span className="text-[11px] text-slate-500" title={b.lastError}>
                              Support has been notified
                            </span>
                          )}
                        </div>
                      </td>
                    )}
                    {withAccount && (
                      <td className="px-5 py-4 sm:px-6">
                        <div className="flex flex-wrap justify-end gap-2">
                          {canSettle && (
                            <button
                              type="button"
                              onClick={() => void settleNow(r)}
                              disabled={acting !== null}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-emerald-50 disabled:opacity-50"
                            >
                              <Play className="h-3 w-3" /> {acting === r.contractId ? "Settling…" : "Settle now"}
                            </button>
                          )}
                          {!ownedByAccount && canSign && (
                            <button
                              type="button"
                              onClick={() => void linkConnected()}
                              disabled={acting !== null || linking}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-emerald-50 disabled:opacity-50"
                            >
                              {linking ? "Waiting for your wallet…" : "Link this wallet to settle"}
                            </button>
                          )}
                          {!ownedByAccount && !canSign && (
                            <span className="text-[11px] text-slate-500">Connect and link {shortPartyId(r.user)} to settle</span>
                          )}
                          {cancellable && (
                            <button
                              type="button"
                              onClick={() => {
                                setCancelError(null);
                                setCancelTarget(r);
                              }}
                              disabled={acting !== null || !canSign}
                              title={canSign ? "Return this CC to your in-app balance" : `Connect ${shortPartyId(r.user)} to cancel`}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Undo2 className="h-3 w-3" /> Cancel and refund to in-app wallet
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Cancel this withdrawal?"
        description={
          cancelTarget
            ? `${fmtCC(cancelTarget.amountCC)} CC goes back into your in-app balance instead of being sent to your external wallet. Your wallet will ask you to sign the cancellation. If settlement has started in the meantime the cancel is refused.`
            : ""
        }
        confirmLabel="Cancel and refund"
        busy={acting !== null && acting === cancelTarget?.contractId}
        error={cancelError}
        onConfirm={() => void cancelAndRefund()}
      />
    </section>
  );
}

export default PendingPayouts;
