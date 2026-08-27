import "./index.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChakraProvider } from '@chakra-ui/react'


import App from "@/App.tsx";
import { Toaster } from "@/components/ui/toaster.tsx";
import { WalletProvider } from "@/components/WalletProvider.tsx";
import { Capacitor } from "@capacitor/core";

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("native-ios-app");
}

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
      <ChakraProvider>
            <WalletProvider>
              <QueryClientProvider client={queryClient}>
                <App />
                <Toaster />
              </QueryClientProvider>
            </WalletProvider>
        </ChakraProvider>
  </React.StrictMode>,
);
