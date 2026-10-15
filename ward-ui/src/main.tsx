// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// SPDX-License-Identifier: Apache-2.0

import "./globals";
import "./index.css";
import "@midnight-ntwrk/dapp-connector-api";

import React from "react";
import ReactDOM from "react-dom/client";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import App from "./App";
import { WalletProvider } from "./hooks/wallet";
import { WardProvider } from "./hooks/ward";

setNetworkId(import.meta.env.VITE_NETWORK_ID);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WalletProvider>
      <WardProvider>
        <App />
      </WardProvider>
    </WalletProvider>
  </React.StrictMode>,
);
