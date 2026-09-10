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

const PKG_ID = "64653d3a4b63abcff3a0f016cdf08b0c46aa827f0b971b8990a7fdf5ede6446a";
const saved = {};

beforeEach(() => {
  for (const k of ["VITE_TRUTHORACLE_PACKAGE_ID", "VITE_TRUTHORACLE_PACKAGE_NAME"]) {
    saved[k] = process.env[k];
  }
  process.env.VITE_TRUTHORACLE_PACKAGE_ID = PKG_ID;
  process.env.VITE_TRUTHORACLE_PACKAGE_NAME = "truthoracle-v14";
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
    assert.equal(filterTemplateId("UserWallet"), "#truthoracle-v14:Truthoracle:UserWallet");
    assert.equal(filterTemplateId("PendingPayout"), "#truthoracle-v14:Truthoracle:PendingPayout");
  });

  it("never falls back to the package-id form", () => {
    delete process.env.VITE_TRUTHORACLE_PACKAGE_NAME;
    assert.throws(() => filterTemplateId("UserWallet"), /VITE_TRUTHORACLE_PACKAGE_NAME/);
  });

  it("honours the module override", () => {
    assert.equal(
      filterTemplateId("UserRewardsSummary", "Incentives"),
      "#truthoracle-v14:Incentives:UserRewardsSummary",
    );
  });
});
