// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// Adapted from midnightntwrk/example-bboard (Copyright (C) Midnight Foundation).
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

import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  dappConnectorProofProvider,
  dappConnectorWalletProviders,
} from "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { CostModel } from "@midnight-ntwrk/midnight-js-protocol/v9";
import type { ProofProvider } from "@midnight-ntwrk/midnight-js-types";
import { BehaviorSubject } from "rxjs";
import type { PrivateStateId, WardCircuitKeys, WardProviders } from "../../../api/src/index";
import type { WardPrivateState } from "../../../contract/src/witnesses";
import { browserPrivateStateProvider } from "./private-state";

/** Where the current transaction is, so the UI can explain each step. */
export type TxStage = "idle" | "proving" | "approving" | "submitting" | "confirming";
export const txStage$ = new BehaviorSubject<TxStage>("idle");

export type ProvingMode = "wallet" | "proof-server";

/** How proofs are currently being made; can switch to the proof server mid-session. */
export const provingMode$ = new BehaviorSubject<ProvingMode | null>(null);

/**
 * Proves through the wallet when it offers a proving provider, so users need
 * no proof server of their own. If that is unavailable or fails, a proof
 * server (the wallet's, or a local one on port 6300) takes over.
 */
const createProofProvider = async (
  api: ConnectedAPI,
  zkConfig: FetchZkConfigProvider<WardCircuitKeys>,
  proverServerUri: string | undefined,
): Promise<ProofProvider> => {
  const proofServer = httpClientProofProvider(proverServerUri ?? "http://localhost:6300", zkConfig);
  const walletProof = await dappConnectorProofProvider(api, zkConfig, CostModel.initialCostModel()).catch(
    () => undefined,
  );
  provingMode$.next(walletProof ? "wallet" : "proof-server");

  return {
    supportedEras: proofServer.supportedEras,
    proveTx: async (tx, options) => {
      if (walletProof && provingMode$.value === "wallet") {
        try {
          // The wallet's proving API takes no timeout, so options are not forwarded.
          return await walletProof.proveTx(tx);
        } catch (error) {
          console.warn("Proving through the wallet failed; switching to the proof server", error);
          provingMode$.next("proof-server");
        }
      }
      return proofServer.proveTx(tx, options);
    },
  };
};

export const createWardProviders = async (api: ConnectedAPI): Promise<WardProviders> => {
  const config = await api.getConfiguration();
  const zkConfig = new FetchZkConfigProvider<WardCircuitKeys>(window.location.origin, {
    fetchFunc: fetch.bind(window),
  });
  const proofProvider = await createProofProvider(api, zkConfig, config.proverServerUri);
  const { walletProvider, midnightProvider } = await dappConnectorWalletProviders(api);

  const providers: WardProviders = {
    privateStateProvider: browserPrivateStateProvider<PrivateStateId, WardPrivateState>(),
    zkConfigProvider: zkConfig,
    // Pass the browser WebSocket explicitly; the library default resolves to undefined in browsers.
    publicDataProvider: indexerPublicDataProvider(
      config.indexerUri,
      config.indexerWsUri,
      WebSocket as unknown as Parameters<typeof indexerPublicDataProvider>[2],
    ),
    proofProvider: {
      supportedEras: proofProvider.supportedEras,
      proveTx: async (tx, options) => {
        txStage$.next("proving");
        return proofProvider.proveTx(tx, options);
      },
    },
    walletProvider: {
      supportedEras: walletProvider.supportedEras,
      getCoinPublicKey: () => walletProvider.getCoinPublicKey(),
      getEncryptionPublicKey: () => walletProvider.getEncryptionPublicKey(),
      balanceTx: async (tx, ttl) => {
        txStage$.next("approving");
        return walletProvider.balanceTx(tx, ttl);
      },
    },
    midnightProvider: {
      supportedEras: midnightProvider.supportedEras,
      submitTx: async (tx) => {
        txStage$.next("submitting");
        const id = await midnightProvider.submitTx(tx);
        txStage$.next("confirming");
        return id;
      },
    },
    config: { networkId: config.networkId, ttlSeconds: 3600 },
  };
  return providers;
};
