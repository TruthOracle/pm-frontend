/**
 * Canton dApp connection layer using @canton-network/wallet-sdk ecosystem.
 * Uses core packages to discover wallet (extension or remote gateway), open the
 * wallet popup for signing, and request transaction signatures (prepareExecuteAndWait).
 */
import {
  injectSpliceProvider,
  ProviderType,
  SpliceProviderWindow,
  SpliceProviderHttp,
} from "@canton-network/core-splice-provider";
import { popup, discover } from "@canton-network/core-wallet-ui-components";
import { DiscoverResult, WalletEvent } from "@canton-network/core-types";
import type {
  PrepareExecuteParams,
  PrepareExecuteAndWaitResult,
  StatusEvent,
  ListAccountsResult,
  Wallet,
  Network,
  Null,
  TxChangedExecutedEvent,
} from "@canton-network/core-wallet-dapp-rpc-client";

export type { PrepareExecuteParams, PrepareExecuteAndWaitResult, Wallet, Network };

const KERNEL_DISCOVERY = "splice_wallet_kernel_discovery" as const;
const KERNEL_SESSION = "splice_wallet_kernel_session" as const;

// Loop (5N Loop Wallet) by Canton – https://cantonloop.com – web-based, self-custodial, no extension required
const DEFAULT_GATEWAYS = [
  { name: "Loop (Canton)", rpcUrl: "https://cantonloop.com/api/v0/dapp" },
  { name: "Wallet Gateway (localhost, dev)", rpcUrl: "http://localhost:3030/api/v0/dapp" },
];

function getKernelDiscovery(): DiscoverResult | undefined {
  try {
    const raw = localStorage.getItem(KERNEL_DISCOVERY);
    if (!raw) return undefined;
    return DiscoverResult.parse(JSON.parse(raw)) as DiscoverResult;
  } catch {
    return undefined;
  }
}

function setKernelDiscovery(discovery: DiscoverResult): void {
  localStorage.setItem(KERNEL_DISCOVERY, JSON.stringify(discovery));
}

function getKernelSession(): { session?: { accessToken?: string; userUrl?: string } } | undefined {
  try {
    const raw = localStorage.getItem(KERNEL_SESSION);
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function setKernelSession(session: unknown): void {
  localStorage.setItem(KERNEL_SESSION, JSON.stringify(session));
}

function removeKernelDiscovery(): void {
  localStorage.removeItem(KERNEL_DISCOVERY);
}

function removeKernelSession(): void {
  localStorage.removeItem(KERNEL_SESSION);
}

function clearAllLocalState(opts?: { closePopup?: boolean }): void {
  removeKernelSession();
  removeKernelDiscovery();
  if (opts?.closePopup) popup.close();
}


interface SpliceProvider {
  request<T>(args: { method: string; params?: unknown }): Promise<T>;
  on<T>(event: string, listener: (...args: T[]) => void): SpliceProvider;
  emit<T>(event: string, ...args: T[]): boolean;
  removeListener<T>(event: string, listener: (...args: T[]) => void): SpliceProvider;
}

function withTimeout(
  reject: (err: { status: string; error: number; details: string }) => void,
  details: string,
  timeoutMs = 10_000
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    console.warn(`SDK: ${details}`);
    reject({ status: "error", error: 2, details });
  }, timeoutMs);
}

function buildDappController(provider: SpliceProvider) {
  return {
    connect: async (): Promise<StatusEvent> => {
      const response = await provider.request<{ session?: unknown; userUrl?: string }>({
        method: "connect",
      });
      if (response?.session) return response as unknown as StatusEvent;
      popup.open(response?.userUrl ?? "");
      return new Promise<StatusEvent>((resolve, reject) => {
        const timeout = withTimeout(reject, "Timeout waiting for connection", 5 * 60 * 1000);
        provider.on("statusChanged", (event: StatusEvent) => {
          if (event?.isConnected) {
            clearTimeout(timeout);
            resolve(event);
          }
        });
      });
    },
    disconnect: async (): Promise<Null> =>
      provider.request({ method: "disconnect" }) as Promise<Null>,
    prepareExecute: async (params: PrepareExecuteParams): Promise<Null> => {
      const response = await provider.request<{ userUrl?: string }>({
        method: "prepareExecute",
        params,
      });
      if (response?.userUrl) popup.open(response.userUrl);
      return null as unknown as Null;
    },
    prepareExecuteAndWait: async (params: PrepareExecuteParams): Promise<PrepareExecuteAndWaitResult> => {
      const response = await provider.request<{ userUrl?: string }>({
        method: "prepareExecute",
        params,
      });
      if (response?.userUrl) popup.open(response.userUrl);
      return new Promise<PrepareExecuteAndWaitResult>((resolve, reject) => {
        const timeout = withTimeout(reject, "Timed out waiting for transaction approval");
        const listener = (event: { status?: string; commandId?: string; payload?: unknown }) => {
          const st = event?.status;
          if (st === "failed") {
            provider.removeListener("txChanged", listener);
            clearTimeout(timeout);
            reject({
              status: "error",
              error: 3,
              details: `Transaction with commandId ${event?.commandId ?? ""} failed to execute.`,
            });
          }
          if (st === "executed") {
            provider.removeListener("txChanged", listener);
            clearTimeout(timeout);
            resolve({ tx: event as unknown as TxChangedExecutedEvent });
          }
        };
        provider.on("txChanged", listener);
      });
    },
    status: (): Promise<StatusEvent> => provider.request({ method: "status" }),
    listAccounts: (): Promise<ListAccountsResult> => provider.request({ method: "listAccounts" }),
  };
}

