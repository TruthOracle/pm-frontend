/** Unit tests for the trending-board formatters (frontend/lib/boardFormat.ts). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const fmt = await import("../frontend/lib/boardFormat.ts");

describe("payoutMultiplier", () => {
  it("is 1 / price with two decimals in the usual range", () => {
    assert.equal(fmt.payoutMultiplier(0.64), "1.56x");
    assert.equal(fmt.payoutMultiplier(0.4064), "2.46x");
    assert.equal(fmt.payoutMultiplier(1), "1.00x");
  });
  it("drops precision as the multiplier grows", () => {
    assert.equal(fmt.payoutMultiplier(0.05), "20.0x");
    assert.equal(fmt.payoutMultiplier(0.005), "200x");
  });
  it("refuses nonsense prices", () => {
    assert.equal(fmt.payoutMultiplier(0), "—");
    assert.equal(fmt.payoutMultiplier(-1), "—");
    assert.equal(fmt.payoutMultiplier(Number.NaN), "—");
    assert.equal(fmt.payoutMultiplier(1.5), "1.00x");
  });
});

describe("initialsOf", () => {
  it("takes the leading letters of the first words", () => {
    assert.equal(fmt.initialsOf("Fed rate decisions"), "FR");
    assert.equal(fmt.initialsOf("Cut ≥ 25 bps"), "C2");
    assert.equal(fmt.initialsOf("Hold"), "H");
    assert.equal(fmt.initialsOf("  "), "?");
  });
});

describe("leadSentences", () => {
  it("keeps the first sentences and caps the length", () => {
    const text = "Resolves Yes on a win. Ties count as No! Anything else is void? Extra.";
    assert.equal(fmt.leadSentences(text, 2), "Resolves Yes on a win. Ties count as No!");
    assert.equal(fmt.leadSentences("a".repeat(300), 1, 50).length, 50);
    assert.equal(fmt.leadSentences("   "), "");
  });
});

describe("outcomeLabel", () => {
  it("prefers the Yes label unless it is just Yes", () => {
    assert.equal(fmt.outcomeLabel({ yesSubTitle: "Hold", question: "Will the Fed hold?" }), "Hold");
    assert.equal(fmt.outcomeLabel({ yesSubTitle: "Yes", question: "Will BTC close above $100k?" }), "Will BTC close above $100k?");
  });

  it("names the event chart's lines too, so a market labelled just Yes is not a line called Yes", () => {
    const chart = readFileSync(new URL("../frontend/components/charts/EventPriceChart.tsx", import.meta.url), "utf8");
    assert.match(chart, /label: outcomeLabel\(m\)/);
    assert.doesNotMatch(chart, /yesSubTitle \|\| m\.question/);
  });
});
