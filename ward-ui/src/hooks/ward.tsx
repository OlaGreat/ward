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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WardAPI, type WardProviders, type WardState } from "../../../api/src/index";
import { NIGHT_TOKEN } from "../../../api/src/utils/index";
import { createWardProviders, txStage$, type ProvingMode, type TxStage } from "../lib/providers";
import { useWallet } from "./wallet";

const CONTRACT_KEY = "ward:v1:contract";

export type WardStatus = "needs-wallet" | "needs-contract" | "joining" | "ready" | "error";

export type ActiveTx = { readonly label: string; readonly stage: TxStage };

type WardContextValue = {
  readonly status: WardStatus;
  readonly error: string | null;
  readonly contractAddress: string | null;
  readonly state: WardState | null;
  readonly provingMode: ProvingMode | null;
  readonly activeTx: ActiveTx | null;
  readonly selectContract: (address: string) => void;
  readonly forgetContract: () => void;
  readonly deployInstance: () => Promise<string>;
  /** Runs a contract action, tracking its progress for the UI. Throws a readable error on failure. */
  readonly run: <T>(label: string, action: (api: WardAPI) => Promise<T>) => Promise<T>;
};

const WardContext = createContext<WardContextValue | null>(null);

const initialContract = (): string | null => {
  const fromUrl = new URLSearchParams(window.location.search).get("ward");
  if (fromUrl) {
    localStorage.setItem(CONTRACT_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(CONTRACT_KEY) || import.meta.env.VITE_WARD_CONTRACT || null;
};

/** Turns SDK and contract errors into sentences a person can act on. */
export const readableError = (error: unknown): string => {
  const raw =
    error && typeof error === "object" && "reason" in error
      ? String(error.reason)
      : error instanceof Error
        ? error.message
        : String(error);
  const assertion = /failed assert: ([^\n]+)/.exec(raw);
  if (assertion) return assertion[1];
  if (/reject|denied|cancel/i.test(raw)) return "The transaction was not approved in your wallet.";
  if (/insufficient|not enough|balance/i.test(raw)) return "Your wallet doesn't have enough tNIGHT or DUST for this.";
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
};

export function WardProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [contractAddress, setContractAddress] = useState<string | null>(initialContract);
  const [status, setStatus] = useState<WardStatus>("needs-wallet");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WardState | null>(null);
  const [provingMode, setProvingMode] = useState<ProvingMode | null>(null);
  const [activeTx, setActiveTx] = useState<ActiveTx | null>(null);
  const apiRef = useRef<WardAPI | null>(null);
  const providersRef = useRef<WardProviders | null>(null);

  // Build providers once per wallet connection.
  useEffect(() => {
    providersRef.current = null;
    apiRef.current = null;
    setState(null);
    if (wallet.status !== "connected" || !wallet.api) {
      setStatus("needs-wallet");
      return;
    }
    let cancelled = false;
    createWardProviders(wallet.api)
      .then(({ providers, provingMode: mode }) => {
        if (cancelled) return;
        providersRef.current = providers;
        setProvingMode(mode);
        setStatus(contractAddress ? "joining" : "needs-contract");
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setStatus("error");
          setError(readableError(e));
        }
      });
    return () => {
      cancelled = true;
    };
    // The selected contract is joined by the effect below.
  }, [wallet.status, wallet.api]);

  // Join the selected contract and follow its state.
  useEffect(() => {
    const providers = providersRef.current;
    if (!providers || !contractAddress || (status !== "joining" && status !== "ready")) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setStatus("joining");
    WardAPI.join(providers, contractAddress)
      .then((api) => {
        if (cancelled) return;
        apiRef.current = api;
        const subscription = api.state$.subscribe({
          next: (next) => {
            setState(next);
            setStatus("ready");
          },
          error: (e: unknown) => {
            setStatus("error");
            setError(readableError(e));
          },
        });
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(`Could not open Ward at this address. ${readableError(e)}`);
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // Re-join only when the address or the providers change, not on every status update.
  }, [contractAddress, provingMode]);

  useEffect(() => {
    const subscription = txStage$.subscribe((stage) =>
      setActiveTx((current) => (current ? { ...current, stage } : current)),
    );
    return () => subscription.unsubscribe();
  }, []);

  const run = useCallback(
    async <T,>(label: string, action: (api: WardAPI) => Promise<T>): Promise<T> => {
      const api = apiRef.current;
      if (!api) throw new Error("Connect your wallet and open a Ward instance first.");
      txStage$.next("idle");
      setActiveTx({ label, stage: "idle" });
      try {
        return await action(api);
      } catch (e) {
        throw new Error(readableError(e));
      } finally {
        setActiveTx(null);
        txStage$.next("idle");
        void wallet.refreshBalances();
      }
    },
    [wallet],
  );

  const selectContract = useCallback((address: string) => {
    const trimmed = address.trim();
    localStorage.setItem(CONTRACT_KEY, trimmed);
    setError(null);
    setContractAddress(trimmed);
    setStatus(providersRef.current ? "joining" : "needs-wallet");
  }, []);

  const forgetContract = useCallback(() => {
    localStorage.removeItem(CONTRACT_KEY);
    apiRef.current = null;
    setState(null);
    setContractAddress(null);
    setStatus(providersRef.current ? "needs-contract" : "needs-wallet");
  }, []);

  const deployInstance = useCallback(async (): Promise<string> => {
    const providers = providersRef.current;
    if (!providers) throw new Error("Connect your wallet first.");
    setActiveTx({ label: "Deploying a new Ward instance", stage: "idle" });
    try {
      const api = await WardAPI.deploy(providers, { donationToken: NIGHT_TOKEN });
      apiRef.current = api;
      localStorage.setItem(CONTRACT_KEY, api.deployedContractAddress);
      setContractAddress(api.deployedContractAddress);
      setStatus("joining");
      return api.deployedContractAddress;
    } catch (e) {
      throw new Error(readableError(e));
    } finally {
      setActiveTx(null);
      txStage$.next("idle");
    }
  }, []);

  const value = useMemo<WardContextValue>(
    () => ({
      status,
      error,
      contractAddress,
      state,
      provingMode,
      activeTx,
      selectContract,
      forgetContract,
      deployInstance,
      run,
    }),
    [status, error, contractAddress, state, provingMode, activeTx, selectContract, forgetContract, deployInstance, run],
  );
  return <WardContext.Provider value={value}>{children}</WardContext.Provider>;
}

export const useWard = (): WardContextValue => {
  const context = useContext(WardContext);
  if (!context) throw new Error("useWard must be used inside WardProvider");
  return context;
};
