import { PropsWithChildren } from "react";
import { CantonWalletProvider } from "@/wallets";


export function WalletProvider({ children }: PropsWithChildren) {
  return <CantonWalletProvider>

      {children}
   
  </CantonWalletProvider>;
}
