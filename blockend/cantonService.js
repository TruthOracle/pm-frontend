// cantonService.js – Canton Network / DAML integration only.
// Read operations should be wired to your Canton participant API (REST or gRPC).
// Command submission uses the frontend Canton Dapp SDK (prepareExecuteAndWait).

/**
 * Initialize a new market. The frontend uses buildInitMarketParams + signAndSubmitTransaction
 * from Canton Dapp SDK; this export is for compatibility. Implement via Canton participant if needed.
 */
export async function initMarket(adminAccount, question, option1, option2, sharesPerOption) {
  // Wire to Canton participant: create DAML contract for Truthoracle.InitMarket or equivalent.
  console.warn("initMarket: wire to Canton participant API");
  return { hash: "" };
}

/**
 * Get total market count. Wire to Canton participant query (e.g. query Truthoracle.Market).
 */
export async function getMarketCount() {
  try {
    // TODO: query Canton participant (REST/gRPC) for market count from DAML contracts
    return 0;
  } catch (e) {
    console.error(e);
    return 0;
  }
}

/**
 * Get market metadata by id. Wire to Canton participant query.
 */
export async function getMarketMetadata(marketId) {
  try {
    // TODO: query Canton participant for market metadata from DAML contracts
    return null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Get user market data. Wire to Canton participant query.
 */
export async function getUserMarketData(userAddress) {
  try {
    // TODO: query Canton participant for user market data from DAML contracts
    return [];
  } catch (e) {
    console.error(e);
    return [];
  }
}

/**
 * Get user rewards [pending, total]. Wire to Canton participant query (Incentives).
 */
export async function getUserRewards(userAddress) {
  try {
    // TODO: query Canton participant for user rewards from DAML Incentives contracts
    return [0, 0];
  } catch (e) {
    console.error(e);
    return [0, 0];
  }
}

/**
 * Claim rewards for a market. The frontend uses buildClaimAllRewardsParams + signAndSubmitTransaction.
 * This export can call Canton participant or be removed if only frontend submit is used.
 */
export async function claimRewards(account, marketId) {
  // Frontend typically uses signAndSubmitTransaction(buildClaimAllRewardsParams(partyId))
  console.warn("claimRewards: use signAndSubmitTransaction with buildClaimAllRewardsParams");
  return { hash: "" };
}

/**
 * Claim all rewards. Frontend uses buildClaimAllRewardsParams + signAndSubmitTransaction.
 */
export async function claimAllRewards(account) {
  console.warn("claimAllRewards: use signAndSubmitTransaction with buildClaimAllRewardsParams");
  return { hash: "" };
}

/**
 * Get reward market ids for a user. Wire to Canton participant query.
 */
export async function getRewardMarkets(userAddress) {
  try {
    // TODO: query Canton participant for reward markets from DAML Incentives contracts
    return [[]];
  } catch (e) {
    console.error(e);
    return [[]];
  }
}

/**
 * Get Canton Coin balance for an account. Wire to Canton participant (native Canton Coin / testnet or mainnet).
 */
export async function getPlatformCantonBalance(accountAddress) {
  try {
    // TODO: query Canton participant for Canton Coin balance for party accountAddress
    return 0;
  } catch (e) {
    console.error("Error fetching Canton Coin balance:", e);
    return 0;
  }
}

/**
 * Get claimed market ids for a user. Wire to Canton participant query.
 */
export async function getClaimedMarkets(userAddress) {
  try {
    // TODO: query Canton participant for claimed markets from DAML Incentives contracts
    return [[]];
  } catch (e) {
    console.error(e);
    return [[]];
  }
}
