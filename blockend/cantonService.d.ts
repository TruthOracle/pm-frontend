// cantonService.d.ts
export function initMarket(adminAccount: any, question: any, option1: any, option2: any, sharesPerOption: any): Promise<any>;
export function getMarketMetadata(value: any): any;
export function getUserMarketData(value: any): any;
export function getMarketCount(): any;
export function getUserRewards(value: any): any;
export function claimRewards(value: any): any;
export function claimAllRewards(account: any): any;
export function getRewardMarkets(userAddress: any): any;
export function getPlatformCantonBalance(accountAddress: any): any;
export function getClaimedMarkets(userAddress: any): any;
