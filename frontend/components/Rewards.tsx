/**
 * Rewards page. Rewards are TRO — the platform's CIP-56 rewards token — computed off-ledger by
 * the accounts backend from its ledger index and credited to the account's in-app TRO wallet
 * with `UserWallet.Grant` (truthoracle-backend docs/TOKENS.md §2.8, §4.6). There is nothing to
 * "claim": the page reads `GET /me/rewards` — the TRO wallet, the credited / queued totals and
 * every grant with its rule kind and status — explains the rule kinds in plain words, and offers
 * the ordinary withdrawal of that wallet ("Withdraw TRO to your Cantor8 wallet") through the
 * same card the portfolio uses, pinned to the rewards instrument and withdraw-only.
 *
 * The page needs a signed-in account because grants belong to one: anonymous visitors get the
 * rules and a Sign-in button, a deployment without a backend a sentence, an unreachable backend
 * a Retry, and a backend with no rewards instrument configured (404) the honest "not set up yet".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Center, Spinner } from "@chakra-ui/react";
import { ArrowUpFromLine, Gift, ListChecks, LogIn, RefreshCw } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { WALLET_DISPLAY_NAME } from "@/config";
import { BACKEND_UNREACHABLE_SENTENCE } from "@/lib/backendErrors";
import { formatMoney, instrumentLabel, rewardsInstrument, useInstruments, type InstrumentRef } from "@/lib/instruments";
import { ledgerWalletToRecord } from "@/lib/inAppWallet";
import {
  REWARD_KINDS,
  fetchMyRewards,
  isRewardsUnconfigured,
  rewardKindDescription,
  rewardKindLabel,
  rewardStatusView,
  rewardsErrorMessage,
  type RewardsOverview,
} from "@/lib/rewards";
import { formatDateTimeUTC } from "@/lib/time";
import { Pill, primaryBtn, secondaryBtn } from "@/components/Account/accountUi";
import InAppWalletCard from "@/components/InAppWalletCard";

const card = "rounded-lg border border-slate-200 bg-white p-5 shadow-xl shadow-slate-200/60";

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-extrabold tabular-nums text-slate-950">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

const Rewards = () => {
  const auth = useAuth();
  // The catalog's rewards instrument names the token before the account's own view loads (and
  // for visitors who are not signed in); the overview's instrument wins once it is there.
  const catalogToken = rewardsInstrument(useInstruments().data);
  const [overview, setOverview] = useState<RewardsOverview | null>(null);
  const [error, setError] = useState<{ message: string; unconfigured: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    if (auth.status !== "authenticated") {
      setOverview(null);
      setError(null);
      return;
    }
    // An older read landing after a newer one must not overwrite it (a withdrawal just changed the wallet).
    const mySeq = ++seqRef.current;
    setLoading(true);
    try {
      const next = await fetchMyRewards();
      if (mySeq !== seqRef.current) return;
      setOverview(next);
      setError(null);
    } catch (e) {
      if (mySeq !== seqRef.current) return;
      setError({ message: rewardsErrorMessage(e), unconfigured: isRewardsUnconfigured(e) });
    } finally {
      if (mySeq === seqRef.current) setLoading(false);
    }
  }, [auth.status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const token: InstrumentRef | null = overview?.instrument ?? catalogToken;
  const sym = token?.symbol ?? "rewards";
  const tokenName = token ? instrumentLabel(token) : "the platform's rewards token";

  const rules = (
    <section className={card}>
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-primary" />
        <h2 className="text-base font-extrabold text-slate-950">How rewards reach you</h2>
      </div>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
        {REWARD_KINDS.filter((k) => k !== "manual").map((kind) => (
          <li key={kind}>
            <span className="font-semibold text-slate-900">{rewardKindLabel(kind)}</span> — {rewardKindDescription(kind, sym)}
          </li>
        ))}
        <li>
          <span className="font-semibold text-slate-900">{rewardKindLabel("manual")}</span> — {rewardKindDescription("manual", sym)}
        </li>
      </ul>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Each grant lands in your in-app {sym} wallet within a minute of the trade or deposit that earned it — nothing to
        claim, nothing to sign — and you can withdraw it to your {WALLET_DISPLAY_NAME} wallet like any other in-app
        balance.
      </p>
    </section>
  );

  let main: React.ReactNode;
  if (auth.status === "loading") {
    main = (
      <section className={card}>
        <Center py={6}>
          <Spinner />
        </Center>
      </section>
    );
  } else if (auth.status === "unavailable") {
    main = (
      <section className={card}>
        <h2 className="text-base font-extrabold text-slate-950">Rewards need an account</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          This deployment runs without an accounts backend, so there are no accounts, no in-app balances and no rewards.
        </p>
      </section>
    );
  } else if (auth.status === "unreachable") {
    main = (
      <section className={card}>
        <h2 className="text-base font-extrabold text-slate-950">The accounts service is not reachable</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{BACKEND_UNREACHABLE_SENTENCE} Your rewards are safe; this page retries on its own.</p>
        <button type="button" onClick={() => void auth.refresh()} className={`${secondaryBtn} mt-4`}>
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </section>
    );
  } else if (auth.status === "anonymous") {
    main = (
      <section className={card}>
        <h2 className="text-base font-extrabold text-slate-950">Sign in to see your rewards</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Grants belong to your account: sign in to see your {sym} balance, what each trade earned and to withdraw it to
          your {WALLET_DISPLAY_NAME} wallet.
        </p>
        <button type="button" onClick={() => auth.openLogin()} className={`${primaryBtn} mt-4`}>
          <LogIn className="h-4 w-4" /> Sign in
        </button>
      </section>
    );
  } else if (error?.unconfigured) {
    main = (
      <section className={card}>
        <h2 className="text-base font-extrabold text-slate-950">Rewards are not set up yet</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{error.message}</p>
      </section>
    );
  } else if (error) {
    main = (
      <section className={card}>
        <h2 className="text-base font-extrabold text-slate-950">Could not load your rewards</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{error.message}</p>
        <button type="button" onClick={() => void reload()} disabled={loading} className={`${secondaryBtn} mt-4`}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Loading…" : "Try again"}
        </button>
      </section>
    );
  } else if (!overview) {
    main = (
      <section className={card}>
        <Center py={6}>
          <Spinner />
        </Center>
      </section>
    );
  } else {
    const inst = overview.instrument;
    const credited = overview.grants.filter((g) => g.status === "credited").length;
    main = (
      <>
        <section className={card}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label={`${inst.symbol} balance`} value={formatMoney(overview.wallet?.balance ?? 0, inst)} hint="in your in-app wallet" />
            <Tile label="Credited so far" value={formatMoney(overview.totals.credited, inst)} hint={`${credited} grant${credited === 1 ? "" : "s"}`} />
            <Tile label="Queued" value={formatMoney(overview.totals.queued, inst)} hint="waiting for the treasury's next pass" />
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <ArrowUpFromLine className="h-4 w-4 text-primary" />
              <h2 className="text-base font-extrabold text-slate-950">
                Withdraw {inst.symbol} to your {WALLET_DISPLAY_NAME} wallet
              </h2>
            </div>
            <p className="mb-3 text-xs leading-5 text-slate-500">
              The same withdrawal as any in-app balance: you sign once, the treasury sends the {inst.symbol} to your{" "}
              {WALLET_DISPLAY_NAME} wallet (identity verification applies, like every withdrawal). Amounts are sent in
              steps of the token's smallest unit.
            </p>
            <InAppWalletCard
              instrument={inst}
              wallet={overview.wallet ? ledgerWalletToRecord(overview.wallet) : null}
              walletLoaded={!loading}
              actions={["withdraw"]}
              title={`${inst.symbol} in-app balance`}
              variant="compact"
              onChanged={reload}
            />
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-extrabold text-slate-950">Your grants</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Every reward the rules awarded you, newest first, with what it was for and where it stands.</p>
            </div>
            <button type="button" onClick={() => void reload()} disabled={loading} className={secondaryBtn} title="Re-read your rewards">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {overview.grants.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-500">No rewards yet. Trade, redeem a winning position or make your first deposit to earn {inst.symbol}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-bold">When (UTC)</th>
                    <th className="px-5 py-3 font-bold">Reward</th>
                    <th className="px-5 py-3 text-right font-bold">Amount</th>
                    <th className="px-5 py-3 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {overview.grants.map((g) => {
                    const view = rewardStatusView(g.status);
                    return (
                      <tr key={g.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-5 py-3 text-slate-500">{formatDateTimeUTC(g.createdAt)}</td>
                        <td className="px-5 py-3">
                          <div className="font-semibold text-slate-950">{rewardKindLabel(g.kind)}</div>
                          {g.reason && g.reason !== g.kind && <div className="text-[11px] text-slate-500">{g.reason}</div>}
                        </td>
                        <td className="px-5 py-3 text-right font-bold tabular-nums text-primary">{formatMoney(g.amount, g.instrument)}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <Pill tone={view.tone} title={view.detail}>
                              {view.label}
                            </Pill>
                            {g.status === "credited" && g.creditedAt && <span className="text-[11px] text-slate-500">{formatDateTimeUTC(g.creditedAt)}</span>}
                            {g.status === "failed" && g.error && (
                              <span className="text-[11px] text-slate-500" title={g.error}>
                                Support has been notified
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>
    );
  }

  return (
    <div className="page-container rewards-page py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-primary">
            <Gift className="h-3.5 w-3.5" />
            Rewards center
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">Your Rewards</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Trading rebates, winning-redeem bonuses and first-deposit bonuses are paid in {tokenName} and credited straight
            to your in-app balance.
          </p>
        </div>
        <div className="space-y-4">
          {main}
          {rules}
        </div>
      </div>
    </div>
  );
};

export default Rewards;
