/**
 * In-app wallet card: shows the on-ledger UserWallet balance and runs the
 * two flows that touch the external wallet — deposit (one CC-transfer popup,
 * then the admin credits the balance) and withdraw (one Withdraw signature,
 * then the admin auto-sends real CC). Trades themselves never come here:
 * they debit/credit the balance inside the market choice.
 */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { ArrowDownToLine, ArrowUpFromLine, Wallet } from "lucide-react";
import { useCantonWallet } from "@/wallets";
import { WALLET_DISPLAY_NAME } from "@/config";
import { fetchUserWallet, type UserWalletRecord } from "@/utils/activeContracts";
import { depositToInAppWallet, withdrawFromInAppWallet } from "@/lib/inAppWallet";
import { fmtCC } from "./market/marketHelpers";

export function InAppWalletCard({
  wallet: walletProp,
  onChanged,
  variant = "row",
}: {
  /** Pass the wallet record to control it from a parent; omit to self-fetch. */
  wallet?: UserWalletRecord | null;
  onChanged?: () => void | Promise<void>;
  /** "row" spans wide layouts (Portfolio); "compact" stacks for narrow sidebars (market page). */
  variant?: "row" | "compact";
}) {
  const { account, transferCC, signAndSubmitTransaction } = useCantonWallet();
  const toast = useToast();
  const [selfWallet, setSelfWallet] = useState<UserWalletRecord | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState<"deposit" | "withdraw" | null>(null);
  // Compact variant: which action's amount form is open (collapsed by default).
  const [panel, setPanel] = useState<"deposit" | "withdraw" | null>(null);

  const managed = walletProp !== undefined;
  const wallet = managed ? walletProp : selfWallet;

  useEffect(() => {
    if (managed) return;
    if (!account?.address) {
      setSelfWallet(null);
      return;
    }
    fetchUserWallet(account.address).then(setSelfWallet).catch(() => {});
  }, [managed, account?.address]);

  const reload = useCallback(async () => {
    if (!managed && account?.address) {
      setSelfWallet(await fetchUserWallet(account.address));
    }
    await onChanged?.();
  }, [managed, account?.address, onChanged]);

  if (!account) return null;

  const amt = Number(amount);
  const balance = wallet?.balanceCC ?? 0;

  const handleDeposit = async () => {
    if (!(amt > 0)) {
      toast({ title: "Enter a CC amount to deposit", status: "info", duration: 3000, isClosable: true });
      return;
    }
    setBusy("deposit");
    const t = toast({
      title: "Depositing…",
      description: `Confirm the ${fmtCC(amt)} CC transfer in the ${WALLET_DISPLAY_NAME} popup — the in-app wallet credits automatically.`,
      status: "info",
      duration: null,
      isClosable: false,
    });
    try {
      const updated = await depositToInAppWallet({
        userParty: account.address,
        amountCC: amt,
        transferCC,
      });
      setAmount("");
      await reload();
      toast({
        title: "Deposit credited",
        description: `In-app balance: ${fmtCC(updated?.balanceCC ?? balance + amt)} CC.`,
        status: "success",
        duration: 6000,
        isClosable: true,
      });
    } catch (e) {
      toast({
        title: "Deposit failed",
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
    if (!wallet) return;
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
      const { settled } = await withdrawFromInAppWallet({
        userParty: account.address,
        amountCC: amt,
        walletContractId: wallet.contractId,
        signAndSubmitTransaction,
      });
      setAmount("");
      await reload();
      toast({
        title: settled ? "Withdrawal sent" : "Withdrawal queued",
        description: settled
          ? `${fmtCC(amt)} CC sent to your ${WALLET_DISPLAY_NAME} wallet.`
          : "Recorded on-ledger; the admin will settle the payout shortly.",
        status: settled ? "success" : "warning",
        duration: 7000,
        isClosable: true,
      });
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

  const compact = variant === "compact";

  const subLine = wallet
    ? `deposited ${fmtCC(wallet.depositedCC)} · withdrawn ${fmtCC(wallet.withdrawnCC)}`
    : "Deposit CC once, then every trade is a single signature.";

  if (compact) {
    // Both states keep a 1px border so toggling never changes the button's size.
    const togglePill = (active: boolean) =>
      `rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-foreground hover:bg-secondary disabled:opacity-50"
      }`;
    return (
      <div className="rounded-xl border border-border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> In-app wallet
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-sm font-bold text-foreground">{fmtCC(balance)} CC</span>
            <button
              onClick={() => setPanel(panel === "deposit" ? null : "deposit")}
              className={togglePill(panel === "deposit")}
            >
              Deposit
            </button>
            <button
              onClick={() => setPanel(panel === "withdraw" ? null : "withdraw")}
              disabled={!wallet || balance <= 0}
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
                disabled={busy !== null}
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
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-[10rem]">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> In-app wallet
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{fmtCC(balance)} CC</div>
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
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            {busy === "deposit" ? "Depositing…" : "Deposit"}
          </button>
          <button
            onClick={handleWithdraw}
            disabled={busy !== null || !wallet || balance <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition-opacity disabled:opacity-50"
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InAppWalletCard;
