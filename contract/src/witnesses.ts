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

/*
 * Ward's private state lives only on the user's device. It is read by the
 * contract's witnesses while a proof is generated and is never published.
 */

import { Ledger } from "./managed/ward/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type WardPrivateState = {
  /** Role secret for the Ward operator or a hospital. */
  readonly secretKey: Uint8Array;
  /** Claim codes the patient received from hospitals, keyed by bill ID (hex). */
  readonly claimCodes: Record<string, Uint8Array>;
};

export const createWardPrivateState = (
  secretKey: Uint8Array,
  claimCodes: Record<string, Uint8Array> = {},
): WardPrivateState => ({ secretKey, claimCodes });

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Returns a copy of the private state with a claim code stored for a bill. */
export const withClaimCode = (state: WardPrivateState, billId: Uint8Array, code: Uint8Array): WardPrivateState => ({
  ...state,
  claimCodes: { ...state.claimCodes, [toHex(billId)]: code },
});

export const witnesses = {
  secretKey: ({ privateState }: WitnessContext<Ledger, WardPrivateState>): [WardPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  claimCode: (
    { privateState }: WitnessContext<Ledger, WardPrivateState>,
    billId: Uint8Array,
  ): [WardPrivateState, Uint8Array] => {
    const code = privateState.claimCodes[toHex(billId)];
    if (code === undefined) {
      throw new Error("No claim code saved on this device for this bill");
    }
    return [privateState, code];
  },
};