class CantonProvider implements SpliceProvider {
  private providerType: ProviderType;
  private provider: SpliceProvider;

  constructor(discovery: DiscoverResult, session?: { accessToken?: string }) {
    this.providerType =
      discovery.walletType === "extension" ? ProviderType.WINDOW : ProviderType.HTTP;
    this.provider =
      this.providerType === ProviderType.WINDOW
        ? new SpliceProviderWindow()
        : new SpliceProviderHttp(
            new URL(discovery.walletType === "remote" ? discovery.url : ""),
            session?.accessToken
          );
  }

  request<T>(args: { method: string; params?: unknown }): Promise<T> {
    if (this.providerType === ProviderType.WINDOW) {
      return this.provider.request<T>(args);
    }
    const controller = buildDappController(this.provider);
    switch (args.method) {
      case "status":
        return controller.status() as Promise<T>;
      case "connect":
        return controller.connect() as Promise<T>;
      case "disconnect":
        return controller.disconnect() as Promise<T>;
      case "prepareExecute":
        return controller.prepareExecute(args.params as PrepareExecuteParams) as Promise<T>;
      case "prepareExecuteAndWait":
        return controller.prepareExecuteAndWait(args.params as PrepareExecuteParams) as Promise<T>;
      case "listAccounts":
        return controller.listAccounts() as Promise<T>;
      case "ledgerApi":
        return this.provider.request<T>(args);
      default:
        throw new Error(`Unsupported method: ${args.method}`);
    }
  }

  on<T>(event: string, listener: (...args: T[]) => void): SpliceProvider {
    this.provider.on(event, listener);
    return this;
  }

  emit<T>(event: string, ...args: T[]): boolean {
    return (this.provider as SpliceProvider).emit(event, ...args);
  }

  removeListener<T>(event: string, listener: (...args: T[]) => void): SpliceProvider {
    this.provider.removeListener(event, listener);
    return this;
  }
}

function injectProvider(discovery: DiscoverResult): SpliceProvider {
  const session = getKernelSession()?.session;
  const provider = new CantonProvider(discovery, session);
  return injectSpliceProvider(provider as import("@canton-network/core-splice-provider").SpliceProvider) as unknown as SpliceProvider;
}

function assertProvider(): SpliceProvider {
  if (typeof window === "undefined" || !(window as Window & { canton?: SpliceProvider }).canton) {
    throw Object.assign(new Error("Canton provider not found. Please install the Splice Wallet."), {
      status: "error",
      error: 0,
      details: "Canton provider not found. Please install the Splice Wallet.",
    });
  }
  return (window as Window & { canton: SpliceProvider }).canton;
}

export interface ConnectOptions {
  defaultGateways?: Array<{ name: string; rpcUrl: string }>;
  additionalGateways?: Array<{ name: string; rpcUrl: string }>;
}

export async function connect(options?: ConnectOptions): Promise<StatusEvent> {
  const { defaultGateways = DEFAULT_GATEWAYS, additionalGateways = [] } = options ?? {};
  const verifiedGateways = [...defaultGateways, ...additionalGateways];
  try {
    const result = await discover(verifiedGateways);
    clearAllLocalState();
    setKernelDiscovery(result);
    const provider = injectProvider(result);
    const response = await provider.request<{ session?: unknown; userUrl?: string }>({
      method: "connect",
    });
    if (response?.session) setKernelSession(response);
    else if (response?.userUrl) console.warn("SDK: Connected without session", response);
    return response as unknown as StatusEvent;
  } catch (err) {
    const details =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : "message" in (err as object)
            ? String((err as { message: unknown }).message)
            : JSON.stringify(err);
    throw { status: "error", error: 4, details };
  }
}

export async function disconnect(): Promise<null> {
  try {
    const provider = assertProvider();
    await provider.request({ method: "disconnect" });
  } finally {
    clearAllLocalState({ closePopup: true });
  }
  return null;
}

export async function status(): Promise<StatusEvent> {
  return assertProvider().request({ method: "status" });
}

export async function listAccounts(): Promise<ListAccountsResult> {
  return assertProvider().request({ method: "listAccounts" });
}

export async function prepareExecuteAndWait(
  params: PrepareExecuteParams
): Promise<PrepareExecuteAndWaitResult> {
  return assertProvider().request({ method: "prepareExecuteAndWait", params });
}

// Restore provider on load if we have stored discovery (e.g. after refresh)
// When wallet disconnects or user logs out, clear local state and close popup
if (typeof window !== "undefined") {
  const discovery = getKernelDiscovery();
  if (discovery) injectProvider(discovery);

  const provider = (window as Window & { canton?: SpliceProvider }).canton;
  if (provider) {
    provider.on("statusChanged", (event: { isConnected?: boolean }) => {
      if (!event?.isConnected) clearAllLocalState({ closePopup: true });
    });
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.type === WalletEvent.SPLICE_WALLET_LOGOUT) {
        clearAllLocalState({ closePopup: true });
      }
    });
  }
}
