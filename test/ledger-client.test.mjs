/**
 * The JSON Ledger API accepts two template-id spellings and is strict about where
 * each may appear: active-contracts filters take ONLY the package-name form
 * ("#name:Module:Entity") and reject the package-id form with INVALID_FIELD
 * "expected a package name", while commands pin the package by id. The deposit and
 * settle-payout endpoints were shipping the id form in their filters, so every
 * reconcile 502'd on every network. Pin both spellings here.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { filterTemplateId, templateId } from "../api/_lib/ledgerClient.mjs";

const PKG_ID = "0a786ef1027354cb70a1cd78331680bf34054a642520dc0eb94c9ac4f775b837";
const saved = {};

beforeEach(() => {
  for (const k of ["VITE_TRUTHORACLE_PACKAGE_ID", "VITE_TRUTHORACLE_PACKAGE_NAME"]) {
    saved[k] = process.env[k];
  }
  process.env.VITE_TRUTHORACLE_PACKAGE_ID = PKG_ID;
  process.env.VITE_TRUTHORACLE_PACKAGE_NAME = "truthoracle-v13";
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("templateId (commands)", () => {
  it("uses the package-id form", () => {
    assert.equal(templateId("UserWallet"), `${PKG_ID}:Truthoracle:UserWallet`);
  });

  it("fails fast without a package id", () => {
    delete process.env.VITE_TRUTHORACLE_PACKAGE_ID;
    assert.throws(() => templateId("UserWallet"), /VITE_TRUTHORACLE_PACKAGE_ID/);
  });
});

describe("filterTemplateId (active-contracts filters)", () => {
  it("uses the package-name reference the participant requires", () => {
    assert.equal(filterTemplateId("UserWallet"), "#truthoracle-v13:Truthoracle:UserWallet");
    assert.equal(filterTemplateId("PendingPayout"), "#truthoracle-v13:Truthoracle:PendingPayout");
  });

  it("never falls back to the package-id form", () => {
    delete process.env.VITE_TRUTHORACLE_PACKAGE_NAME;
    assert.throws(() => filterTemplateId("UserWallet"), /VITE_TRUTHORACLE_PACKAGE_NAME/);
  });

  it("honours the module override", () => {
    assert.equal(
      filterTemplateId("UserRewardsSummary", "Incentives"),
      "#truthoracle-v13:Incentives:UserRewardsSummary",
    );
  });
});

import { incomingTransfersFromTrees } from "../api/_lib/ledgerClient.mjs";

/**
 * Fixtures mirror the JSON Ledger API's /v2/updates/trees shape as observed on the
 * zkpc MainNet participant for a Cantor8 → treasury Canton Coin transfer.
 */
const ADMIN = "f482e75f::1220admin";
const SENDER = "a99dd107::1220user";
const AMULET_PKG = "9e3c2b::Splice.Amulet:Amulet".replace("9e3c2b::", "9e3c2b:");
const PREAPPROVAL_TPL = "9e3c2b:Splice.AmuletRules:TransferPreapproval";

function tree({ offset, updateId, recordTime, events }) {
  const eventsById = {};
  events.forEach((ev, i) => { eventsById[String(i)] = ev; });
  return { update: { TransactionTree: { value: { offset, updateId, recordTime, eventsById } } } };
}
const exercised = (templateId, choice, choiceArgument) => ({ ExercisedTreeEvent: { value: { templateId, choice, choiceArgument, actingParties: [] } } });
const createdAmulet = (owner, initialAmount) => ({ CreatedTreeEvent: { value: { templateId: AMULET_PKG, createArgument: { owner, amount: { initialAmount } } } } });

const depositTx = (offset, updateId, amount) =>
  tree({
    offset,
    updateId,
    recordTime: "2026-09-16T10:00:00.000000Z",
    events: [
      exercised(PREAPPROVAL_TPL, "TransferPreapproval_SendV2", { sender: SENDER, amount }),
      exercised(AMULET_PKG, "Archive", {}),
      createdAmulet(ADMIN, amount),
      createdAmulet(SENDER, "28.6173547276"),
    ],
  });

describe("incomingTransfersFromTrees", () => {
  it("attributes the receiver's new Amulet to the sender of the transfer exercise", () => {
    const rows = incomingTransfersFromTrees([depositTx(6102227, "u1", "20.0000000000")], ADMIN);
    assert.deepEqual(rows, [
      { updateId: "u1", offset: 6102227, recordTime: "2026-09-16T10:00:00.000000Z", sender: SENDER, amountCC: 20 },
    ]);
  });

  it("uses what arrived (the receiver's Amulets), summing several outputs", () => {
    const tx = tree({ offset: 1, updateId: "u2", recordTime: "t", events: [
      exercised("9e3c2b:Splice.AmuletRules:AmuletRules", "AmuletRules_Transfer", { transfer: { sender: SENDER } }),
      createdAmulet(ADMIN, "1.5"), createdAmulet(ADMIN, "2.5"), createdAmulet(SENDER, "7"),
    ] });
    assert.equal(incomingTransfersFromTrees([tx], ADMIN)[0].amountCC, 4);
  });

  it("skips the receiver's own outbound transfers and Amulets created without a transfer", () => {
    const outbound = tree({ offset: 2, updateId: "u3", recordTime: "t", events: [
      exercised(PREAPPROVAL_TPL, "TransferPreapproval_SendV2", { sender: ADMIN, amount: "5" }),
      createdAmulet(ADMIN, "95"), // change back to the sender
    ] });
    const minted = tree({ offset: 3, updateId: "u4", recordTime: "t", events: [createdAmulet(ADMIN, "10")] });
    const rewards = tree({ offset: 4, updateId: "u5", recordTime: "t", events: [
      exercised("9e3c2b:Splice.Round:OpenMiningRound", "AmuletRules_Mint", { sender: SENDER }),
      createdAmulet(ADMIN, "10"),
    ] });
    assert.deepEqual(incomingTransfersFromTrees([outbound, minted, rewards], ADMIN), []);
  });

  it("tolerates unrelated updates and missing shapes", () => {
    assert.deepEqual(incomingTransfersFromTrees([{ update: { Reassignment: {} } }, null, {}], ADMIN), []);
    assert.deepEqual(incomingTransfersFromTrees(undefined, ADMIN), []);
  });
});
