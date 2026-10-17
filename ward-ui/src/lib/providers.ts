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

import type { ConnectedAPI, KeyMaterialProvider } from "@midnight-ntwrk/dapp-connector-api";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { CostModel, Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
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

// Ward's own circuits. The network's built-in circuits are proven with the
// prover's own keys, so their key material is reported missing, exactly as
// Midnight's HTTP proof provider does.
const WARD_CIRCUITS = new Set<string>([
  "registerHospital",
  "setHospitalActive",
  "issueBill",
  "openFundraiser",
  "donate",
  "cancelBill",
  "confirmTreatment",
] satisfies WardCircuitKeys[]);

const wardCircuit = (location: string): WardCircuitKeys => {
  if (!WARD_CIRCUITS.has(location)) throw new Error(`No Ward key material for ${location}`);
  return location as WardCircuitKeys;
};

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
  const keyMaterial: KeyMaterialProvider = {
    getZKIR: (location) => zkConfig.getZKIR(wardCircuit(location)),
    getProverKey: (location) => zkConfig.getProverKey(wardCircuit(location)),
    getVerifierKey: (location) => zkConfig.getVerifierKey(wardCircuit(location)),
  };
  const walletProving = await api.getProvingProvider(keyMaterial).catch(() => undefined);
  provingMode$.next(walletProving ? "wallet" : "proof-server");

  return {
    proveTx: async (tx, options) => {
      if (walletProving && provingMode$.value === "wallet") {
        try {
          return await tx.prove(walletProving, CostModel.initialCostModel());
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
  const zkConfig = new FetchZkConfigProvider<WardCircuitKeys>(window.location.origin, fetch.bind(window));
  const proofProvider = await createProofProvider(api, zkConfig, config.proverServerUri);
  const addresses = await api.getShieldedAddresses();

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
      proveTx: async (tx, options) => {
        txStage$.next("proving");
        return proofProvider.proveTx(tx, options);
      },
    },
    walletProvider: {
      getCoinPublicKey: () => addresses.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => addresses.shieldedEncryptionPublicKey,
      balanceTx: async (tx) => {
        txStage$.next("approving");
        const balanced = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
        return Transaction.deserialize("signature", "proof", "binding", fromHex(balanced.tx));
      },
    },
    midnightProvider: {
      submitTx: async (tx) => {
        txStage$.next("submitting");
        await api.submitTransaction(toHex(tx.serialize()));
        txStage$.next("confirming");
        return tx.identifiers()[0];
      },
    },
  };
  return providers;
};
