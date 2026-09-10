/**
 * In-app wallet card: shows the on-ledger UserWallet balance and runs the
 * two flows that touch the external wallet — deposit (one CC-transfer popup,
 * then the balance is credited) and withdraw (one Withdraw signature, then
 * real CC is sent out). Trades themselves never come here: they debit/credit
 * the balance inside the market choice.
 *
 * With an account signed in (ARCHITECTURE.md §16) the card is about the
 * ACCOUNT's balance, which lives on the primary wallet's UserWallet:
 *  (A) connected wallet is the primary   → deposit, withdraw (KYC-gated);
 *  (B) connected wallet is linked, not primary → deposit into the account; the party's
 *      OWN on-ledger balance (if it has one) is shown separately and withdrawable
 *      with this wallet's key (§8.1) — the account's balance needs the primary;
 *  (C) connected wallet is not linked    → the party's own wallet, legacy rails, plus a link CTA.
 * Anonymous, or a deployment without an accounts backend, is unchanged. A backend that
 * exists but is unreachable (or a session whose /me failed) PAUSES both flows: the
 * legacy routes would answer 410 only after the CC had moved (§18).
 */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, Link2, RefreshCw, Wallet } from "lucide-react";
import { useCantonWallet } from "@/wallets";
import { useAccountWallet, useAuth } from "@/auth/AuthContext";
import { WALLET_DISPLAY_NAME } from "@/config";
import { fetchUserWallet, type UserWalletRecord } from "@/utils/activeContracts";
import {
  creditPendingDeposits,
  creditPendingDepositsLegacy,
  depositToInAppWallet,
  isDepositCreditPending,
  withdrawFromInAppWallet,
  type SettleOutcome,
} from "@/lib/inAppWallet";
import { shortPartyId } from "@/lib/party";
import { authErrorMessage } from "@/auth/wallet";
import { BACKEND_UNREACHABLE_SENTENCE } from "@/lib/backendErrors";
import { fmtCC } from "./market/marketHelpers";

/** Why a button is off, and whether the fix is the verification page. */
type Lock = { reason: string; verifyLink?: boolean };

const PAUSED_REASON = "Deposits and withdrawals are paused while the accounts service is unreachable";

