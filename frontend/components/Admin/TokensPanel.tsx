/**
 * Operator console for the tokens themselves (truthoracle-backend docs/TOKENS.md §4.7): what
 * Cantor8's token-app reports, and per instrument what the treasury holds against what the
 * in-app wallets owe (`GET /admin/tokens/status`); minting to the treasury (the rewards float,
 * DevNet collateral), mint-and-credit for a user (the faucet — a mint to the treasury followed by
 * `UserWallet.Deposit` for the user's primary party, the same primitive a card on-ramp will call)
 * and burning from a party. Mints and burns create or destroy money, so each one carries a reason
 * for the audit row (the backend refuses one without) and is confirmed with the exact figure
 * first. Without a configured token-app the backend answers `503 token_app_unconfigured` and the
 * forms say so instead of offering a button that fails.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { authErrorMessage } from "@/auth/wallet";
import { ENTERPRISE_WALLET_PARTY_ID } from "@/config";
import {
  burnTokens,
  fetchTokenStatus,
  isApprovalOutcome,
  mintTokens,
  type TokenMintResult,
  type TokenOperationAnswer,
  type TokenStatus,
} from "@/lib/backendAdmin";
import { outcomeSentence } from "@/lib/rampAdmin";
import { formatMoney, instrumentKey, instrumentLabel, useInstruments, type InstrumentRef } from "@/lib/instruments";
import { ConfirmDialog, Pill } from "@/components/Account/accountUi";
import { btn, btnDanger, btnQuiet, Card, field, label, truncateId, useRun } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";

const AMOUNT_RE = /^\d+(\.\d{1,10})?$/;

/** A Money string the backend accepts: digits with up to ten decimals, above zero. */
function validAmount(s: string): boolean {
  const t = s.trim();
  return AMOUNT_RE.test(t) && Number(t) > 0;
}

/** Display-only comparison of two Money strings (holdings vs liabilities); never arithmetic the ledger acts on. */
function covers(holdings: string, liabilities: string): boolean {
  return Number(holdings) >= Number(liabilities);
}

type Destination = "treasury" | "party" | "user";

