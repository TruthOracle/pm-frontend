import { PropsWithChildren } from "react";
import { CantonWalletProvider } from "@/contexts/CantonWalletContext";

export function WalletProvider({ children }: PropsWithChildren) {
  return <CantonWalletProvider>{children}</CantonWalletProvider>;
}