export function InAppWalletCard({
  wallet: walletProp,
  walletLoaded = true,
  onChanged,
  reloadKey = 0,
  variant = "row",
}: {
  /** Pass the wallet record to control it from a parent; omit to self-fetch. */
  wallet?: UserWalletRecord | null;
  /** Managed mode: false while the parent's first wallet read is still in flight. */
  walletLoaded?: boolean;
  onChanged?: () => void | Promise<void>;
  /** Self-fetch mode: bump to make the card re-read the ledger (a sibling changed the balance). */
  reloadKey?: number;
  /** "row" spans wide layouts (Portfolio); "compact" stacks for narrow sidebars (market page). */
  variant?: "row" | "compact";
}) {
  const { account, transferCC, signAndSubmitTransaction } = useCantonWallet();
  const auth = useAuth();
  const { me, walletState, accountParty, accountMode, signInRequired, linkRequired, backendPaused } = useAccountWallet();
  const toast = useToast();
  const [selfWallet, setSelfWallet] = useState<UserWalletRecord | null>(null);
  const [ownWallet, setOwnWallet] = useState<UserWalletRecord | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState<"deposit" | "withdraw" | "withdraw-own" | "link" | "credit" | null>(null);
  // A transfer reached the treasury but the credit did not show: offer a credit-only retry.
  const [creditPending, setCreditPending] = useState<string | null>(null);
  // Compact variant: which action's amount form is open (collapsed by default).
  const [panel, setPanel] = useState<"deposit" | "withdraw" | null>(null);

  const managed = walletProp !== undefined;
  const wallet = managed ? walletProp : selfWallet;
  const [selfLoaded, setSelfLoaded] = useState(false);

  // --- Which party's wallet is this card about? -----------------------------------
  // States A and B go through the account rails and key on the primary party; state C
  // and anonymous use the connected party's own wallet on the legacy rails.
  const connected = account?.address ?? null;
  const walletParty = accountParty ?? connected;
  const authLoading = auth.status === "loading";
  // State B: the connected party may hold its own UserWallet from before it was linked.
  const ownPartyWallet = walletState === "linked" ? connected : null;

  useEffect(() => {
    if (managed) return;
    if (!walletParty) {
      setSelfWallet(null);
      setSelfLoaded(false);
      return;
    }
    let cancelled = false;
    setSelfLoaded(false);
    fetchUserWallet(walletParty)
      .then((w) => {
        if (!cancelled) setSelfWallet(w);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSelfLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [managed, walletParty, reloadKey]);

  useEffect(() => {
    if (!ownPartyWallet) {
      setOwnWallet(null);
      return;
    }
    let cancelled = false;
    fetchUserWallet(ownPartyWallet)
      .then((w) => {
        if (!cancelled) setOwnWallet(w);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ownPartyWallet, reloadKey]);

  const reload = useCallback(async () => {
    if (!managed && walletParty) {
      setSelfWallet(await fetchUserWallet(walletParty));
    }
    if (ownPartyWallet) setOwnWallet(await fetchUserWallet(ownPartyWallet));
    await onChanged?.();
  }, [managed, walletParty, ownPartyWallet, onChanged]);

  if (!account || !walletParty) return null;

  const amt = Number(amount);
  const balance = wallet?.balanceCC ?? 0;

  // --- Gates ------------------------------------------------------------------------
  const pausedLock: Lock | null = backendPaused ? { reason: PAUSED_REASON } : null;
  const depositLock: Lock | null =
    pausedLock ??
    (linkRequired
      ? { reason: "Link this wallet to your account to deposit" }
      : accountMode && me && !me.capabilities.canDeposit
        ? { reason: "Deposits are paused for this account. Contact support." }
        : null);
  // The account-level withdraw gate (KYC / suspension) — applies to the account's
  // balance and, in state B, to the connected party's own balance too, since the
  // payee is a linked wallet of the same account (§9.4 evaluates the payee's account).
  const capabilityLock: Lock | null =
    accountMode && me && !me.capabilities.canWithdraw
      ? me.capabilities.kycRequiredForWithdrawal
        ? { reason: "Verify identity to withdraw", verifyLink: true }
        : { reason: "Withdrawals are not available for this account right now." }
      : null;
  const withdrawLock: Lock | null =
    pausedLock ??
    (linkRequired
      ? { reason: "Link this wallet to your account to withdraw" }
      : !accountMode || !accountParty
        ? null
        : walletState === "linked"
          ? { reason: `Connect ${shortPartyId(accountParty)} to withdraw the account balance` }
          : capabilityLock);
  const ownWithdrawLock: Lock | null = pausedLock ?? capabilityLock;

  const promptSignIn = (verb: string) => {
    toast({
      title: `Sign in to ${verb}`,
      description: "Deposits and withdrawals are tied to a TruthOracle account on this deployment.",
      status: "info",
      duration: 5000,
      isClosable: true,
    });
    auth.openLogin();
  };

  const lockToast = (lock: Lock) =>
    toast({
      title: lock.reason,
      description: lock.verifyLink ? "Open Account → Identity verification to get verified." : undefined,
      status: "warning",
      duration: 6000,
      isClosable: true,
    });

  const handleDeposit = async () => {
    if (signInRequired) return promptSignIn("deposit");
    if (depositLock) return lockToast(depositLock);
    if (!(amt > 0)) {
      toast({ title: "Enter a CC amount to deposit", status: "info", duration: 3000, isClosable: true });
      return;
    }
    setBusy("deposit");
    setCreditPending(null);
    // The primary wallet becomes permanent with the first deposit (§8.2) — say so at
    // the one moment it can still be changed. Only once the wallet read has settled:
    // a null wallet that is merely still loading is not a first deposit.
    const firstDeposit = accountMode && walletLoaded && (managed || selfLoaded) && !wallet;
    const description = firstDeposit && accountParty
      ? `Confirm the ${fmtCC(amt)} CC transfer in the ${WALLET_DISPLAY_NAME} popup. This first deposit makes ${shortPartyId(accountParty)} the permanent primary wallet of your account — it owns your in-app balance and cannot change afterwards.`
      : accountMode && accountParty && walletState === "linked"
        ? `Confirm the ${fmtCC(amt)} CC transfer in the ${WALLET_DISPLAY_NAME} popup — it credits the in-app balance owned by ${shortPartyId(accountParty)}.`
        : `Confirm the ${fmtCC(amt)} CC transfer in the ${WALLET_DISPLAY_NAME} popup — the in-app wallet credits automatically.`;
    const t = toast({ title: "Depositing…", description, status: "info", duration: null, isClosable: false });
    try {
      const outcome = await depositToInAppWallet({
        userParty: walletParty,
        amountCC: amt,
        transferCC,
        backend: accountMode,
      });
      setAmount("");
      await reload();
      // Attribution per wallet lives in /me; keep the Account page's numbers fresh.
      if (accountMode) void auth.refresh();
      if (outcome.credited) {
        toast({
          title: "Deposit credited",
          description: `In-app balance: ${fmtCC(outcome.wallet?.balanceCC ?? balance + amt)} CC.`,
          status: "success",
          duration: 6000,
          isClosable: true,
        });
      } else {
        // The CC is in the treasury; the credit is not visible yet. Say so — a
        // "credited" toast with the old balance would send people to deposit again.
        setCreditPending("Transfer received — the credit has not shown up yet.");
        toast({
          title: "Transfer received, credit still pending",
          description: `The ${fmtCC(amt)} CC reached the treasury but is not in your in-app balance yet. Use "Retry credit" below — never deposit again to fix this.`,
          status: "warning",
          duration: 12000,
          isClosable: true,
        });
      }
    } catch (e) {
      if (isDepositCreditPending(e)) {
        setCreditPending(e.message);
        toast({
          title: "Transfer received, credit failed",
          description: `${e.message} Your CC is safe in the treasury; use "Retry credit" below.`,
          status: "warning",
          duration: 12000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Deposit failed",
          description: e instanceof Error ? e.message : String(e),
          status: "error",
          duration: 8000,
          isClosable: true,
        });
      }
    } finally {
      if (t !== undefined) toast.close(t);
      setBusy(null);
    }
  };

  /** Re-run §8.3 (or the legacy reconcile) without moving any CC. */
  const handleRetryCredit = async () => {
    if (pausedLock) return lockToast(pausedLock);
    setBusy("credit");
    try {
      if (accountMode) {
        const res = await creditPendingDeposits({ windowMs: 10_000 });
        if (res.status === "nothing_outstanding") {
          toast({
            title: "Nothing to credit yet",
            description: "The treasury has not recorded the transfer yet. Try again in a minute; the transfer itself is safe.",
            status: "info",
            duration: 8000,
            isClosable: true,
          });
          return;
        }
        setCreditPending(null);
        toast({
          title: res.status === "confirmed" ? "Deposit credited" : "Credit submitted",
          description: `${fmtCC(Number(res.credited))} CC ${res.status === "confirmed" ? "credited to" : "being credited to"} your in-app balance.`,
          status: "success",
          duration: 6000,
          isClosable: true,
        });
      } else {
        await creditPendingDepositsLegacy(walletParty);
        setCreditPending(null);
        toast({ title: "Credit re-run", description: "Any transfer not yet credited has been reconciled.", status: "success", duration: 5000, isClosable: true });
      }
      await reload();
      if (accountMode) void auth.refresh();
    } catch (e) {
      toast({
        title: "Credit not completed",
        description: e instanceof Error ? e.message : String(e),
        status: "error",
        duration: 8000,
        isClosable: true,
      });
    } finally {
      setBusy(null);
    }
  };

  const reportWithdraw = (result: SettleOutcome, amountCC: number) => {
    if (result.settled) {
      toast({
        title: result.mode === "in_app" ? "Withdrawal credited in-app" : "Withdrawal sent",
        description:
          result.mode === "in_app"
            ? `${fmtCC(amountCC)} CC was credited to your in-app balance.`
            : `${fmtCC(amountCC)} CC sent to your ${WALLET_DISPLAY_NAME} wallet.`,
        status: "success",
        duration: 7000,
        isClosable: true,
      });
    } else if (result.blocked === "kyc") {
      toast({
        title: "Withdrawal queued — verify your identity",
        description: result.detail,
        status: "warning",
        duration: 10000,
        isClosable: true,
      });
    } else {
      toast({
        title: "Withdrawal queued",
        description: result.detail ?? "Recorded on-ledger; the payout settles automatically shortly.",
        status: "warning",
        duration: 7000,
        isClosable: true,
      });
    }
  };

  /** Shared by the account-balance and own-balance withdrawals; the party is the signer. */
  const runWithdraw = async (kind: "withdraw" | "withdraw-own", party: string, from: UserWalletRecord) => {
    if (!(amt > 0)) {
      toast({ title: "Enter a CC amount to withdraw", status: "info", duration: 3000, isClosable: true });
      return;
    }
    if (amt > from.balanceCC) {
      toast({
        title: "Amount exceeds in-app balance",
        description: `Available: ${fmtCC(from.balanceCC)} CC.`,
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    setBusy(kind);
    const t = toast({
      title: "Withdrawing…",
      description: `Confirm the withdrawal in the ${WALLET_DISPLAY_NAME} popup — CC is then sent to your ${WALLET_DISPLAY_NAME} wallet.`,
      status: "info",
      duration: null,
      isClosable: false,
    });
    try {
      const result = await withdrawFromInAppWallet({
        userParty: party,
        amountCC: amt,
        walletContractId: from.contractId,
        signAndSubmitTransaction,
        // The account rail settles both: the payee is a linked wallet of this account,
        // so the KYC gate applies either way (§9.4). State C / anonymous use the legacy rail.
        backend: accountMode,
      });
      setAmount("");
      await reload();
      reportWithdraw(result, amt);
    } catch (e) {
      toast({
        title: "Withdrawal failed",
        description: e instanceof Error ? e.message : String(e),
        status: "error",
        duration: 8000,
        isClosable: true,
      });
    } finally {
      if (t !== undefined) toast.close(t);
      setBusy(null);
    }
  };

  const handleWithdraw = async () => {
    if (signInRequired) return promptSignIn("withdraw");
    // Never build the Withdraw command while gated: the debit would commit on-ledger and
    // the payout would then sit blocked server-side.
    if (withdrawLock) return lockToast(withdrawLock);
    if (!wallet) return;
    await runWithdraw("withdraw", walletParty, wallet);
  };

  /** State B: the connected party's OWN UserWallet, signed by the connected key (§8.1). */
  const handleWithdrawOwn = async () => {
    if (ownWithdrawLock) return lockToast(ownWithdrawLock);
    if (!ownPartyWallet || !ownWallet) return;
    await runWithdraw("withdraw-own", ownPartyWallet, ownWallet);
  };

  const handleLink = async () => {
    setBusy("link");
    try {
      await auth.linkConnectedWallet();
      toast({ title: "Wallet linked to your account", status: "success", duration: 4000, isClosable: true });
    } catch (e) {
      toast({
        title: "Could not link wallet",
        description: authErrorMessage(e),
        status: "error",
        duration: 8000,
        isClosable: true,
      });
    } finally {
      setBusy(null);
    }
  };

  const compact = variant === "compact";

  // While the wallet read is in flight (self-fetch, or the parent's first load), keep
  // the text short and the balance a dash — the long no-wallet hint would widen the
  // layout and shift the controls on load, and the "first deposit" note must not
  // flash for an account that already has a wallet.
  const loading = managed ? !walletLoaded : !selfLoaded;
  const balanceText = loading ? "—" : `${fmtCC(balance)} CC`;
  const subLine = loading
    ? "loading balance…"
    : wallet
      ? `deposited ${fmtCC(wallet.depositedCC)} · withdrawn ${fmtCC(wallet.withdrawnCC)}`
      : "Deposit CC once, then every trade is a single signature.";

  const depositDisabled = busy !== null || authLoading || depositLock !== null;
  const withdrawDisabled = busy !== null || authLoading || !wallet || balance <= 0 || withdrawLock !== null;
  const ownBalance = ownWallet?.balanceCC ?? 0;
  const showOwnBalance = walletState === "linked" && ownWallet !== null && ownBalance > 0;
  const ownWithdrawDisabled = busy !== null || authLoading || ownWithdrawLock !== null || !(amt > 0);

  /** Account-state lines under the controls; nothing at all for anonymous / unavailable. */
  const hints = (
    <>
      {signInRequired && (
        <p>
          <button type="button" onClick={() => auth.openLogin()} className="font-semibold text-primary hover:underline">
            Sign in
          </button>{" "}
          to deposit or withdraw.
        </p>
      )}
      {backendPaused && (
        <p className="text-amber-700">
          {auth.status === "unreachable" ? BACKEND_UNREACHABLE_SENTENCE : "Your account details could not be loaded."}{" "}
          Deposits and withdrawals are paused until it answers; trading is unaffected.{" "}
          <button type="button" onClick={() => void auth.refresh()} className="font-semibold underline underline-offset-2">
            Retry
          </button>
        </p>
      )}
      {linkRequired && (
        <p>
          <button
            type="button"
            onClick={() => void handleLink()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-50"
          >
            <Link2 className="h-3 w-3" /> {busy === "link" ? "Waiting for your wallet…" : "Link this wallet to your account"}
          </button>{" "}
          to deposit or withdraw — until then it keeps its own balance.
        </p>
      )}
      {accountMode && accountParty && (
        <p>
          Primary wallet <span className="font-mono text-foreground/80">{shortPartyId(accountParty)}</span>
          {walletState === "linked" && (
            <>
              {" "}· connected <span className="font-mono">{shortPartyId(account.address)}</span> is linked, deposit only
            </>
          )}
        </p>
      )}
      {showOwnBalance && ownWallet && ownPartyWallet && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            Own on-ledger balance of <span className="font-mono">{shortPartyId(ownPartyWallet)}</span>:{" "}
            <span className="font-semibold text-foreground">{fmtCC(ownBalance)} CC</span> — separate from the account
            balance, withdrawable only with this wallet's key.
          </span>
          <button
            type="button"
            onClick={() => void handleWithdrawOwn()}
            disabled={ownWithdrawDisabled}
            title={ownWithdrawLock?.reason ?? (amt > 0 ? `Withdraw ${fmtCC(amt)} CC from this wallet's own balance` : "Enter an amount above first")}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-foreground transition-opacity disabled:opacity-50"
          >
            <ArrowUpFromLine className="h-3 w-3" /> {busy === "withdraw-own" ? "Withdrawing…" : "Withdraw own balance"}
          </button>
        </p>
      )}
      {accountMode && !loading && !wallet && accountParty && (
        <p>Your first deposit makes {shortPartyId(accountParty)} the permanent primary wallet — it cannot change afterwards.</p>
      )}
      {creditPending && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-amber-700">
          <span>{creditPending} Your CC is safe in the treasury.</span>
          <button
            type="button"
            onClick={() => void handleRetryCredit()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${busy === "credit" ? "animate-spin" : ""}`} /> {busy === "credit" ? "Crediting…" : "Retry credit"}
          </button>
        </p>
      )}
      {depositLock && !linkRequired && !backendPaused && <p className="text-amber-700">{depositLock.reason}</p>}
      {withdrawLock && !linkRequired && !backendPaused && (
        <p className="text-amber-700">
          {withdrawLock.verifyLink ? (
            <Link to="/account#verification" className="font-semibold underline underline-offset-2">
              {withdrawLock.reason}
            </Link>
          ) : (
            withdrawLock.reason
          )}
        </p>
      )}
    </>
  );

  if (compact) {
    // Both states keep a 1px border so toggling never changes the button's size.
    const togglePill = (active: boolean) =>
      `rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-50 disabled:hover:bg-transparent"
      }`;
    return (
      <div className="rounded-xl border-2 border-primary/40 border-l-4 border-l-primary bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">In-app wallet</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-base font-extrabold tabular-nums text-foreground">{balanceText}</span>
            <button
              onClick={() => setPanel(panel === "deposit" ? null : "deposit")}
              disabled={depositLock !== null}
              title={depositLock?.reason}
              className={togglePill(panel === "deposit")}
            >
              Deposit
            </button>
            <button
              onClick={() => setPanel(panel === "withdraw" ? null : "withdraw")}
              disabled={(!wallet || balance <= 0 || withdrawLock !== null) && !showOwnBalance}
              title={withdrawLock?.reason}
              className={togglePill(panel === "withdraw")}
            >
              Withdraw
            </button>
          </div>
        </div>
        {panel !== null && (
          <>
            <div className="mt-2.5 flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount (CC)"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <button
                onClick={panel === "deposit" ? handleDeposit : handleWithdraw}
                disabled={panel === "deposit" ? depositDisabled : withdrawDisabled}
                title={panel === "withdraw" ? withdrawLock?.reason : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
              >
                {panel === "deposit" ? (
                  <>
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                    {busy === "deposit" ? "Depositing…" : "Deposit"}
                  </>
                ) : (
                  <>
                    <ArrowUpFromLine className="h-3.5 w-3.5" />
                    {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
                  </>
                )}
              </button>
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">{subLine}</div>
          </>
        )}
        <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground empty:hidden">{hints}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-primary/40 border-l-4 border-l-primary bg-card px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-[10rem]">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">In-app wallet</h2>
          </div>
          <div className="mt-1.5 text-2xl font-extrabold tabular-nums text-foreground">{balanceText}</div>
          <div className="text-[11px] text-muted-foreground">{subLine}</div>
        </div>
        <div className="flex flex-1 items-center gap-2">
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (CC)"
            className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={handleDeposit}
            disabled={depositDisabled}
            title={depositLock?.reason}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            {busy === "deposit" ? "Depositing…" : "Deposit"}
          </button>
          <button
            onClick={handleWithdraw}
            disabled={withdrawDisabled}
            title={withdrawLock?.reason}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition-opacity disabled:opacity-50"
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      </div>
      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground empty:hidden">{hints}</div>
    </div>
  );
}

export default InAppWalletCard;