export default function TokensPanel() {
  const { ready } = useBackendOperator();
  const catalog = useInstruments().data;
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mint, setMint] = useState({ key: "", amount: "", destination: "treasury" as Destination, party: "", userId: "", reason: "" });
  const [burn, setBurn] = useState({ key: "", amount: "", party: "", reason: "" });
  const [confirm, setConfirm] = useState<"mint" | "burn" | null>(null);

  const reload = useCallback(async () => {
    setStatus(await fetchTokenStatus());
    setLoadError(null);
  }, []);
  const { busy, run } = useRun(reload);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    reload().catch((e: unknown) => {
      if (!cancelled) setLoadError(authErrorMessage(e));
    });
    return () => {
      cancelled = true;
    };
  }, [ready, reload]);

  // Every instrument the operator may mint or burn: the catalog's, plus any the status names that
  // the catalog does not (a token the treasury holds but has not registered yet).
  const options = useMemo(() => {
    const byKey = new Map<string, InstrumentRef>();
    for (const i of catalog ?? []) byKey.set(instrumentKey(i), i);
    for (const s of status?.instruments ?? []) if (!byKey.has(instrumentKey(s.instrument))) byKey.set(instrumentKey(s.instrument), s.instrument);
    return [...byKey.values()];
  }, [catalog, status]);
  const byKey = (key: string) => options.find((i) => instrumentKey(i) === key) ?? null;

  if (!ready) return null;

  const tokenApp = status?.tokenApp ?? null;
  const usable = tokenApp?.configured === true;
  const mintInstrument = byKey(mint.key);
  const burnInstrument = byKey(burn.key);
  const mintReady =
    usable &&
    mintInstrument !== null &&
    validAmount(mint.amount) &&
    mint.reason.trim() !== "" &&
    (mint.destination === "treasury" || (mint.destination === "party" ? mint.party.trim() !== "" : mint.userId.trim() !== ""));
  const burnReady = usable && burnInstrument !== null && validAmount(burn.amount) && burn.party.trim() !== "" && burn.reason.trim() !== "";

  // The backend answers with the party itself, never the word "treasury"; the treasury is the
  // Enterprise Wallet party this deployment is configured with.
  const partyLabel = (party: string) => (ENTERPRISE_WALLET_PARTY_ID !== "" && party === ENTERPRISE_WALLET_PARTY_ID ? "the treasury" : truncateId(party));
  const describeMint = (r: TokenMintResult) =>
    `Minted ${formatMoney(r.amount, r.instrument)} to ${partyLabel(r.party)}${
      r.credit ? ` and credited the user's in-app wallet (${r.credit.txRef}, ${r.credit.status})` : ""
    } · command ${r.commandId} (${r.status})`;
  const describeBurn = (r: TokenMintResult) =>
    `Burned ${formatMoney(r.amount, r.instrument)} from ${partyLabel(r.party)} · command ${r.commandId} (${r.status})`;
  // On mainnet a non-ramp instrument's mint or burn is a four-eyes request: say so instead of a figure.
  const describeAnswer = (what: string, r: TokenOperationAnswer, describe: (x: TokenMintResult) => string) =>
    isApprovalOutcome(r) ? (r.result ? describe(r.result) : outcomeSentence(what, r)) : describe(r);

  const submitMint = async () => {
    if (!mintInstrument) return;
    const ok = await run(
      "Mint",
      () =>
        mintTokens({
          instrument: { admin: mintInstrument.admin, id: mintInstrument.id },
          amount: mint.amount.trim(),
          ...(mint.destination === "party" ? { to: mint.party.trim() } : {}),
          ...(mint.destination === "user" ? { creditUserId: mint.userId.trim() } : {}),
          reason: mint.reason.trim(),
        }),
      (r) => describeAnswer("Mint", r, describeMint),
    );
    setConfirm(null);
    if (ok) setMint({ ...mint, amount: "", party: "", userId: "", reason: "" });
  };

  const submitBurn = async () => {
    if (!burnInstrument) return;
    const ok = await run(
      "Burn",
      () =>
        burnTokens({
          instrument: { admin: burnInstrument.admin, id: burnInstrument.id },
          amount: burn.amount.trim(),
          party: burn.party.trim(),
          reason: burn.reason.trim(),
        }),
      (r) => describeAnswer("Burn", r, describeBurn),
    );
    setConfirm(null);
    if (ok) setBurn({ ...burn, amount: "", party: "", reason: "" });
  };

  const instrumentSelect = (value: string, onChange: (key: string) => void) => (
    <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select an instrument…</option>
      {options.map((i) => (
        <option key={instrumentKey(i)} value={instrumentKey(i)}>
          {instrumentLabel(i)}
        </option>
      ))}
    </select>
  );

  return (
    <Card
      title="Tokens (token-app)"
      aside={
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch((e: unknown) => setLoadError(authErrorMessage(e)))}>
          Refresh
        </button>
      }
    >
      {loadError && <p className="mb-3 text-xs text-red-700">Could not load the token status: {loadError}</p>}
      {tokenApp && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <Pill tone={tokenApp.configured ? (tokenApp.reachable ? "ok" : "warn") : "neutral"}>
            token-app {tokenApp.configured ? (tokenApp.reachable ? "reachable" : "configured, not reachable") : "not configured"}
          </Pill>
          <span>app {tokenApp.appName}</span>
          {tokenApp.url && <span className="font-mono">{tokenApp.url}</span>}
        </div>
      )}
      {status && status.instruments.length > 0 && (
        <table className="mb-4 w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1.5 pr-3 font-bold">Instrument</th>
              <th className="py-1.5 pr-3 text-right font-bold">Treasury holds</th>
              <th className="py-1.5 pr-3 text-right font-bold">In-app wallets owe</th>
              <th className="py-1.5 font-bold">Coverage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {status.instruments.map((row) => (
              <tr key={instrumentKey(row.instrument)}>
                <td className="py-1.5 pr-3 font-semibold text-slate-950">{instrumentLabel(row.instrument)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(row.treasuryHoldings, row.instrument)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(row.liabilities, row.instrument)}</td>
                <td className="py-1.5">
                  <Pill tone={covers(row.treasuryHoldings, row.liabilities) ? "ok" : "bad"}>{covers(row.treasuryHoldings, row.liabilities) ? "covered" : "short"}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mb-4 text-[11px] text-slate-400">
        Holdings are the treasury&apos;s token-standard holdings in the ledger index; liabilities are the sum of every in-app
        wallet balance in that instrument. A grant or a payout is only sent while the holdings cover it.
      </p>
      {status && !usable && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Minting and burning need Cantor8&apos;s token-app: set <code className="font-mono">TOKEN_APP_URL</code> (and its Keycloak client) on the backend.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 px-3 py-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">Mint</p>
          <div className="grid gap-2">
            <div>
              <label className={label}>Instrument</label>
              {instrumentSelect(mint.key, (key) => setMint({ ...mint, key }))}
            </div>
            <div>
              <label className={label}>Amount{mintInstrument ? ` (${mintInstrument.symbol})` : ""}</label>
              <input className={field} inputMode="decimal" value={mint.amount} onChange={(e) => setMint({ ...mint, amount: e.target.value })} placeholder="1000" />
            </div>
            <div>
              <label className={label}>Destination</label>
              <select className={field} value={mint.destination} onChange={(e) => setMint({ ...mint, destination: e.target.value as Destination })}>
                <option value="treasury">the treasury (float / DevNet collateral)</option>
                <option value="user">the treasury, then credit a user&apos;s in-app wallet (faucet / on-ramp)</option>
                <option value="party">a party directly</option>
              </select>
            </div>
            {mint.destination === "user" && (
              <div>
                <label className={label}>User account id</label>
                <input className={field} value={mint.userId} onChange={(e) => setMint({ ...mint, userId: e.target.value })} placeholder="uuid of the account (Admin → users)" />
              </div>
            )}
            {mint.destination === "party" && (
              <div>
                <label className={label}>Recipient party</label>
                <input className={field} value={mint.party} onChange={(e) => setMint({ ...mint, party: e.target.value })} placeholder="hint::1220…" />
              </div>
            )}
            <div>
              <label className={label}>Reason (kept on the audit row)</label>
              <input className={field} value={mint.reason} onChange={(e) => setMint({ ...mint, reason: e.target.value })} placeholder="DevNet faucet for a tester / TRO float top-up / ticket id" />
            </div>
          </div>
          <button type="button" className={`${btn} mt-3`} disabled={busy !== null || !mintReady} title={usable ? undefined : "token-app is not configured"} onClick={() => setConfirm("mint")}>
            Mint…
          </button>
        </div>

        <div className="rounded-md border border-slate-200 px-3 py-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">Burn</p>
          <div className="grid gap-2">
            <div>
              <label className={label}>Instrument</label>
              {instrumentSelect(burn.key, (key) => setBurn({ ...burn, key }))}
            </div>
            <div>
              <label className={label}>Amount{burnInstrument ? ` (${burnInstrument.symbol})` : ""}</label>
              <input className={field} inputMode="decimal" value={burn.amount} onChange={(e) => setBurn({ ...burn, amount: e.target.value })} placeholder="1000" />
            </div>
            <div>
              <label className={label}>Party whose holdings are burned</label>
              <input className={field} value={burn.party} onChange={(e) => setBurn({ ...burn, party: e.target.value })} placeholder="hint::1220… (the treasury, usually)" />
            </div>
            <div>
              <label className={label}>Reason (kept on the audit row)</label>
              <input className={field} value={burn.reason} onChange={(e) => setBurn({ ...burn, reason: e.target.value })} placeholder="retiring test tokens / correction / ticket id" />
            </div>
          </div>
          <button type="button" className={`${btnDanger} mt-3`} disabled={busy !== null || !burnReady} title={usable ? undefined : "token-app is not configured"} onClick={() => setConfirm("burn")}>
            Burn…
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm === "mint" ? "Mint tokens?" : "Burn tokens?"}
        description={
          confirm === "mint" && mintInstrument
            ? `Mint ${formatMoney(mint.amount.trim(), mintInstrument)} ${
                mint.destination === "treasury"
                  ? "to the treasury."
                  : mint.destination === "user"
                    ? `to the treasury and credit it to the in-app wallet of account ${mint.userId.trim()}.`
                    : `to ${mint.party.trim()}.`
              } The token-app creates this money; the command is audited ("${mint.reason.trim()}").`
            : confirm === "burn" && burnInstrument
              ? `Burn ${formatMoney(burn.amount.trim(), burnInstrument)} from ${burn.party.trim()}. The tokens are destroyed; the command is audited ("${burn.reason.trim()}").`
              : ""
        }
        confirmLabel={confirm === "mint" ? "Mint" : "Burn"}
        destructive={confirm === "burn"}
        busy={busy === "Mint" || busy === "Burn"}
        onConfirm={() => void (confirm === "mint" ? submitMint() : submitBurn())}
      />
    </Card>
  );
}
