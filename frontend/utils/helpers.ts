/**
 * Validate that the connected network is acceptable for the app.
 * For Canton, custom networks are valid; adjust as needed for your deployment.
 */
export const isValidNetworkName = (network: unknown): boolean => {
  return network != null;
};
