/**
 * In-app wallet card: the account's on-ledger UserWallet balances — one row per instrument — and
 * the two flows that touch the external wallet: deposit (one token-transfer popup in the row's
 * instrument, then the backend credits the balance) and withdraw (one Withdraw signature on that
 * instrument's wallet, then the backend settles the tokens out). Trades themselves never come
 * here: they debit/credit the balance of the market's collateral inside the market choice.
 *
 * Which rows (docs/TOKENS.md §5): a parent may pin the card to ONE instrument (a market page
 * passes its collateral, the Rewards page the rewards token); otherwise the catalog's default
 * collateral and the rewards instrument are always shown — even before a wallet exists for them —
 * followed by every other instrument the account holds a wallet in (`GET /in-app-wallet`
 * `balances`, with the participant as the fallback read). A party holds one UserWallet per
 * instrument, created by the backend on the first credit, so a row without a wallet reads 0.
 *
 * Deposit gate: the connected wallet's own instrument list (`listInstruments()`, read once per
 * connected party from the SDK's session — no popup) must name the row's `walletInstrumentId`;
 * otherwise the button is off with "Your Cantor8 wallet does not list <symbol> yet". The transfer
 * is sent under that wallet id with the memo "TruthOracle: deposit <amount> <symbol> to in-app
 * wallet", and the reconcile names the instrument. Withdraw quantises the amount to the
 * instrument's decimals (the input's step, the lib's floor) because the treasury keeps the dust.
 *
 * The balance belongs to the ACCOUNT and lives on its primary wallet's UserWallets — the only
 * UserWallets that exist, because only the backend creates them. States, keyed on the connected
 * wallet vs the signed-in account (ARCHITECTURE.md §16):
 *  (A) connected wallet is the primary          → deposit + withdraw (KYC-gated);
 *  (B) connected wallet is linked, not primary  → deposit into the account; withdraw
 *      needs the primary's key ("connect <primary> to withdraw");
 *  (C) connected wallet is not linked           → controls disabled, "Link this wallet to
 *      your account" CTA; no balance — a party without an account has no UserWallet.
 *  anonymous    → "Sign in to deposit and trade with an in-app balance" + Sign-in button;
 *  unavailable  → no accounts backend on this deployment: a sentence, no controls;
 *  unreachable, or a session whose /me failed → both flows pause with a Retry.
 *
 * Popup gestures (wallets/cantor8/popupGesture.ts): every popup-opening call (connect, link,
 * the transfer, the Withdraw signature) is the first thing its click awaits and has its own
 * button; the lib reads the "before" state without awaiting it in front of the popup.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useToast } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, Link2, LogIn, RefreshCw, Wallet } from "lucide-react";
import { useCantonWallet, type WalletInstrument } from "@/wallets";
import { useAccountWallet, useAuth } from "@/auth/AuthContext";
import { WALLET_DISPLAY_NAME } from "@/config";
import type { UserWalletRecord } from "@/utils/activeContracts";
import {
  creditPendingDeposits,
  depositToInAppWallet,
  fetchAccountBalances,
  isDepositCreditPending,
  missingWalletInstrumentReason,
  withdrawFromInAppWallet,
  type AccountBalances,
  type SettleOutcome,
} from "@/lib/inAppWallet";
import { shortPartyId } from "@/lib/party";
import { authErrorMessage } from "@/auth/wallet";
import { BACKEND_UNREACHABLE_SENTENCE } from "@/lib/backendErrors";
import { debugWarn } from "@/lib/debugLog";
import {
  amountStep,
  defaultCollateral,
  findInstrument,
  formatAmount,
  formatMoney,
  instrumentKey,
  instrumentLabel,
  quantizeAmount,
  rewardsInstrument,
  sameInstrument,
  useInstruments,
  type ApiInstrument,
  type InstrumentRef,
} from "@/lib/instruments";

/** Why a button is off, and whether the fix is the verification page. */
type Lock = { reason: string; verifyLink?: boolean };

export type WalletAction = "deposit" | "withdraw";

/** One instrument the card shows: the catalog's entry when it knows the token, and the account's wallet for it. */
interface BalanceRow {
  key: string;
  instrument: InstrumentRef;
  catalog: ApiInstrument | null;
  wallet: UserWalletRecord | null;
}

