/**
 * Operator console for the instrument registry (truthoracle-backend docs/TOKENS.md §4.1, §4.4):
 * every CIP-56 token the exchange deals in — the collateral instruments markets are denominated
 * in and the rewards token — with its presentation (symbol, name, decimals), whether it is
 * enabled and the default collateral for new markets, the registry and transfer wiring the
 * treasury uses for it, and the id the Cantor8 wallet SDK knows it by. The `(admin, id)` pair IS
 * the token on the ledger and never changes; the indexer adds any instrument it meets on a market
 * as disabled, so a ledger-first market shows up here to be described and enabled.
 *
 * The setup action is the one that touches the ledger: a treasury-signed AutoAccept (inbound
 * transfers settle without a two-step accept) and/or MintDelegation (token-app mints may land on
 * the treasury) through the token's registry — once per token, confirmed before it runs. Every
 * change here is audited by the backend and invalidates the catalog the whole app labels money with.
 */
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { authErrorMessage } from "@/auth/wallet";
import { WALLET_DISPLAY_NAME } from "@/config";
import {
  createInstrument,
  fetchAdminInstruments,
  setupInstrument,
  updateInstrument,
  type InstrumentInput,
  type InstrumentPatch,
} from "@/lib/backendAdmin";
import {
  INSTRUMENTS_QUERY_KEY,
  REGISTRY_AUTHS,
  TREASURY_TRANSFER_MODES,
  instrumentKey,
  walletInstrumentId,
  type ApiAdminInstrument,
  type RegistryAuth,
  type TreasuryTransferMode,
} from "@/lib/instruments";
import { ConfirmDialog, Pill } from "@/components/Account/accountUi";
import { btn, btnQuiet, Card, field, label, truncateId, useRun, type Run } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";

type SetupDraft = { row: ApiAdminInstrument; autoAccept: boolean; mintDelegation: boolean; reason: string };

const DECIMALS_HINT = "0–10: the token's own scale, used to display amounts and to quantise withdrawals (the ledger keeps 10).";

