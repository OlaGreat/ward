// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// SPDX-License-Identifier: Apache-2.0

import "./globals";
import "./index.css";
import "@midnight-ntwrk/dapp-connector-api";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WalletProvider } from "./hooks/wallet";
import { WardProvider } from "./hooks/ward";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WalletProvider>
      <WardProvider>
        <App />
      </WardProvider>
    </WalletProvider>
  </React.StrictMode>,
);
