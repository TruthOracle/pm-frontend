import type { PredictionMarketRecord } from "./activeContracts";

let prefetchedMarkets: PredictionMarketRecord[] | null = null;

export function setPrefetchedMarkets(markets: PredictionMarketRecord[]) {
  prefetchedMarkets = markets;
}

export function getPrefetchedMarkets() {
  return prefetchedMarkets;
}
