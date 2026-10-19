// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";

// Set just before reloading to replace a dead wallet link; the reloaded page connects once.
const RETRY_KEY = "ward:v1:connect-after-reload";
const NETWORK = import.meta.env.VITE_NETWORK_ID;

export type WalletStatus = "idle" | "connecting" | "connected" | "missing" | "error";

export type WalletContextValue = {
  readonly status: WalletStatus;
  readonly api: ConnectedAPI | null;
  readonly walletName: string | null;
  readonly address: string | null;
  /** tNIGHT in Stars, from the wallet's unshielded balance. */
  readonly night: bigint | null;
  /** DUST available for fees. */
  readonly dust: bigint | null;
  readonly error: string | null;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
  readonly refreshBalances: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

/** Extensions inject `window.midnight` shortly after load, so poll briefly. */
const findWallet = async (): Promise<InitialAPI | undefined> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const wallet = Object.values(window.midnight ?? {}).find(
      (w): w is InitialAPI => !!w && typeof w.connect === "function" && w.apiVersion.startsWith("4."),
    );
    if (wallet) return wallet;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return undefined;
};

const describe = (error: unknown): string => {
  if (error && typeof error === "object" && "reason" in error) return String(error.reason);
  if (error instanceof Error) return error.message;
  return "The wallet did not respond";
};

const NIGHT = "0000000000000000000000000000000000000000000000000000000000000000";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [night, setNight] = useState<bigint | null>(null);
  const [dust, setDust] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBalances = useCallback(async (connected: ConnectedAPI) => {
    const [unshielded, dustBalance] = await Promise.all([
      connected.getUnshieldedBalances(),
      connected.getDustBalance(),
    ]);
    const nightKey = Object.keys(unshielded).find((key) => key.endsWith(NIGHT));
    setNight(nightKey ? unshielded[nightKey] : 0n);
    setDust(dustBalance.balance);
  }, []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    const wallet = await findWallet();
    if (!wallet) {
      setStatus("missing");
      setError("No Midnight wallet found. Install Lace and refresh this page.");
      return;
    }
    try {
      // Lace waits silently while it is locked, so don't hang forever.
      const connected = await Promise.race([
        wallet.connect(NETWORK),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Lace didn't respond. Unlock Lace, reload this page and try again")),
            90_000,
          ),
        ),
      ]);
      const { unshieldedAddress } = await connected.getUnshieldedAddress();
      setApi(connected);
      setWalletName(wallet.name);
      setAddress(unshieldedAddress);
      setStatus("connected");
      await loadBalances(connected).catch(() => undefined);
    } catch (e) {
      setStatus("error");
      const code = e && typeof e === "object" && "code" in e ? String(e.code) : null;
      console.error(`Lace connection failed: [${code ?? "no code"}] ${describe(e)}`, e);
      const message = code ? `${describe(e)} (${code})` : describe(e);
      // Lace retires the object it injected after a failed attempt ("Remote API ... was shutdown").
      // Only a page reload gets a fresh one, so reload once and connect again.
      if (/shutdown|no longer be used/i.test(message) && !sessionStorage.getItem(RETRY_KEY)) {
        sessionStorage.setItem(RETRY_KEY, "true");
        window.location.reload();
        return;
      }
      // A connection made before Lace was unlocked goes stale ("Remote API ... was shutdown").
      setError(
        /shutdown|no longer be used|didn't respond/i.test(message)
          ? `Lace stopped responding to this page. Unlock Lace, reload this page, then connect again. Lace said: ${message}`
          : `${message}. Make sure Lace is unlocked and set to the ${NETWORK} network.`,
      );
    }
  }, [loadBalances]);

  const disconnect = useCallback(() => {
    setApi(null);
    setAddress(null);
    setNight(null);
    setDust(null);
    setStatus("idle");
  }, []);

  const refreshBalances = useCallback(async () => {
    if (api) await loadBalances(api).catch(() => undefined);
  }, [api, loadBalances]);

  // Connecting on page load while Lace is locked makes Lace retire its connector,
  // so only connect when asked, or once after a reload that replaced a dead link.
  useEffect(() => {
    if (!sessionStorage.getItem(RETRY_KEY)) return;
    void connect().finally(() => sessionStorage.removeItem(RETRY_KEY));
  }, [connect]);

  const value = useMemo<WalletContextValue>(
    () => ({ status, api, walletName, address, night, dust, error, connect, disconnect, refreshBalances }),
    [status, api, walletName, address, night, dust, error, connect, disconnect, refreshBalances],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = (): WalletContextValue => {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
};
