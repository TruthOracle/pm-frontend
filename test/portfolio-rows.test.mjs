/**
 * The portfolio's position rows (frontend/components/Portfolio/portfolioRows.ts): the join of
 * positions with their markets, what is redeemable per lifecycle state, and the per-instrument
 * totals that never add a cBYN figure to a Canton Coin one.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const rows = await import("../frontend/components/Portfolio/portfolioRows.ts");

const cantonCoinLedger = { admin: "dso::1220aa", id: "Amulet", symbol: "Amulet", name: "Amulet", decimals: 10 };
const ledgerBYN = { admin: "agent::1220bb", id: "cBYN", symbol: "cBYN", name: "cBYN", decimals: 10 };
const catalog = [
  { admin: "dso::1220aa", id: "Amulet", symbol: "CC", name: "Canton Coin", decimals: 10, kind: "collateral", enabled: true, isDefaultCollateral: false, walletInstrumentId: "Amulet" },
  { admin: "agent::1220bb", id: "cBYN", symbol: "cBYN", name: "Canton Belarusian Ruble", decimals: 6, kind: "collateral", enabled: true, isDefaultCollateral: true, walletInstrumentId: "cBYN" },
];

const market = (marketId, collateral, status, outcome = null, expiresAt = 4_000_000_000) => ({
  contractId: `m${marketId}`,
  marketId,
  question: `Q${marketId}`,
  collateral,
  status,
  outcome,
  expiresAt,
});
const position = (marketId, yesShares, noShares, costBasis) => ({ contractId: `p${marketId}`, marketId, yesShares, noShares, costBasis });

describe("buildRows", () => {
  it("joins positions with markets and computes what is redeemable per state", () => {
    const markets = [
      market(1, cantonCoinLedger, "Trading"),
      market(2, cantonCoinLedger, "Resolved", "Yes"),
      market(3, ledgerBYN, "Resolved", "No"),
      market(4, ledgerBYN, "Voided"),
      market(5, ledgerBYN, "Resolved", "VoidOutcome"),
    ];
    const positions = [position(1, 3, 0, 2), position(2, 4, 1, 3), position(3, 2, 6, 5), position(4, 10, 2, 7), position(5, 1, 1, 1), position(9, 1, 0, 1)];
    const built = rows.buildRows(positions, markets);
    assert.deepEqual(
      built.map((r) => [r.position.marketId, r.market?.marketId ?? null, r.redeemable]),
      [
        [1, 1, 0], // trading: nothing to redeem yet
        [2, 2, 4], // resolved Yes: the YES shares pay 1:1
        [3, 3, 6], // resolved No: the NO shares
        [4, 4, 7], // voided: cost basis bounded by the larger side (10) → 7
        [5, 5, 0], // resolved void outcome: nothing
        [9, null, 0], // market the ledger did not return
      ],
    );
  });
});

describe("statusLabel", () => {
  it("reads the lifecycle with the clock for an expired trading market", () => {
    assert.equal(rows.statusLabel(market(1, cantonCoinLedger, "Trading", null, 100), 200), "Awaiting resolution");
    assert.equal(rows.statusLabel(market(1, cantonCoinLedger, "Trading", null, 300), 200), "Active");
    assert.equal(rows.statusLabel(market(1, cantonCoinLedger, "Proposed"), 0), "Outcome proposed");
    assert.equal(rows.statusLabel(market(1, cantonCoinLedger, "Resolved", "No"), 0), "Resolved (No)");
    assert.equal(rows.statusLabel(market(1, cantonCoinLedger, "Voided"), 0), "Voided");
    assert.equal(rows.statusLabel(null), "Unknown");
  });
});

describe("summarizeRows", () => {
  it("groups cost basis and redeemable value per instrument, resolved against the catalog, and never across", () => {
    const markets = [market(1, cantonCoinLedger, "Trading"), market(2, cantonCoinLedger, "Resolved", "Yes"), market(3, ledgerBYN, "Resolved", "No"), market(4, ledgerBYN, "Proposed")];
    const built = rows.buildRows([position(1, 3, 0, 2), position(2, 4, 1, 3), position(3, 2, 6, 5), position(4, 1, 1, 1.5), position(9, 1, 0, 1)], markets);
    const summary = rows.summarizeRows(built, catalog);
    assert.equal(summary.markets, 5);
    assert.equal(summary.open, 2);
    assert.equal(summary.redeemableMarkets, 2);
    assert.deepEqual(
      summary.byInstrument.map((t) => [t.instrument.symbol, t.instrument.decimals, t.costBasis, t.redeemable, t.markets]),
      [
        ["CC", 10, 5, 4, 2],
        ["cBYN", 6, 6.5, 6, 2],
      ],
    );
  });
  it("keeps the ledger's own label when the catalog does not know the instrument", () => {
    const built = rows.buildRows([position(1, 1, 0, 1)], [market(1, ledgerBYN, "Trading")]);
    const summary = rows.summarizeRows(built, undefined);
    assert.deepEqual(summary.byInstrument.map((t) => [t.instrument.symbol, t.instrument.decimals]), [["cBYN", 10]]);
  });
});
