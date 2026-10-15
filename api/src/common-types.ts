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

import { type MidnightProviders } from "@midnight-ntwrk/midnight-js-types";
import { type FoundContract } from "@midnight-ntwrk/midnight-js-contracts";
import type { BillStatus, Contract, WardPrivateState, Witnesses } from "../../contract/src/index";

export const wardPrivateStateKey = "wardPrivateState";
export type PrivateStateId = typeof wardPrivateStateKey;

export type WardContract = Contract<WardPrivateState, Witnesses<WardPrivateState>>;
export type WardCircuitKeys = Exclude<keyof WardContract["impureCircuits"], number | symbol>;
export type WardProviders = MidnightProviders<WardCircuitKeys, PrivateStateId, WardPrivateState>;
export type DeployedWardContract = FoundContract<WardContract>;

export type HospitalView = {
  /** Hospital public key (hex). Hospitals share this with the operator to get registered. */
  readonly key: string;
  readonly name: string;
  /** Unshielded address that receives every donation for this hospital's bills. */
  readonly payoutAddress: string;
  readonly active: boolean;
};

export type BillView = {
  readonly id: string;
  readonly hospitalKey: string;
  readonly hospitalName: string;
  readonly amountDue: bigint;
  readonly raised: bigint;
  readonly status: BillStatus;
  readonly title: string | undefined;
  readonly treatmentComplete: boolean;
  /** Hash binding the bill to the patient's claim code; safe to show. */
  readonly claimCommitment: string;
  /** True when this device's hospital key issued the bill. */
  readonly issuedByMe: boolean;
  /** True when this device holds the patient's claim code for the bill. */
  readonly claimCodeOnDevice: boolean;
};

/** Public ledger state combined with what this device knows privately. */
export type WardState = {
  readonly contractAddress: string;
  readonly operatorKey: string;
  readonly isOperator: boolean;
  /** This device's hospital key, derived from its secret; registered or not. */
  readonly myHospitalKey: string;
  readonly myHospital: HospitalView | undefined;
  readonly hospitals: readonly HospitalView[];
  readonly bills: readonly BillView[];
  readonly billCount: bigint;
  readonly totalRaised: bigint;
  readonly donationToken: string;
};

export type IssuedBill = {
  readonly billId: string;
  /** Hand this to the patient; it is the only way to open the fundraiser. */
  readonly claim: string;
  readonly txHash: string;
};
