/**
 * Loop SDK – React integration for Loop Wallet (Canton / Five North).
 *
 * Loop enables dApps to connect to a Loop account, sign and execute transactions
 * on the Canton Ledger. Connection uses QR code (mobile) or popup/tab (browser).
 *
 * @see https://github.com/fivenorth-io/loop-sdk
 * @see https://docs.fivenorth.io/loop-sdk/overview/
 * @see https://cantonloop.com
 * @see https://www.npmjs.com/package/@fivenorth/loop-sdk
 */
import { loop } from "@fivenorth/loop-sdk";
import { LOOP_NETWORK } from "@/config";

export type LoopNetwork = "local" | "devnet" | "testnet" | "mainnet";

export function getLoopNetwork(): LoopNetwork {
  if (typeof window === "undefined") return "devnet";
  // Use devnet by default so Connect works from localhost (Loop "local" expects backend at localhost:8080).
  const envNetwork = LOOP_NETWORK as LoopNetwork;
  if (envNetwork && ["local", "devnet", "testnet", "mainnet"].includes(envNetwork)) return envNetwork;
  return "devnet";
}

export interface LoopInitOptions {
  appName: string;
  network?: LoopNetwork;
  onAccept: (provider: LoopProvider) => void;
  onReject: () => void;
  onTransactionUpdate?: (payload: unknown) => void;
  options?: {
    openMode?: "popup" | "tab";
    requestSigningMode?: "popup" | "tab";
    redirectUrl?: string;
  };
}

export interface LoopProvider {
  party_id: string;
  public_key: string;
  submitTransaction: (payload: DamlCommandPayload, options?: { message?: string; estimateTraffic?: boolean }) => Promise<{ command_id?: string; submission_id?: string }>;
  submitAndWaitForTransaction: (payload: DamlCommandPayload, options?: { message?: string; estimateTraffic?: boolean }) => Promise<LoopTxResult>;
  getHolding: () => Promise<unknown[]>;
  getAccount: () => Promise<unknown>;
  getActiveContracts: (params: { templateId?: string; interfaceId?: string }) => Promise<unknown[]>;
  signMessage: (message: string) => Promise<unknown>;
}

/** DAML command payload accepted by Loop (commands, actAs, etc.) */
export interface DamlCommandPayload {
  commands: unknown[];
  actAs?: string[];
  readAs?: string[];
  disclosedContracts?: unknown[];
  packageIdSelectionPreference?: string[];
  synchronizerId?: string;
  [key: string]: unknown;
}

export interface LoopTxResult {
  command_id?: string;
  submission_id?: string;
  update_id?: string;
  update_data?: unknown;
  status?: string;
  error?: { error_message?: string };
  estimated_traffic?: unknown;
}

let loopInitialized = false;

export function initLoop(options: LoopInitOptions): void {
  if (loopInitialized) return;
  loop.init({
    appName: options.appName,
    network: options.network ?? getLoopNetwork(),
    onTransactionUpdate: options.onTransactionUpdate,
    options: options.options ?? { openMode: "popup", requestSigningMode: "popup" },
    onAccept: options.onAccept,
    onReject: options.onReject,
  });
  loopInitialized = true;
}

export async function loopConnect(): Promise<void> {
  await loop.connect();
}

export function loopDisconnect(): void {
  loop.logout();
}

export function loopAutoConnect(): Promise<void> {
  return loop.autoConnect();
}

export function getLoopProvider(): LoopProvider | null {
  return loop.provider ?? null;
}

export { loop };
