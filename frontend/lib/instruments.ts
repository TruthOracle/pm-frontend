/**
 * Instruments — the CIP-56 tokens the exchange deals in (truthoracle-backend docs/TOKENS.md §4.1).
 * Every market is denominated in one collateral instrument (cBYN once Cantor8 delivers it; Canton
 * Coin on DevNet until then) and rewards are paid in TRO. The backend is the source of truth for
 * what exists, how many decimals each one has and which one new markets default to; the browser
 * reads that list once per session and labels every money value with the instrument it sits next
 * to on the wire (`market.collateral`, `wallet.instrument`, `payout.instrument`). Nothing in the
 * app hard-codes a symbol any more — the only brand that stays fixed is the external wallet's
 * (`WALLET_DISPLAY_NAME`), which is not a currency.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { backendFetch, probeBackend } from "@/lib/backend";

/** The on-ledger identity of an instrument (`Truthoracle.InstrumentId`): the registry party and the token id. */
export interface InstrumentId {
  admin: string;
  id: string;
}

/**
 * What the wire puts next to a money value (API.md `InstrumentRef`): the identity plus what the UI
 * needs to render the figure — the symbol it is labelled with and the decimals it is quantised to.
 * Fixed-point stays 10 dp on the ledger and on the wire; `decimals` is the instrument's own scale,
 * used for display and for quantising a withdrawal.
 */
