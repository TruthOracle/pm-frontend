/**
 * The rewards helpers (frontend/lib/rewards.ts): rule kinds and grant statuses in plain words,
 * the "not configured" reading of a 404 from GET /me/rewards, and the parameter keys the
 * operator's rule editor shows per kind.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const rewards = await import("../frontend/lib/rewards.ts");
const { BackendError } = await import("../frontend/lib/backend.ts");

describe("reward kinds", () => {
  it("labels every shipped kind and degrades an unknown one to readable words", () => {
    assert.deepEqual(rewards.REWARD_KINDS.map(rewards.rewardKindLabel), [
      "Trade volume rebate",
      "Winning redeem bonus",
      "First deposit bonus",
      "Operator grant",
    ]);
    assert.equal(rewards.rewardKindLabel("referral_bonus"), "referral bonus");
    assert.ok(rewards.isRewardKind("manual"));
    assert.ok(!rewards.isRewardKind("referral_bonus"));
  });

  it("describes the mechanism alone without params and with the figures when they are known", () => {
    assert.equal(
      rewards.rewardKindDescription("trade_volume_rebate", "TRO"),
      "Every buy and sell on a market in the default collateral earns TRO in proportion to its size.",
    );
    assert.equal(
      rewards.rewardKindDescription("trade_volume_rebate", "TRO", { perUnit: "0.01", minTrade: "1" }),
      "Every buy and sell on a market in the default collateral earns TRO in proportion to its size — 0.01 TRO per unit traded, on trades of at least 1.",
    );
    assert.equal(rewards.rewardKindDescription("winning_redeem_bonus", "TRO", { fraction: "0.05" }), "Redeeming winning shares pays a bonus on top of the payout: 5% of it, in TRO.");
    assert.equal(rewards.rewardKindDescription("first_deposit_bonus", "TRO", { amount: "10" }), "A one-time 10 TRO bonus when your first deposit is credited.");
    assert.match(rewards.rewardKindDescription("manual", "TRO"), /by hand/);
    assert.match(rewards.rewardKindDescription("something_else", "TRO"), /something else/);
  });

  it("knows which params each kind reads", () => {
    assert.deepEqual(rewards.REWARD_RULE_PARAM_KEYS.trade_volume_rebate, ["perUnit", "minTrade"]);
    assert.deepEqual(rewards.REWARD_RULE_PARAM_KEYS.winning_redeem_bonus, ["fraction"]);
    assert.deepEqual(rewards.REWARD_RULE_PARAM_KEYS.first_deposit_bonus, ["amount"]);
    assert.deepEqual(rewards.REWARD_RULE_PARAM_KEYS.manual, []);
  });
});

describe("grant statuses", () => {
  it("maps every status to a pill and a sentence", () => {
    for (const status of rewards.REWARD_GRANT_STATUSES) {
      const view = rewards.rewardStatusView(status);
      assert.ok(view.label.length > 0);
      assert.ok(["neutral", "pending", "ok", "warn", "bad"].includes(view.tone));
    }
    assert.equal(rewards.rewardStatusView("credited").tone, "ok");
    assert.equal(rewards.rewardStatusView("blocked_float").tone, "warn");
    assert.match(rewards.rewardStatusView("blocked_float").detail, /too little/);
    assert.equal(rewards.rewardStatusView("failed").tone, "bad");
    assert.equal(rewards.rewardStatusView("odd_state").label, "odd state");
  });
});

describe("rewardsErrorMessage", () => {
  it("reads a 404 as 'rewards not configured' and translates everything else", () => {
    const notFound = new BackendError(404, "not_found", "no rewards instrument");
    assert.ok(rewards.isRewardsUnconfigured(notFound));
    assert.equal(rewards.rewardsErrorMessage(notFound), rewards.REWARDS_UNCONFIGURED_SENTENCE);
    const expired = new BackendError(401, "unauthenticated", "expired");
    assert.ok(!rewards.isRewardsUnconfigured(expired));
    assert.match(rewards.rewardsErrorMessage(expired), /session has expired/);
    assert.ok(!rewards.isRewardsUnconfigured(new Error("boom")));
    assert.equal(rewards.rewardsErrorMessage(new Error("boom")), "boom");
  });
});