export default function InstrumentsPanel() {
  const { ready } = useBackendOperator();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ApiAdminInstrument[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupDraft | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await fetchAdminInstruments());
    setLoadError(null);
    // The public catalog every component labels money with is cached for the session; a change here must reach it.
    void queryClient.invalidateQueries({ queryKey: INSTRUMENTS_QUERY_KEY });
  }, [queryClient]);
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

  if (!ready) return null;

  const runSetup = async () => {
    if (!setup) return;
    const { row, autoAccept, mintDelegation, reason } = setup;
    setSetupBusy(true);
    setSetupError(null);
    try {
      const result = await setupInstrument(row, { autoAccept, mintDelegation, reason: reason.trim() || undefined });
      // One entry per action the backend ran: the choice it exercised on the token's factory and the command's status.
      const done = result.actions.map((a) => `${a.choice} (${a.status})`).join(" + ");
      await reload();
      toast({
        title: `Setup submitted for ${row.symbol}`,
        description: done ? `${done} exercised on the token's factory for the treasury.` : "The registry ran no action.",
        status: "success",
        duration: 6000,
        isClosable: true,
      });
      setSetup(null);
    } catch (e) {
      setSetupError(authErrorMessage(e));
    } finally {
      setSetupBusy(false);
    }
  };

  return (
    <Card
      title={`Instruments (${rows.length})`}
      aside={
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch((e: unknown) => setLoadError(authErrorMessage(e)))}>
          Refresh
        </button>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Every token the exchange deals in. Markets are denominated in an enabled collateral (the default is what new markets
        start with); rewards are paid in the rewards instrument. The admin party and token id are the token itself and cannot
        change; everything else can.
      </p>
      {loadError && <p className="mb-3 text-xs text-red-700">Could not load the registry: {loadError}</p>}
      <ul className="mb-4 space-y-1 text-sm">
        {rows.map((r) =>
          editing === instrumentKey(r) ? (
            <EditInstrumentRow key={instrumentKey(r)} row={r} busy={busy} run={run} onClose={() => setEditing(null)} />
          ) : (
            <li key={instrumentKey(r)} className="rounded-md bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">{r.symbol}</span>
                  <span className="font-medium text-slate-700">{r.name}</span>
                  <Pill tone="neutral">{r.kind}</Pill>
                  <Pill tone={r.enabled ? "ok" : "warn"}>{r.enabled ? "Enabled" : "Disabled"}</Pill>
                  {r.isDefaultCollateral && <Pill tone="info">Default collateral</Pill>}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={btnQuiet}
                    disabled={busy !== null}
                    onClick={() => void run("Update instrument", () => updateInstrument(r, { enabled: !r.enabled }), `${r.symbol} ${r.enabled ? "disabled" : "enabled"}`)}
                  >
                    {r.enabled ? "Disable" : "Enable"}
                  </button>
                  {r.kind === "collateral" && !r.isDefaultCollateral && (
                    <button
                      type="button"
                      className={btnQuiet}
                      disabled={busy !== null || !r.enabled}
                      title={r.enabled ? "New markets default to this collateral" : "Enable the instrument first"}
                      onClick={() => void run("Update instrument", () => updateInstrument(r, { isDefaultCollateral: true }), `${r.symbol} is now the default collateral`)}
                    >
                      Make default
                    </button>
                  )}
                  <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => setEditing(instrumentKey(r))}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={btnQuiet}
                    disabled={busy !== null}
                    title="Treasury-signed AutoAccept / MintDelegation through the token's registry"
                    onClick={() => {
                      setSetupError(null);
                      setSetup({ row: r, autoAccept: true, mintDelegation: true, reason: "" });
                    }}
                  >
                    Setup…
                  </button>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                <span className="font-mono" title={`${r.id} · ${r.admin}`}>
                  {r.id} · {truncateId(r.admin, 14, 8)}
                </span>
                <span>{r.decimals} decimals</span>
                <span>transfer: {r.transferMode ?? "default"}</span>
                <span>
                  registry: {r.registryAuth}
                  {r.registryUrl ? ` · ${r.registryUrl}` : " · no URL"}
                </span>
                {walletInstrumentId(r) !== r.id && <span>{WALLET_DISPLAY_NAME} wallet id: {r.walletInstrumentId}</span>}
              </div>
            </li>
          ),
        )}
        {rows.length === 0 && !loadError && <li className="text-xs text-slate-400">No instrument registered yet — the backend upserts its two env-configured ones at boot.</li>}
      </ul>

      <AddInstrumentForm busy={busy} run={run} />

      <ConfirmDialog
        open={setup !== null}
        onOpenChange={(open) => {
          if (!open) setSetup(null);
        }}
        title={setup ? `Run the registry setup for ${setup.row.symbol}?` : ""}
        description={
          setup ? (
            <span className="block space-y-3 text-left">
              <span className="block">
                Each action is a treasury-signed submission through the token&apos;s registry, needed once per token. Not applicable to
                Canton Coin (the Enterprise Wallet account pre-approves Amulet transfers).
              </span>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" checked={setup.autoAccept} onChange={(e) => setSetup({ ...setup, autoAccept: e.target.checked })} />
                <span>
                  <span className="font-semibold">AutoAccept</span> ({setup.row.setupChoices.autoAccept ?? "CreateAutoAccept"}) — inbound transfers to the
                  treasury settle without a two-step accept, so deposits credit on their own.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" checked={setup.mintDelegation} onChange={(e) => setSetup({ ...setup, mintDelegation: e.target.checked })} />
                <span>
                  <span className="font-semibold">MintDelegation</span> ({setup.row.setupChoices.mintDelegation ?? "CreateMintDelegation"}) — the token-app may mint
                  to the treasury (faucet, rewards float).
                </span>
              </label>
              <span className="block">
                <span className={label}>Audit note (optional)</span>
                <input className={field} value={setup.reason} onChange={(e) => setSetup({ ...setup, reason: e.target.value })} placeholder="why now / ticket id" />
              </span>
            </span>
          ) : (
            ""
          )
        }
        confirmLabel="Run setup"
        busy={setupBusy}
        error={setupError}
        onConfirm={() => void runSetup()}
      />
    </Card>
  );
}

/** "" = the process default (null on the wire). */
type TransferModeChoice = TreasuryTransferMode | "";