export interface InstrumentRef extends InstrumentId {
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * One row of `GET /exchange/instruments`: the catalog entry with its role, whether the operator has
 * enabled it, whether new markets default to it, and the id the Cantor8 wallet SDK's `send()` expects
 * for it (the wallet lists tokens under its own ids, e.g. `Amulet` for Canton Coin).
 */
export interface ApiInstrument extends InstrumentRef {
  kind: "collateral" | "rewards";
  enabled: boolean;
  isDefaultCollateral: boolean;
  walletInstrumentId: string;
}

/** How the backend authenticates to an instrument's CIP-56 registry (docs/TOKENS.md §4.4). */
export type RegistryAuth = "none" | "ledger" | "keycloak";
export const REGISTRY_AUTHS: readonly RegistryAuth[] = ["none", "ledger", "keycloak"];

/** How the treasury sends an instrument out: the Enterprise Wallet's transfer route or the registry's TransferFactory. */
export type TreasuryTransferMode = "wallet" | "registry";
export const TREASURY_TRANSFER_MODES: readonly TreasuryTransferMode[] = ["wallet", "registry"];

/**
 * The operator's view of a catalog row (`GET|POST|PATCH /admin/instruments`): the public entry plus
 * the registry and transfer wiring the backend uses for it. Disabled rows are included there.
 */
export interface ApiAdminInstrument extends ApiInstrument {
  registryUrl: string | null;
  registryAuth: RegistryAuth;
  /** null = the process default (`TREASURY_TRANSFER_MODE`). */
  transferMode: TreasuryTransferMode | null;
  /** Choice names the setup action exercises on the registry's factory (`autoAccept`, `mintDelegation`). */
  setupChoices: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export function fetchInstruments(): Promise<ApiInstrument[]> {
  return backendFetch<{ instruments: ApiInstrument[] }>("/api/v1/exchange/instruments").then((r) => r.instruments);
}

export const INSTRUMENTS_QUERY_KEY = ["instruments"] as const;

/**
 * The instrument catalog, cached for the session: it changes when an operator edits it, not between
 * page views, so one read serves every component that labels a figure. A deployment without an
 * accounts backend has no catalog — that is a normal state (the app then reads the ledger directly),
 * answered with an empty list rather than an error that every mount would retry.
 */
export function useInstruments(): UseQueryResult<ApiInstrument[]> {
  return useQuery({
    queryKey: INSTRUMENTS_QUERY_KEY,
    queryFn: async () => ((await probeBackend()) === "unconfigured" ? [] : fetchInstruments()),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function sameInstrument(a: InstrumentId | null | undefined, b: InstrumentId | null | undefined): boolean {
  return !!a && !!b && a.admin === b.admin && a.id === b.id;
}

/** `<admin>:<id>` — the form the backend's `?instrument=` query and the admin routes take. */
export function instrumentKey(i: InstrumentId): string {
  return `${i.admin}:${i.id}`;
}

/** The collateral instruments an operator may denominate a new market in. */
export function enabledCollaterals(instruments: ApiInstrument[] | undefined): ApiInstrument[] {
  return (instruments ?? []).filter((i) => i.kind === "collateral" && i.enabled);
}

/**
 * The instrument new markets (and the in-app wallet card's first row) default to: the enabled
 * collateral the operator flagged, else the first enabled collateral, else nothing — a catalog
 * without a usable collateral has no default to offer.
 */
export function defaultCollateral(instruments: ApiInstrument[] | undefined): ApiInstrument | null {
  const collaterals = enabledCollaterals(instruments);
  return collaterals.find((i) => i.isDefaultCollateral) ?? collaterals[0] ?? null;
}

/** The rewards instrument (TRO), when the catalog lists one. */
export function rewardsInstrument(instruments: ApiInstrument[] | undefined): ApiInstrument | null {
  return (instruments ?? []).find((i) => i.kind === "rewards") ?? null;
}

export function findInstrument(
  instruments: ApiInstrument[] | undefined,
  id: InstrumentId | null | undefined,
): ApiInstrument | null {
  if (!id) return null;
  return (instruments ?? []).find((i) => sameInstrument(i, id)) ?? null;
}

/**
 * The id the external wallet knows this token by — what `wallet.send({ instrumentId })` takes and
 * what the wallet's own instrument list carries. The catalog's `walletInstrumentId` when the
 * operator set one, else the token id itself (the registries and the wallet usually agree).
 */
export function walletInstrumentId(instrument: Pick<ApiInstrument, "id" | "walletInstrumentId">): string {
  return instrument.walletInstrumentId || instrument.id;
}

/**
 * The catalog entry the external wallet lists under `walletInstrumentId` — the Cantor8 wallet
 * backend reports holdings by its own token ids (`Amulet` for Canton Coin), and the catalog's
 * `walletInstrumentId` is exactly that mapping. Null for a token the catalog does not know.
 */
export function instrumentForWalletId(instruments: ApiInstrument[] | undefined, id: string): ApiInstrument | null {
  return (instruments ?? []).find((i) => walletInstrumentId(i) === id) ?? null;
}

/** Amounts added up per instrument, in first-seen order — a total over mixed instruments has no single figure. */
export function sumByInstrument<T extends InstrumentRef>(
  rows: { instrument: T; amount: number }[],
): { instrument: T; amount: number }[] {
  const totals = new Map<string, { instrument: T; amount: number }>();
  for (const row of rows) {
    const key = instrumentKey(row.instrument);
    const current = totals.get(key);
    if (current) current.amount += row.amount;
    else totals.set(key, { instrument: row.instrument, amount: row.amount });
  }
  return [...totals.values()];
}

/**
 * The catalog's entry for `ref` when it has one — the symbol and decimals the operator configured
 * — else `ref` itself. A record read straight from the ledger only knows the instrument's identity
 * (see `instrumentRefFromId`); this is where it picks up its display name once the catalog is in.
 */
export function resolveInstrument(instruments: ApiInstrument[] | undefined, ref: InstrumentRef): InstrumentRef {
  return findInstrument(instruments, ref) ?? ref;
}

/**
 * The instrument a contract names, as read from the participant without the catalog: the token id
 * stands in for the symbol and name (the same rule the backend's indexer applies to an instrument it
 * meets for the first time), and the decimals are the ledger's own 10 — the honest ceiling when the
 * registry's metadata is unknown, never fewer than the value actually carries.
 */
export function instrumentRefFromId(id: InstrumentId): InstrumentRef {
  return { admin: id.admin, id: id.id, symbol: id.id, name: id.id, decimals: 10 };
}

/** `Canton Coin (CC)` for a selector or a sentence; just the symbol when the name adds nothing. */
export function instrumentLabel(instrument: Pick<InstrumentRef, "symbol" | "name">): string {
  const name = instrument.name.trim();
  return name && name.toLowerCase() !== instrument.symbol.toLowerCase()
    ? `${name} (${instrument.symbol})`
    : instrument.symbol;
}

const formatters = new Map<number, Intl.NumberFormat>();

function formatter(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f;
}

/** Display decimals for an instrument: its own scale, capped by `dp` when a view wants fewer (a ticket shows two). */
function displayDigits(instrument: Pick<InstrumentRef, "decimals"> | null | undefined, dp?: number): number {
  const scale = Math.max(0, Math.min(20, Math.trunc(instrument?.decimals ?? 10)));
  return dp === undefined ? scale : Math.max(0, Math.min(scale, Math.trunc(dp)));
}

/**
 * A money figure for the eye: thousands separators, at most the instrument's decimals (or `dp`,
 * whichever is fewer), trailing zeros trimmed — `1,250`, `0.5`, `12,345.678912`. Wire decimals are
 * 10-dp strings; `Number()` is fine here because this is display only, never arithmetic the ledger
 * acts on. Nothing, or a non-finite value, prints as `0`.
 */
export function formatAmount(
  value: string | number | null | undefined,
  instrument: Pick<InstrumentRef, "decimals"> | null | undefined,
  dp?: number,
): string {
  const n = typeof value === "number" ? value : value == null || value === "" ? 0 : Number(value);
  if (!Number.isFinite(n)) return "0";
  const text = formatter(displayDigits(instrument, dp)).format(n);
  return text === "-0" ? "0" : text;
}

/** `formatAmount` followed by the instrument's symbol: `1,250 cBYN`. */
export function formatMoney(
  value: string | number | null | undefined,
  instrument: Pick<InstrumentRef, "decimals" | "symbol"> | null | undefined,
  dp?: number,
): string {
  const amount = formatAmount(value, instrument, dp);
  return instrument?.symbol ? `${amount} ${instrument.symbol}` : amount;
}

/**
 * `value` floored to the instrument's decimals — what a withdrawal may ask for: the treasury
 * quantises down before a transfer leaves and keeps the dust in-app, so an input that already
 * matches the instrument's scale never shows a figure that cannot be sent in full.
 */
export function quantizeAmount(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  // Work in whole units of the ledger's own 1e-10 so the floor is an integer division: rounding
  // to 10 dp first keeps a binary float a hair under a boundary (0.1 + 0.2) from dropping a step,
  // and flooring the integer (not a re-scaled float) keeps a value already at 10 dp exactly as
  // entered — `1.2345678901 * 1e10` is not an integer in binary and would otherwise floor short.
  const units = Math.round(value * 1e10);
  const step = 10 ** (10 - Math.max(0, Math.min(10, Math.trunc(decimals))));
  return (Math.floor(units / step) * step) / 1e10;
}

/** The `step` of a numeric input for this instrument: `0.000001` for six decimals, `1` for none. */
export function amountStep(instrument: Pick<InstrumentRef, "decimals"> | null | undefined): string {
  const decimals = Math.max(0, Math.min(10, Math.trunc(instrument?.decimals ?? 10)));
  return decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
}
