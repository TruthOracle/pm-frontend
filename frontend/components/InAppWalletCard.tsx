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
import { fetchUserWallet, type UserWalletRecord } from "@/utils/activeContracts";
import { depositToInAppWallet, withdrawFromInAppWallet } from "@/lib/inAppWallet";
import { fmtCC } from "./market/marketHelpers";

export function InAppWalletCard({
  wallet: walletProp,
  onChanged,
}: {
  /** Pass the wallet record to control it from a parent; omit to self-fetch. */
  wallet?: UserWalletRecord | null;
  onChanged?: () => void | Promise<void>;
}) {
  const { account, transferCC, signAndSubmitTransaction } = useCantonWallet();
  const toast = useToast();
  const [selfWallet, setSelfWallet] = useState<UserWalletRecord | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState<"deposit" | "withdraw" | null>(null);

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
      description: `Confirm the ${fmtCC(amt)} CC transfer in the wallet popup — the in-app balance credits automatically.`,
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
      description: "Confirm the withdrawal in the wallet popup — CC is then sent to your wallet.",
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
          ? `${fmtCC(amt)} CC sent to your wallet.`
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

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-[10rem]">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> In-app balance
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{fmtCC(balance)} CC</div>
          {wallet && (
            <div className="text-[11px] text-muted-foreground">
              deposited {fmtCC(wallet.depositedCC)} · withdrawn {fmtCC(wallet.withdrawnCC)}
            </div>
          )}
          {!wallet && (
            <div className="text-[11px] text-muted-foreground">
              Deposit CC once, then every trade is a single signature.
            </div>
          )}
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
