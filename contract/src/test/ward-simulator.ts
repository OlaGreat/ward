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

import {
  type ChargedState,
  type CircuitContext,
  type CircuitResults,
  type Effects,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, type Ledger, ledger } from "../managed/ward/contract/index.js";
import { type WardPrivateState, createWardPrivateState, witnesses } from "../witnesses.js";

const DEPLOYER_COIN_KEY = "0".repeat(64);

/**
 * Runs the Ward contract locally, without a network or proof server.
 * Each call is its own transaction built from the current public state, so
 * `lastEffects` and `lastTranscript` describe only the most recent call.
 */
export class WardSimulator {
  readonly contract: Contract<WardPrivateState>;
  readonly address = sampleContractAddress();
  lastEffects: Effects | undefined;
  lastTranscript: unknown;
  private state: ChargedState;

  private constructor(contract: Contract<WardPrivateState>, state: ChargedState) {
    this.contract = contract;
    this.state = state;
  }

  static async create(operatorSecret: Uint8Array, donationToken: Uint8Array): Promise<WardSimulator> {
    const contract = new Contract<WardPrivateState>(witnesses);
    const { currentContractState } = await contract.initialState(
      createConstructorContext(createWardPrivateState(operatorSecret), DEPLOYER_COIN_KEY),
      donationToken,
    );
    return new WardSimulator(contract, currentContractState.data);
  }

  getLedger(): Ledger {
    return ledger(this.state);
  }

  private async run<R>(
    circuitId: string,
    caller: WardPrivateState,
    call: (ctx: CircuitContext<WardPrivateState>) => Promise<CircuitResults<WardPrivateState, R>>,
  ): Promise<R> {
    const context = createCircuitContext<WardPrivateState>({
      circuitId,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: DEPLOYER_COIN_KEY,
      contractState: this.state,
      privateState: caller,
    });
    const results = await call(context);
    const query = results.context.callContext.currentQueryContext;
    this.state = query.state;
    this.lastEffects = query.effects;
    // The root circuit's proof data is the last entry of the trace.
    this.lastTranscript = results.context.callProofDataTrace.at(-1)?.publicTranscript;
    return results.result;
  }

  registerHospital(caller: WardPrivateState, hospitalPk: Uint8Array, name: string, payout: Uint8Array) {
    return this.run("registerHospital", caller, (ctx) =>
      this.contract.impureCircuits.registerHospital(ctx, hospitalPk, name, { bytes: payout }),
    );
  }

  setHospitalActive(caller: WardPrivateState, hospitalPk: Uint8Array, active: boolean) {
    return this.run("setHospitalActive", caller, (ctx) =>
      this.contract.impureCircuits.setHospitalActive(ctx, hospitalPk, active),
    );
  }

  issueBill(caller: WardPrivateState, billId: Uint8Array, amountDue: bigint, code: Uint8Array) {
    return this.run("issueBill", caller, (ctx) => this.contract.impureCircuits.issueBill(ctx, billId, amountDue, code));
  }

  openFundraiser(caller: WardPrivateState, billId: Uint8Array, title: string) {
    return this.run("openFundraiser", caller, (ctx) => this.contract.impureCircuits.openFundraiser(ctx, billId, title));
  }

  donate(caller: WardPrivateState, billId: Uint8Array, amount: bigint) {
    return this.run("donate", caller, (ctx) => this.contract.impureCircuits.donate(ctx, billId, amount));
  }

  cancelBill(caller: WardPrivateState, billId: Uint8Array) {
    return this.run("cancelBill", caller, (ctx) => this.contract.impureCircuits.cancelBill(ctx, billId));
  }

  confirmTreatment(caller: WardPrivateState, billId: Uint8Array) {
    return this.run("confirmTreatment", caller, (ctx) => this.contract.impureCircuits.confirmTreatment(ctx, billId));
  }
}
