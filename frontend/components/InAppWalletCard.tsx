/**
 * In-app wallet card: shows the account's on-ledger UserWallet balance and runs the
 * two flows that touch the external wallet — deposit (one CC-transfer popup, then the
 * backend credits the balance) and withdraw (one Withdraw signature, then the backend
 * settles real CC out). Trades themselves never come here: they debit/credit the
 * balance inside the market choice.
 *
 * The balance belongs to the ACCOUNT and lives on its primary wallet's UserWallet —
 * the only UserWallet that exists, because only the backend creates one. States, keyed
 * on the connected wallet vs the signed-in account (ARCHITECTURE.md §16):
 *  (A) connected wallet is the primary          → deposit + withdraw (KYC-gated);
 *  (B) connected wallet is linked, not primary  → deposit into the account; withdraw
 *      needs the primary's key ("connect <primary> to withdraw");
 *  (C) connected wallet is not linked           → controls disabled, "Link this wallet to
 *      your account" CTA; no balance — a party without an account has no UserWallet.
 *  anonymous    → "Sign in to deposit and trade with an in-app balance" + Sign-in button;
 *  unavailable  → no accounts backend on this deployment: a sentence, no controls;
 *  unreachable, or a session whose /me failed → both flows pause with a Retry.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useToast } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, Link2, LogIn, RefreshCw, Wallet } from "lucide-react";
import { useCantonWallet } from "@/wallets";
import { useAccountWallet, useAuth } from "@/auth/AuthContext";
import { WALLET_DISPLAY_NAME } from "@/config";
import { fetchUserWallet, type UserWalletRecord } from "@/utils/activeContracts";
import {
  creditPendingDeposits,
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
const CHECKING_REASON = "Checking your account…";

export function InAppWalletCard({
  wallet: walletProp,
  walletLoaded = true,
  onChanged,
  reloadKey = 0,
  variant = "row",
}: {
  /**
   * Pass the account's wallet record (the primary party's UserWallet) to control it
   * from a parent; omit to self-fetch. Ignored outside states A/B.
   */
  wallet?: UserWalletRecord | null;
  /** Managed mode: false while the parent's first wallet read is still in flight. */
  walletLoaded?: boolean;
  onChanged?: () => void | Promise<void>;
  /** Self-fetch mode: bump to make the card re-read the ledger (a sibling changed the balance). */
  reloadKey?: number;
  /**
   * "row" spans wide layouts (Portfolio); "compact" stacks for narrow sidebars; "inline" is the
   * balance line at the foot of the order ticket (the ticket's own call to action already covers
   * signing in and connecting a wallet, so it renders nothing until there is a balance to show).
   */
  variant?: "row" | "compact" | "inline";
}) {
  const { account, connect, transferCC, signAndSubmitTransaction } = useCantonWallet();
  const auth = useAuth();
  const { me, walletState, accountParty, accountMode, signInRequired, linkRequired, backendPaused } = useAccountWallet();
  const toast = useToast();
  const [selfWallet, setSelfWallet] = useState<UserWalletRecord | null>(null);
  const [selfLoaded, setSelfLoaded] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState<"connect" | "deposit" | "withdraw" | "link" | "credit" | null>(null);
  // A transfer reached the treasury but the credit did not show: offer a credit-only retry.
  const [creditPending, setCreditPending] = useState<string | null>(null);
  // Compact variant: which action's amount form is open (collapsed by default).
  const [panel, setPanel] = useState<"deposit" | "withdraw" | null>(null);

  const managed = walletProp !== undefined;
  // The card is about the account's balance, so outside states A/B there is no wallet
  // to show — whatever a parent passed for the connected party is not the account's.
  const wallet = accountMode ? (managed ? walletProp : selfWallet) : null;
  const authLoading = auth.status === "loading";

  useEffect(() => {
    if (managed) return;
    if (!accountParty) {
      setSelfWallet(null);
      setSelfLoaded(false);
      return;
    }
    let cancelled = false;
    setSelfLoaded(false);
    fetchUserWallet(accountParty)
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
  }, [managed, accountParty, reloadKey]);

  const reload = useCallback(async () => {
    if (!managed && accountParty) {
      setSelfWallet(await fetchUserWallet(accountParty));
    }
    await onChanged?.();
  }, [managed, accountParty, onChanged]);

  const amt = Number(amount);
  const balance = wallet?.balanceCC ?? 0;

  // --- Gates ------------------------------------------------------------------------
  // Nothing may build a command while the account state is unknown or the backend is
  // not answering: the CC would move (or the debit would commit) with nobody to credit
  // or settle it.
  const readyLock: Lock | null = authLoading
    ? { reason: CHECKING_REASON }
    : backendPaused
      ? { reason: PAUSED_REASON }
      : null;
  const depositLock: Lock | null =
    readyLock ??
    (linkRequired
      ? { reason: "Link this wallet to your account to deposit" }
      : !accountParty
        ? { reason: "Sign in and link this wallet to deposit" }
        : me && !me.capabilities.canDeposit
          ? { reason: "Deposits are paused for this account. Contact support." }
          : null);
  // The account-level withdraw gate (KYC / suspension) applies to the account's balance.
  const capabilityLock: Lock | null =
    me && !me.capabilities.canWithdraw
      ? me.capabilities.kycRequiredForWithdrawal
        ? { reason: "Verify identity to withdraw", verifyLink: true }
        : { reason: "Withdrawals are not available for this account right now." }
      : null;
  const withdrawLock: Lock | null =
    readyLock ??
    (linkRequired
      ? { reason: "Link this wallet to your account to withdraw" }
      : !accountParty
        ? { reason: "Sign in and link this wallet to withdraw" }
        : walletState === "linked"
          ? { reason: `Connect ${shortPartyId(accountParty)} to withdraw` }
          : capabilityLock);

  const lockToast = (lock: Lock) =>
    toast({
      title: lock.reason,
      description: lock.verifyLink ? "Open Account → Identity verification to get verified." : undefined,
      status: "warning",
      duration: 6000,
      isClosable: true,
    });

  const handleDeposit = async () => {
    if (depositLock) return lockToast(depositLock);
    // Every non-account state is locked above; this only narrows the type.
    if (!accountParty) return;
    if (!(amt > 0)) {
      toast({ title: "Enter a CC amount to deposit", status: "info", duration: 3000, isClosable: true });
      return;
    }
    setBusy("deposit");
    setCreditPending(null);
    // The primary wallet becomes permanent with the first deposit (§8.2) — say so at
    // the one moment it can still be changed. Only once the wallet read has settled:
    // a null wallet that is merely still loading is not a first deposit.
    const firstDeposit = walletLoaded && (managed || selfLoaded) && !wallet;
    const description = firstDeposit
      ? `Confirm the ${fmtCC(amt)} CC transfer in the ${WALLET_DISPLAY_NAME} popup. This first deposit makes ${shortPartyId(accountParty)} the permanent primary wallet of your account — it owns your in-app balance and cannot change afterwards.`
      : walletState === "linked"
        ? `Confirm the ${fmtCC(amt)} CC transfer in the ${WALLET_DISPLAY_NAME} popup — it credits the in-app balance owned by ${shortPartyId(accountParty)}.`
        : `Confirm the ${fmtCC(amt)} CC transfer in the ${WALLET_DISPLAY_NAME} popup — the in-app wallet credits automatically.`;
    const t = toast({ title: "Depositing…", description, status: "info", duration: null, isClosable: false });
    try {
      const outcome = await depositToInAppWallet({ userParty: accountParty, amountCC: amt, transferCC });
      setAmount("");
      await reload();
      // Attribution per wallet lives in /me; keep the Account page's numbers fresh.
      void auth.refresh();
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

  /** Re-run the §8.3 reconcile without moving any CC. */
  const handleRetryCredit = async () => {
    if (readyLock) return lockToast(readyLock);
    setBusy("credit");
    try {
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
      await reload();
      void auth.refresh();
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

  const handleWithdraw = async () => {
    // Never build the Withdraw command while gated: the debit would commit on-ledger and
    // the payout would then sit blocked server-side.
    if (withdrawLock) return lockToast(withdrawLock);
    if (!wallet || !accountParty) return;
    if (!(amt > 0)) {
      toast({ title: "Enter a CC amount to withdraw", status: "info", duration: 3000, isClosable: true });
      return;
    }
    if (amt > wallet.balanceCC) {
      toast({
        title: "Amount exceeds in-app balance",
        description: `Available: ${fmtCC(wallet.balanceCC)} CC.`,
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    setBusy("withdraw");
    const t = toast({
      title: "Withdrawing…",
      description: `Confirm the withdrawal in the ${WALLET_DISPLAY_NAME} popup — CC is then sent to your ${WALLET_DISPLAY_NAME} wallet.`,
      status: "info",
      duration: null,
      isClosable: false,
    });
    try {
      const result = await withdrawFromInAppWallet({
        userParty: accountParty,
        amountCC: amt,
        walletContractId: wallet.contractId,
        signAndSubmitTransaction,
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

  // Connecting and linking are two clicks on purpose: each opens a wallet popup and the
  // browser allows one popup per click (wallets/cantor8/popupGesture.ts).
  const handleConnect = async () => {
    setBusy("connect");
    try {
      await connect();
    } catch (e) {
      toast({
        title: "Could not connect the wallet",
        description: authErrorMessage(e),
        status: "error",
        duration: 8000,
        isClosable: true,
      });
    } finally {
      setBusy(null);
    }
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

  // --- Frame shared by every state --------------------------------------------------
  const shell = (body: ReactNode) => (
    <div
      className={`rounded-xl border-2 border-primary/40 border-l-4 border-l-primary bg-card shadow-sm ${
        compact ? "px-4 py-3" : "px-5 py-4"
      }`}
    >
      {body}
    </div>
  );
  const header = (
    <div className="flex items-center gap-2">
      <Wallet className="h-4 w-4 text-primary" />
      <h2 className="text-sm font-semibold text-foreground">In-app wallet</h2>
    </div>
  );

  if (variant === "inline" && (auth.status === "unavailable" || signInRequired || !account)) return null;

  if (auth.status === "unavailable") {
    // The pre-accounts app: nothing to say until a wallet is connected.
    if (!account) return null;
    return shell(
      <>
        {header}
        <p className="mt-1.5 text-xs text-muted-foreground">
          Accounts are not enabled on this deployment, so there is no in-app balance to deposit into or withdraw
          from. Trading stays wallet-signed.
        </p>
      </>,
    );
  }

  // The account comes first, the wallet second (ARCHITECTURE §18): an anonymous visitor
  // is asked to sign in whether or not a wallet happens to be connected.
  if (signInRequired) {
    return shell(
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          {header}
          <p className="mt-1.5 text-xs text-muted-foreground">Sign in to deposit and trade with an in-app balance.</p>
        </div>
        <button
          type="button"
          onClick={() => auth.openLogin()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <LogIn className="h-3.5 w-3.5" /> Sign in
        </button>
      </div>,
    );
  }

  // Signed in, no wallet connected yet: the next step is the wallet. One click, one
  // popup; linking follows as its own click once the party is known.
  if (!account) {
    if (auth.status !== "authenticated") return null;
    return shell(
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          {header}
          <p className="mt-1.5 text-xs text-muted-foreground">
            Connect your {WALLET_DISPLAY_NAME} wallet to deposit CC into your in-app balance and trade.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Wallet className="h-3.5 w-3.5" /> {busy === "connect" ? "Waiting for your wallet…" : `Connect ${WALLET_DISPLAY_NAME} wallet`}
        </button>
      </div>,
    );
  }

  // While the wallet read is in flight (self-fetch, or the parent's first load), keep
  // the text short and the balance a dash — the long no-wallet hint would widen the
  // layout and shift the controls on load, and the "first deposit" note must not
  // flash for an account that already has a wallet.
  const loading = authLoading || (accountMode && (managed ? !walletLoaded : !selfLoaded));
  const balanceText = loading || !accountMode ? "—" : `${fmtCC(balance)} CC`;
  const subLine = loading
    ? "loading balance…"
    : linkRequired
      ? "Link this wallet to use your account's in-app balance."
      : wallet
        ? `deposited ${fmtCC(wallet.depositedCC)} · withdrawn ${fmtCC(wallet.withdrawnCC)}`
        : "Deposit CC once, then every trade is a single signature.";

  const depositDisabled = busy !== null || depositLock !== null;
  const withdrawDisabled = busy !== null || !wallet || balance <= 0 || withdrawLock !== null;
  // Locks already explained by their own hint line below.
  const explained = readyLock !== null || linkRequired;

  /** Account-state lines under the controls. */
  const hints = (
    <>
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
          to deposit or withdraw.
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
      {depositLock && !explained && <p className="text-amber-700">{depositLock.reason}</p>}
      {withdrawLock && !explained && (
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

  if (variant === "inline") {
    const linkBtn = (active: boolean) =>
      `text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? "text-slate-950 underline underline-offset-4" : "text-primary hover:text-slate-950"}`;
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-slate-500">
            Balance <span className="ml-1 font-bold tabular-nums text-slate-950">{balanceText}</span>
          </span>
          <span className="flex items-center gap-3">
            <button type="button" onClick={() => setPanel(panel === "deposit" ? null : "deposit")} disabled={depositLock !== null} title={depositLock?.reason} className={linkBtn(panel === "deposit")}>
              Deposit
            </button>
            <button type="button" onClick={() => setPanel(panel === "withdraw" ? null : "withdraw")} disabled={!wallet || balance <= 0 || withdrawLock !== null} title={withdrawLock?.reason} className={linkBtn(panel === "withdraw")}>
              Withdraw
            </button>
          </span>
        </div>
        {panel !== null && (
          <div className="mt-2.5 flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (CC)"
              aria-label={panel === "deposit" ? "Amount to deposit (CC)" : "Amount to withdraw (CC)"}
              className="min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-foreground outline-none focus:border-slate-400"
            />
            <button
              type="button"
              onClick={panel === "deposit" ? handleDeposit : handleWithdraw}
              disabled={panel === "deposit" ? depositDisabled : withdrawDisabled}
              title={panel === "withdraw" ? withdrawLock?.reason : depositLock?.reason}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
            >
              {panel === "deposit" ? <ArrowDownToLine className="h-3.5 w-3.5" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
              {panel === "deposit" ? (busy === "deposit" ? "Depositing…" : "Deposit") : busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
            </button>
          </div>
        )}
        <div className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-slate-500 empty:hidden">
          {panel !== null && <p>{subLine}</p>}
          {hints}
        </div>
      </div>
    );
  }

  if (compact) {
    // Both states keep a 1px border so toggling never changes the button's size.
    const togglePill = (active: boolean) =>
      `rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-50 disabled:hover:bg-transparent"
      }`;
    return shell(
      <>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          {header}
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
              disabled={!wallet || balance <= 0 || withdrawLock !== null}
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
                title={panel === "withdraw" ? withdrawLock?.reason : depositLock?.reason}
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
      </>,
    );
  }

  return shell(
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-[10rem]">
          {header}
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
            disabled={depositLock !== null && withdrawLock !== null}
            className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
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
    </>,
  );
}

export default InAppWalletCard;