function EditInstrumentRow({ row, busy, run, onClose }: { row: ApiAdminInstrument; busy: string | null; run: Run; onClose: () => void }) {
  const [form, setForm] = useState({
    symbol: row.symbol,
    name: row.name,
    decimals: String(row.decimals),
    transferMode: (row.transferMode ?? "") as TransferModeChoice,
    registryUrl: row.registryUrl ?? "",
    registryAuth: row.registryAuth,
    walletInstrumentId: row.walletInstrumentId,
    reason: "",
  });
  const decimals = Number(form.decimals);
  const decimalsOk = Number.isInteger(decimals) && decimals >= 0 && decimals <= 10;

  /** Only what changed travels: the backend audits each field it receives. */
  const patch = (): InstrumentPatch => {
    const p: InstrumentPatch = {};
    if (form.symbol.trim() !== row.symbol) p.symbol = form.symbol.trim();
    if (form.name.trim() !== row.name) p.name = form.name.trim();
    if (decimals !== row.decimals) p.decimals = decimals;
    const mode: TreasuryTransferMode | null = form.transferMode === "" ? null : form.transferMode;
    if (mode !== row.transferMode) p.transferMode = mode;
    const url = form.registryUrl.trim() || null;
    if (url !== (row.registryUrl ?? null)) p.registryUrl = url;
    if (form.registryAuth !== row.registryAuth) p.registryAuth = form.registryAuth;
    if (form.walletInstrumentId.trim() !== row.walletInstrumentId) p.walletInstrumentId = form.walletInstrumentId.trim() || row.id;
    if (form.reason.trim()) p.reason = form.reason.trim();
    return p;
  };
  const changes = patch();
  const dirty = Object.keys(changes).some((k) => k !== "reason");

  const save = async () => {
    const ok = await run("Update instrument", () => updateInstrument(row, changes), `${row.symbol} updated`);
    if (ok) onClose();
  };

  return (
    <li className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="mb-2 text-xs">
        <span className="font-mono text-slate-500" title={row.admin}>
          {row.id} · {truncateId(row.admin, 14, 8)}
        </span>{" "}
        <span className="font-medium">{row.kind}</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className={label}>Symbol</label>
          <input className={field} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} maxLength={16} />
        </div>
        <div>
          <label className={label}>Name</label>
          <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
        </div>
        <div>
          <label className={label} title={DECIMALS_HINT}>
            Decimals
          </label>
          <input className={field} type="number" min={0} max={10} step={1} value={form.decimals} onChange={(e) => setForm({ ...form, decimals: e.target.value })} />
        </div>
        <div>
          <label className={label}>Treasury transfer mode</label>
          <select className={field} value={form.transferMode} onChange={(e) => setForm({ ...form, transferMode: e.target.value as TransferModeChoice })}>
            <option value="">process default</option>
            {TREASURY_TRANSFER_MODES.map((m) => (
              <option key={m} value={m}>
                {m === "wallet" ? "wallet — Enterprise Wallet /api/v1/transfer" : "registry — TransferFactory_Transfer via /external/submit"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Registry auth</label>
          <select className={field} value={form.registryAuth} onChange={(e) => setForm({ ...form, registryAuth: e.target.value as RegistryAuth })}>
            {REGISTRY_AUTHS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>{WALLET_DISPLAY_NAME} wallet instrument id</label>
          <input className={field} value={form.walletInstrumentId} onChange={(e) => setForm({ ...form, walletInstrumentId: e.target.value })} placeholder={row.id} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Registry URL (blank = none)</label>
          <input className={field} value={form.registryUrl} onChange={(e) => setForm({ ...form, registryUrl: e.target.value })} placeholder="https://token-registry…/api/c8" />
        </div>
        <div>
          <label className={label}>Audit note (optional)</label>
          <input className={field} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="why this changed / ticket id" />
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" className={btn} disabled={busy !== null || !dirty || !decimalsOk} title={decimalsOk ? undefined : DECIMALS_HINT} onClick={() => void save()}>
          {busy === "Update instrument" ? "Saving…" : "Save"}
        </button>
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={onClose}>
          Cancel
        </button>
      </div>
    </li>
  );
}

const initialAdd = {
  admin: "",
  id: "",
  symbol: "",
  name: "",
  decimals: "6",
  kind: "collateral" as InstrumentInput["kind"],
  enabled: true,
  isDefaultCollateral: false,
  registryUrl: "",
  registryAuth: "keycloak" as RegistryAuth,
  transferMode: "" as TransferModeChoice,
  walletInstrumentId: "",
  reason: "",
};

function AddInstrumentForm({ busy, run }: { busy: string | null; run: Run }) {
  const [form, setForm] = useState(initialAdd);
  const decimals = Number(form.decimals);
  const decimalsOk = Number.isInteger(decimals) && decimals >= 0 && decimals <= 10;
  const canSubmit = form.admin.trim() !== "" && form.id.trim() !== "" && decimalsOk;

  const submit = async () => {
    const body: InstrumentInput = {
      admin: form.admin.trim(),
      id: form.id.trim(),
      decimals,
      kind: form.kind,
      enabled: form.enabled,
      isDefaultCollateral: form.kind === "collateral" && form.isDefaultCollateral,
      registryAuth: form.registryAuth,
      ...(form.symbol.trim() ? { symbol: form.symbol.trim() } : {}),
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
      ...(form.registryUrl.trim() ? { registryUrl: form.registryUrl.trim() } : {}),
      ...(form.transferMode ? { transferMode: form.transferMode } : {}),
      ...(form.walletInstrumentId.trim() ? { walletInstrumentId: form.walletInstrumentId.trim() } : {}),
      ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
    };
    const ok = await run("Register instrument", () => createInstrument(body), `${form.symbol.trim() || form.id.trim()} registered`);
    if (ok) setForm(initialAdd);
  };

  return (
    <div className="rounded-md border border-dashed border-slate-300 px-3 py-3">
      <p className="mb-2 text-xs font-semibold text-slate-700">Register an instrument</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={label}>Admin party (the registry: cBYN&apos;s transfer agent, Canton Coin&apos;s DSO)</label>
          <input className={field} value={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.value })} placeholder="hint::1220…" />
        </div>
        <div>
          <label className={label}>Token id</label>
          <input className={field} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="cBYN" />
        </div>
        <div>
          <label className={label}>Symbol</label>
          <input className={field} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="defaults to the token id" maxLength={16} />
        </div>
        <div>
          <label className={label}>Name</label>
          <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Canton Belarusian Ruble" maxLength={120} />
        </div>
        <div>
          <label className={label} title={DECIMALS_HINT}>
            Decimals
          </label>
          <input className={field} type="number" min={0} max={10} step={1} value={form.decimals} onChange={(e) => setForm({ ...form, decimals: e.target.value })} />
        </div>
        <div>
          <label className={label}>Kind</label>
          <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as InstrumentInput["kind"] })}>
            <option value="collateral">collateral — markets are denominated in it</option>
            <option value="rewards">rewards — grants are paid in it</option>
          </select>
        </div>
        <div>
          <label className={label}>Registry auth</label>
          <select className={field} value={form.registryAuth} onChange={(e) => setForm({ ...form, registryAuth: e.target.value as RegistryAuth })}>
            {REGISTRY_AUTHS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Treasury transfer mode</label>
          <select className={field} value={form.transferMode} onChange={(e) => setForm({ ...form, transferMode: e.target.value as TransferModeChoice })}>
            <option value="">process default</option>
            {TREASURY_TRANSFER_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Registry URL (optional)</label>
          <input className={field} value={form.registryUrl} onChange={(e) => setForm({ ...form, registryUrl: e.target.value })} placeholder="https://token-registry.dev.digik.cantor8.tech/api/c8" />
        </div>
        <div>
          <label className={label}>{WALLET_DISPLAY_NAME} wallet instrument id (blank = token id)</label>
          <input className={field} value={form.walletInstrumentId} onChange={(e) => setForm({ ...form, walletInstrumentId: e.target.value })} placeholder="Amulet" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Audit note (optional)</label>
          <input className={field} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="why / ticket id" />
        </div>
        <div className="flex flex-wrap items-center gap-4 self-end pb-2 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
          </label>
          {form.kind === "collateral" && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isDefaultCollateral} onChange={(e) => setForm({ ...form, isDefaultCollateral: e.target.checked })} /> Default collateral
            </label>
          )}
        </div>
      </div>
      <button type="button" className={`${btn} mt-3`} disabled={busy !== null || !canSubmit} onClick={() => void submit()}>
        {busy === "Register instrument" ? "Registering…" : "Register instrument"}
      </button>
    </div>
  );
}
