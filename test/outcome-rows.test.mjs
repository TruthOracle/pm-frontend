/** Unit tests for the outcome table shared by the trending board and the event cards (frontend/lib/outcomeRows.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const { outcomeRows, ownImage, rowsHaveOwnImages, barWidthPercent, NO_SIDE_COLOR } = await import("../frontend/lib/outcomeRows.ts");

const EVENT = { imageUrl: "https://img.example/event.png" };
const market = (ticker, price, extra = {}) => ({
  ticker,
  question: `${ticker}?`,
  yesSubTitle: `${ticker} yes`,
  noSubTitle: `${ticker} no`,
  currentPrice: String(price),
  status: "Trading",
  outcome: null,
  metadata: null,
  ...extra,
});
const colorOf = (t) => `color-${t}`;

describe("outcomeRows", () => {
  it("shows a single binary market as its Yes and No sides, with the complement price and no images", () => {
    const { rows, hidden } = outcomeRows(EVENT, [market("BTC", 0.3, { metadata: { imageUrl: "https://img.example/own.png" } })], colorOf, { maxRows: 2, showAllUpTo: 3 });
    assert.equal(hidden, 0);
    assert.deepEqual(rows.map((r) => [r.label, r.price, r.href, r.image]), [
      ["BTC yes", 0.3, "/markets/BTC?side=yes", ""],
      ["BTC no", 0.7, "/markets/BTC?side=no", ""],
    ]);
    assert.equal(rows[0].color, "color-BTC");
    assert.equal(rows[1].color, NO_SIDE_COLOR);
  });

  it("shows every outcome up to showAllUpTo, the top maxRows beyond it", () => {
    const three = [market("A", 0.5), market("B", 0.3), market("C", 0.2)];
    assert.equal(outcomeRows(EVENT, three, colorOf, { maxRows: 2, showAllUpTo: 3 }).rows.length, 3);
    const four = [...three, market("D", 0.1)];
    const r4 = outcomeRows(EVENT, four, colorOf, { maxRows: 2, showAllUpTo: 3 });
    assert.deepEqual(r4.rows.map((r) => r.ticker), ["A", "B"]);
    assert.equal(r4.hidden, 2);
    // The board always shows two.
    const board = outcomeRows(EVENT, three, colorOf, { maxRows: 2 });
    assert.equal(board.rows.length, 2);
    assert.equal(board.hidden, 1);
  });

  it("marks settled sides: won, lost, void", () => {
    const resolved = outcomeRows(EVENT, [market("Y", 0.9, { status: "Resolved", outcome: "Yes" }), market("N", 0.1, { status: "Resolved", outcome: "No" })], colorOf, { maxRows: 2 });
    assert.deepEqual(resolved.rows.map((r) => r.result), ["won", "lost"]);
    const binaryNo = outcomeRows(EVENT, [market("X", 0.2, { status: "Resolved", outcome: "No" })], colorOf, { maxRows: 2 });
    assert.deepEqual(binaryNo.rows.map((r) => r.result), ["lost", "won"]);
    const voided = outcomeRows(EVENT, [market("V", 0.5, { status: "Voided", outcome: "VoidOutcome" })], colorOf, { maxRows: 2 });
    assert.deepEqual(voided.rows.map((r) => r.result), ["void", "void"]);
    assert.deepEqual(outcomeRows(EVENT, [market("T", 0.5)], colorOf, { maxRows: 2 }).rows.map((r) => r.result), [null, null]);
  });
});

describe("images", () => {
  it("uses a market's own image, never the event banner again", () => {
    assert.equal(ownImage({ metadata: { imageUrl: "https://img.example/own.png" } }, EVENT.imageUrl), "https://img.example/own.png");
    assert.equal(ownImage({ metadata: { imageUrl: EVENT.imageUrl } }, EVENT.imageUrl), "");
    assert.equal(ownImage({ metadata: { imageUrl: "  " } }, EVENT.imageUrl), "");
    assert.equal(ownImage({ metadata: null }, EVENT.imageUrl), "");
  });

  it("shows images only when every row has one", () => {
    const own = (t) => market(t, 0.4, { metadata: { imageUrl: `https://img.example/${t}.png` } });
    assert.equal(rowsHaveOwnImages(outcomeRows(EVENT, [own("A"), own("B")], colorOf, { maxRows: 2 }).rows), true);
    assert.equal(rowsHaveOwnImages(outcomeRows(EVENT, [own("A"), market("B", 0.3)], colorOf, { maxRows: 2 }).rows), false);
    assert.equal(rowsHaveOwnImages([]), false);
  });
});

describe("barWidthPercent", () => {
  it("is the chance in percent, never invisible, never past the column", () => {
    assert.equal(barWidthPercent(0.54), 54);
    assert.equal(barWidthPercent(0), 3);
    assert.equal(barWidthPercent(1.2), 100);
  });
});