const BOTH_ACTIONS: readonly WalletAction[] = ["deposit", "withdraw"];
const PAUSED_REASON = "Deposits and withdrawals are paused while the accounts service is unreachable";
const CHECKING_REASON = "Checking your account…";
const WALLET_LIST_PENDING = `Checking which tokens your ${WALLET_DISPLAY_NAME} wallet lists…`;

export function InAppWalletCard({
  wallet: walletProp,
  walletLoaded = true,
  instrument: instrumentProp,
  actions = BOTH_ACTIONS,
  title = "In-app wallet",
  onChanged,
  reloadKey = 0,
  variant = "row",
}: {
  /**
   * Managed mode: the account's wallet record (the primary party's UserWallet for `instrument`)
   * from a parent that already read it; omit to self-fetch every row. Ignored outside states A/B.
   */
  wallet?: UserWalletRecord | null;
  /**
   * Pin the card to one instrument: a market page passes its collateral, the Rewards page the
   * rewards token. Omitted, the card lists the default collateral, the rewards instrument and
   * every instrument the account holds a wallet in.
   */
  instrument?: InstrumentRef;
  /** Which flows to offer (both by default); the Rewards page offers only the withdrawal. */
  actions?: readonly WalletAction[];
  /** The card's heading. */
  title?: string;
  /** Managed mode: false while the parent's first wallet read is still in flight. */
  walletLoaded?: boolean;
  onChanged?: () => void | Promise<void>;
  /** Self-fetch mode: bump to make the card re-read the balances (a sibling changed one). */
  reloadKey?: number;
  /**
   * "row" spans wide layouts (Portfolio); "compact" stacks for narrow sidebars; "inline" is the
   * balance line at the foot of the order ticket (the ticket's own call to action already covers
   * signing in and connecting a wallet, so it renders nothing until there is a balance to show).
   */
  variant?: "row" | "compact" | "inline";
}) {
  const { account, connect, transfer, listInstruments, signAndSubmitTransaction } = useCantonWallet();
  const auth = useAuth();
  const { me, walletState, accountParty, accountMode, signInRequired, linkRequired, backendPaused } = useAccountWallet();
  const toast = useToast();
  // The catalog names the rows, the Cantor8 id of each token and its decimals. A pinned instrument
  // the catalog does not list (or a catalog still loading) leaves that row's deposit locked;
  // labels still come from whatever is known.
  const instrumentsQuery = useInstruments();
  const instruments = instrumentsQuery.data;
  const [balances, setBalances] = useState<AccountBalances | null>(null);
  const [selfLoaded, setSelfLoaded] = useState(false);
  // What the connected wallet can send: undefined while asking, null when it did not answer.
  const [walletInstruments, setWalletInstruments] = useState<WalletInstrument[] | null | undefined>(undefined);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState<"connect" | "deposit" | "withdraw" | "link" | "credit" | null>(null);
  // A transfer reached the treasury but the credit did not show: offer a credit-only retry for that instrument.
  const [creditPending, setCreditPending] = useState<{ key: string; message: string } | null>(null);
  // Which row's amount form is open, and for which action (collapsed by default).
  const [panel, setPanel] = useState<{ key: string; action: WalletAction } | null>(null);

  const managed = walletProp !== undefined;
  const offers = (a: WalletAction) => actions.includes(a);
  const authLoading = auth.status === "loading";

  useEffect(() => {
    if (managed) return;
    if (!accountParty) {
      setBalances(null);
      setSelfLoaded(false);
      return;
    }
    let cancelled = false;
    setSelfLoaded(false);
    fetchAccountBalances(accountParty)
      .then((b) => {
        if (!cancelled) setBalances(b);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSelfLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [managed, accountParty, reloadKey]);

  // The wallet's instrument list, once per connected party (the context caches it); only when a
  // deposit can be offered at all, so a withdraw-only card asks the wallet nothing.
  useEffect(() => {
    if (!account?.partyId || !offers("deposit")) {
      setWalletInstruments(undefined);
      return;
    }
    let cancelled = false;
    setWalletInstruments(undefined);
    listInstruments()
      .then((list) => {
        if (!cancelled) setWalletInstruments(list);
      })
      .catch((e: unknown) => {
        debugWarn("[InAppWalletCard] listInstruments failed", e);
        if (!cancelled) setWalletInstruments(null);
      });
    return () => {
      cancelled = true;
    };
    // `offers` is derived from the `actions` prop; the identity below is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.partyId, listInstruments, actions.includes("deposit")]);

  // The card is about the account's balance, so outside states A/B there is no wallet
  // to show — whatever a parent passed for the connected party is not the account's.
  const wallets: UserWalletRecord[] = useMemo(() => {
    if (!accountMode) return [];
    if (managed) return walletProp ? [walletProp] : [];
    return balances?.wallets ?? [];
  }, [accountMode, managed, walletProp, balances]);

  const rows: BalanceRow[] = useMemo(() => {
    const list: InstrumentRef[] = [];
    const push = (i: InstrumentRef | null | undefined) => {
      if (i && !list.some((x) => sameInstrument(x, i))) list.push(i);
    };
    if (instrumentProp) push(instrumentProp);
    else if (managed) for (const w of wallets) push(w.instrument);
    else {
      push(defaultCollateral(instruments));
      push(rewardsInstrument(instruments));
      for (const i of balances?.instruments ?? []) push(i);
      for (const w of wallets) push(w.instrument);
    }
    return list.map((i) => {
      const catalog = findInstrument(instruments, i);
      return {
        key: instrumentKey(i),
        instrument: catalog ?? i,
        catalog,
        wallet: wallets.find((w) => sameInstrument(w.instrument, i)) ?? null,
      };
    });
  }, [instrumentProp, managed, instruments, balances, wallets]);

  const reload = useCallback(async () => {
    if (!managed && accountParty) {
      setBalances(await fetchAccountBalances(accountParty));
    }
    await onChanged?.();
  }, [managed, accountParty, onChanged]);

  const amt = Number(amount);
  const openPanel = (row: BalanceRow, action: WalletAction) => {
    const same = panel?.key === row.key && panel.action === action;
    setPanel(same ? null : { key: row.key, action });
    if (!same) setAmount("");
  };

  // --- Gates ------------------------------------------------------------------------
  // Nothing may build a command while the account state is unknown or the backend is
  // not answering: the tokens would move (or the debit would commit) with nobody to credit
  // or settle it.
  const readyLock: Lock | null = authLoading ? { reason: CHECKING_REASON } : backendPaused ? { reason: PAUSED_REASON } : null;
  const depositLockFor = (row: BalanceRow): Lock | null =>
    readyLock ??
    (linkRequired
      ? { reason: "Link this wallet to your account to deposit" }
      : !accountParty
        ? { reason: "Sign in and link this wallet to deposit" }
        : !row.catalog
          ? instrumentsQuery.isLoading
            ? { reason: "Loading the instrument catalog…" }
            : { reason: `Deposits in ${row.instrument.symbol} are not available on this deployment` }
          : me && !me.capabilities.canDeposit
            ? { reason: "Deposits are paused for this account. Contact support." }
            : walletInstruments === undefined
              ? { reason: WALLET_LIST_PENDING }
              : lockFromSentence(missingWalletInstrumentReason(walletInstruments, row.catalog)));
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
  const withdrawable = (row: BalanceRow) => row.wallet !== null && row.wallet.balance > 0;

  const lockToast = (lock: Lock) =>
    toast({
      title: lock.reason,
      description: lock.verifyLink ? "Open Account → Identity verification to get verified." : undefined,
      status: "warning",
      duration: 6000,
      isClosable: true,
    });

  // While the balances read is in flight (self-fetch, or the parent's first load), keep the text
  // short and every balance a dash — the long no-wallet hint would widen the layout and shift the
  // controls on load, and the "first deposit" note must not flash for an account that has a wallet.
  const loading = authLoading || (accountMode && (managed ? !walletLoaded : !selfLoaded));
  const noWalletYet = accountMode && !loading && rows.every((r) => !r.wallet);

  const handleDeposit = async (row: BalanceRow) => {
    const lock = depositLockFor(row);
    if (lock) return lockToast(lock);
    // Every non-account state is locked above; this only narrows the type.
    if (!accountParty || !row.catalog) return;
    const instrument = row.catalog;
    if (!(amt > 0)) {
      toast({ title: `Enter a ${instrument.symbol} amount to deposit`, status: "info", duration: 3000, isClosable: true });
      return;
    }
    setBusy("deposit");
    setCreditPending(null);
    // The primary wallet becomes permanent with the first deposit (§8.2) — say so at
    // the one moment it can still be changed. Only once the balances read has settled:
    // a missing wallet that is merely still loading is not a first deposit.
    const description = noWalletYet
      ? `Confirm the ${formatMoney(amt, instrument)} transfer in the ${WALLET_DISPLAY_NAME} popup. This first deposit makes ${shortPartyId(accountParty)} the permanent primary wallet of your account — it owns your in-app balance and cannot change afterwards.`
      : walletState === "linked"
        ? `Confirm the ${formatMoney(amt, instrument)} transfer in the ${WALLET_DISPLAY_NAME} popup — it credits the in-app balance owned by ${shortPartyId(accountParty)}.`
        : `Confirm the ${formatMoney(amt, instrument)} transfer in the ${WALLET_DISPLAY_NAME} popup — the in-app wallet credits automatically.`;
    const t = toast({ title: "Depositing…", description, status: "info", duration: null, isClosable: false });
    try {
      const outcome = await depositToInAppWallet({
        userParty: accountParty,
        instrument,
        amount: amt,
        transfer,
        walletInstruments: walletInstruments ?? null,
      });
      setAmount("");
      await reload();
      // Attribution per wallet lives in /me; keep the Account page's numbers fresh.
      void auth.refresh();
      if (outcome.credited) {
        toast({
          title: "Deposit credited",
          description: `In-app balance: ${formatMoney(outcome.wallet?.balance ?? (row.wallet?.balance ?? 0) + amt, instrument)}.`,
          status: "success",
          duration: 6000,
          isClosable: true,
        });
      } else {
        // The tokens are in the treasury; the credit is not visible yet. Say so — a
        // "credited" toast with the old balance would send people to deposit again.
        setCreditPending({ key: row.key, message: "Transfer received — the credit has not shown up yet." });
        toast({
          title: "Transfer received, credit still pending",
          description: `The ${formatMoney(amt, instrument)} reached the treasury but is not in your in-app balance yet. Use "Retry credit" below — never deposit again to fix this.`,
          status: "warning",
          duration: 12000,
          isClosable: true,
        });
      }
    } catch (e) {
      if (isDepositCreditPending(e)) {
        setCreditPending({ key: row.key, message: e.message });
        toast({
          title: "Transfer received, credit failed",
          description: `${e.message} Your transfer is safe in the treasury; use "Retry credit" below.`,
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

  /** Re-run the §8.3 reconcile for the instrument whose credit is pending, without moving any tokens. */
  const handleRetryCredit = async () => {
    if (readyLock) return lockToast(readyLock);
    const row = rows.find((r) => r.key === creditPending?.key);
    setBusy("credit");
    try {
      const res = await creditPendingDeposits({ windowMs: 10_000, instrument: row?.catalog ?? undefined });
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
        description: `${formatMoney(res.credited, res.instrument)} ${res.status === "confirmed" ? "credited to" : "being credited to"} your in-app balance.`,
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

  const reportWithdraw = (result: SettleOutcome, withdrawn: number, withdrawnIn: InstrumentRef) => {
    if (result.settled) {
      toast({
        title: result.mode === "in_app" ? "Withdrawal credited in-app" : "Withdrawal sent",
        description:
          result.mode === "in_app"
            ? `${formatMoney(withdrawn, withdrawnIn)} was credited to your in-app balance.`
            : `${formatMoney(withdrawn, withdrawnIn)} sent to your ${WALLET_DISPLAY_NAME} wallet.`,
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

  const handleWithdraw = async (row: BalanceRow) => {
    // Never build the Withdraw command while gated: the debit would commit on-ledger and
    // the payout would then sit blocked server-side.
    if (withdrawLock) return lockToast(withdrawLock);
    const wallet = row.wallet;
    if (!wallet || !accountParty) return;
    const instrument = row.instrument;
    // What the treasury can actually send: the input floored to the instrument's decimals.
    const quantised = quantizeAmount(amt, instrument.decimals);
    if (!(amt > 0) || !(quantised > 0)) {
      toast({
        title: `Enter a ${instrument.symbol} amount to withdraw`,
        description: amt > 0 ? `${instrument.symbol} is sent in steps of ${amountStep(instrument)}.` : undefined,
        status: "info",
        duration: 4000,
        isClosable: true,
      });
      return;
    }
    if (quantised > wallet.balance) {
      toast({
        title: "Amount exceeds in-app balance",
        description: `Available: ${formatMoney(wallet.balance, instrument)}.`,
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    setBusy("withdraw");
    const t = toast({
      title: "Withdrawing…",
      description: `Confirm the withdrawal in the ${WALLET_DISPLAY_NAME} popup — ${formatMoney(quantised, instrument)} is then sent to your ${WALLET_DISPLAY_NAME} wallet.`,
      status: "info",
      duration: null,
      isClosable: false,
    });
    try {
      const result = await withdrawFromInAppWallet({
        userParty: accountParty,
        instrument,
        amount: quantised,
        walletContractId: wallet.contractId,
        signAndSubmitTransaction,
      });
      setAmount("");
      await reload();
      reportWithdraw(result, result.amount, instrument);
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
  const primaryInstrument: InstrumentRef | null = rows[0]?.instrument ?? instrumentProp ?? null;
  const primarySym = primaryInstrument?.symbol ?? "";

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
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
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
            Connect your {WALLET_DISPLAY_NAME} wallet to {offers("deposit") ? `deposit ${primarySym || "tokens"} into your in-app balance and trade` : `withdraw your ${primarySym || "in-app"} balance`}.
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

  const balanceText = (row: BalanceRow) => (loading || !accountMode ? "—" : formatMoney(row.wallet?.balance ?? 0, row.instrument));
  const subLine = (row: BalanceRow) =>
    loading
      ? "loading balance…"
      : linkRequired
        ? "Link this wallet to use your account's in-app balance."
        : row.wallet
          ? `deposited ${formatAmount(row.wallet.deposited, row.instrument)} · withdrawn ${formatAmount(row.wallet.withdrawn, row.instrument)}`
          : row.catalog?.kind === "rewards"
            ? `Rewards are credited here as you trade; withdraw them to your ${WALLET_DISPLAY_NAME} wallet any time.`
            : `Deposit ${row.instrument.symbol} once, then every trade is a single signature.`;

  // Locks already explained by their own hint line below.
  const explained = readyLock !== null || linkRequired;
  /** A row-specific deposit lock worth a line under the row (the global ones are in `hints`). */
  const rowDepositNote = (row: BalanceRow): string | null => {
    if (!offers("deposit") || explained || !accountParty) return null;
    const lock = depositLockFor(row);
    return lock && lock.reason !== WALLET_LIST_PENDING ? lock.reason : null;
  };
  const depositDisabled = (row: BalanceRow) => busy !== null || depositLockFor(row) !== null;
  const withdrawDisabled = (row: BalanceRow) => busy !== null || !withdrawable(row) || withdrawLock !== null;

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
      {noWalletYet && accountParty && offers("deposit") && (
        <p>Your first deposit makes {shortPartyId(accountParty)} the permanent primary wallet — it cannot change afterwards.</p>
      )}
      {creditPending && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-amber-700">
          <span>{creditPending.message} Your transfer is safe in the treasury.</span>
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
      {offers("withdraw") && withdrawLock && !explained && rows.some(withdrawable) && (
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

  /** The amount form under a row: the input's step is the instrument's smallest unit. */
  const amountForm = (row: BalanceRow, action: WalletAction, inputClass: string, buttonClass: string) => {
    const lock = action === "deposit" ? depositLockFor(row) : withdrawLock;
    const sym = row.instrument.symbol;
    return (
      <div className="mt-2.5">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max={action === "withdraw" ? row.wallet?.balance : undefined}
            step={amountStep(row.instrument)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount (${sym})`}
            aria-label={`${action === "deposit" ? "Amount to deposit" : "Amount to withdraw"} (${sym})`}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => void (action === "deposit" ? handleDeposit(row) : handleWithdraw(row))}
            disabled={action === "deposit" ? depositDisabled(row) : withdrawDisabled(row)}
            title={lock?.reason}
            className={buttonClass}
          >
            {action === "deposit" ? <ArrowDownToLine className="h-3.5 w-3.5" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
            {action === "deposit" ? (busy === "deposit" ? "Depositing…" : `Deposit ${sym}`) : busy === "withdraw" ? "Withdrawing…" : `Withdraw ${sym}`}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
          {action === "deposit"
            ? `Sent from your ${WALLET_DISPLAY_NAME} wallet to the treasury in one popup; the in-app balance credits automatically.`
            : `Available ${formatMoney(row.wallet?.balance ?? 0, row.instrument)} · sent to your ${WALLET_DISPLAY_NAME} wallet after you sign, in steps of ${amountStep(row.instrument)} ${sym}.`}
        </p>
      </div>
    );
  };

  if (variant === "inline") {
    const row = rows[0];
    if (!row) return null;
    const linkBtn = (active: boolean) =>
      `text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? "text-slate-950 underline underline-offset-4" : "text-primary hover:text-slate-950"}`;
    const open = panel?.key === row.key ? panel.action : null;
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-slate-500">
            Balance <span className="ml-1 font-bold tabular-nums text-slate-950">{balanceText(row)}</span>
          </span>
          <span className="flex items-center gap-3">
            {offers("deposit") && (
              <button type="button" onClick={() => openPanel(row, "deposit")} disabled={depositLockFor(row) !== null} title={depositLockFor(row)?.reason} className={linkBtn(open === "deposit")}>
                Deposit
              </button>
            )}
            {offers("withdraw") && (
              <button type="button" onClick={() => openPanel(row, "withdraw")} disabled={!withdrawable(row) || withdrawLock !== null} title={withdrawLock?.reason} className={linkBtn(open === "withdraw")}>
                Withdraw
              </button>
            )}
          </span>
        </div>
        {open !== null &&
          amountForm(
            row,
            open,
            "min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-foreground outline-none focus:border-slate-400",
            "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40",
          )}
        <div className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-slate-500 empty:hidden">
          {open !== null && <p>{subLine(row)}</p>}
          {rowDepositNote(row) && <p className="text-amber-700">{rowDepositNote(row)}</p>}
          {hints}
        </div>
      </div>
    );
  }

  // Both toggle states keep a 1px border so toggling never changes the button's size.
  const togglePill = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-50 disabled:hover:bg-transparent"
    }`;
  const rowControls = (row: BalanceRow) => {
    const open = panel?.key === row.key ? panel.action : null;
    return (
      <div className="flex items-center gap-1.5">
        {offers("deposit") && (
          <button type="button" onClick={() => openPanel(row, "deposit")} disabled={depositLockFor(row) !== null} title={depositLockFor(row)?.reason} className={togglePill(open === "deposit")}>
            Deposit
          </button>
        )}
        {offers("withdraw") && (
          <button type="button" onClick={() => openPanel(row, "withdraw")} disabled={!withdrawable(row) || withdrawLock !== null} title={withdrawLock?.reason} className={togglePill(open === "withdraw")}>
            Withdraw
          </button>
        )}
      </div>
    );
  };
  const rowForm = (row: BalanceRow) =>
    panel?.key === row.key
      ? amountForm(
          row,
          panel.action,
          "min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary",
          "inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50",
        )
      : null;
  const rowLabel = (row: BalanceRow) => (
    <span className="text-xs font-semibold text-muted-foreground">
      {instrumentLabel(row.instrument)}
      {row.catalog?.kind === "rewards" ? " · rewards" : ""}
    </span>
  );

  if (compact) {
    return shell(
      <>
        {header}
        <ul className="mt-2 divide-y divide-border/70">
          {rows.map((row) => (
            <li key={row.key} className="py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <div className="min-w-0">
                  {rows.length > 1 && rowLabel(row)}
                  <div className="text-base font-extrabold tabular-nums text-foreground">{balanceText(row)}</div>
                </div>
                {rowControls(row)}
              </div>
              {rowForm(row)}
              <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground empty:hidden">
                {panel?.key === row.key && <p>{subLine(row)}</p>}
                {rowDepositNote(row) && <p className="text-amber-700">{rowDepositNote(row)}</p>}
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className="py-2 text-xs text-muted-foreground">No instrument is configured for in-app balances yet.</li>}
        </ul>
        <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground empty:hidden">{hints}</div>
      </>,
    );
  }

  return shell(
    <>
      {header}
      <ul className="mt-3 divide-y divide-border/70">
        {rows.map((row) => (
          <li key={row.key} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="min-w-[12rem] flex-1">
                {rowLabel(row)}
                <div className="text-2xl font-extrabold tabular-nums text-foreground">{balanceText(row)}</div>
                <div className="text-[11px] text-muted-foreground">{subLine(row)}</div>
              </div>
              {rowControls(row)}
            </div>
            {rowForm(row)}
            {rowDepositNote(row) && <p className="mt-1.5 text-xs text-amber-700">{rowDepositNote(row)}</p>}
          </li>
        ))}
        {rows.length === 0 && <li className="py-2 text-xs text-muted-foreground">No instrument is configured for in-app balances yet.</li>}
      </ul>
      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground empty:hidden">{hints}</div>
    </>,
  );
}

function lockFromSentence(sentence: string | null): Lock | null {
  return sentence ? { reason: sentence } : null;
}

export default InAppWalletCard;
