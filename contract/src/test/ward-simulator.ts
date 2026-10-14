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
  type CircuitContext,
  type CircuitResults,
  type Effects,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, type Ledger, ledger } from "../managed/ward/contract/index.js";
import { type WardPrivateState, createWardPrivateState, witnesses } from "../witnesses.js";

/**
 * Runs the Ward contract locally, without a network or proof server.
 * Each call starts from a fresh query context, like a separate transaction,
 * so `lastEffects` and `lastTranscript` describe only the most recent call.
 */
export class WardSimulator {
  readonly contract: Contract<WardPrivateState>;
  circuitContext: CircuitContext<WardPrivateState>;
  lastEffects: Effects | undefined;
  lastTranscript: unknown;

  constructor(operatorSecret: Uint8Array, donationToken: Uint8Array) {
    this.contract = new Contract<WardPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } = this.contract.initialState(
      createConstructorContext(createWardPrivateState(operatorSecret), "0".repeat(64)),
      donationToken,
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  private run<R>(
    caller: WardPrivateState,
    call: (ctx: CircuitContext<WardPrivateState>) => CircuitResults<WardPrivateState, R>,
  ): R {
    const previous = this.circuitContext.currentQueryContext;
    const fresh: CircuitContext<WardPrivateState> = {
      ...this.circuitContext,
      currentPrivateState: caller,
      currentQueryContext: new QueryContext(previous.state, previous.address),
    };
    const results = call(fresh);
    this.circuitContext = results.context;
    this.lastEffects = results.context.currentQueryContext.effects;
    this.lastTranscript = results.proofData.publicTranscript;
    return results.result;
  }

  registerHospital(caller: WardPrivateState, hospitalPk: Uint8Array, name: string, payout: Uint8Array) {
    return this.run(caller, (ctx) =>
      this.contract.impureCircuits.registerHospital(ctx, hospitalPk, name, { bytes: payout }),
    );
  }

  setHospitalActive(caller: WardPrivateState, hospitalPk: Uint8Array, active: boolean) {
    return this.run(caller, (ctx) => this.contract.impureCircuits.setHospitalActive(ctx, hospitalPk, active));
  }

  issueBill(caller: WardPrivateState, billId: Uint8Array, amountDue: bigint, code: Uint8Array) {
    return this.run(caller, (ctx) => this.contract.impureCircuits.issueBill(ctx, billId, amountDue, code));
  }

  openFundraiser(caller: WardPrivateState, billId: Uint8Array, title: string) {
    return this.run(caller, (ctx) => this.contract.impureCircuits.openFundraiser(ctx, billId, title));
  }

  donate(caller: WardPrivateState, billId: Uint8Array, amount: bigint) {
    return this.run(caller, (ctx) => this.contract.impureCircuits.donate(ctx, billId, amount));
  }

  cancelBill(caller: WardPrivateState, billId: Uint8Array) {
    return this.run(caller, (ctx) => this.contract.impureCircuits.cancelBill(ctx, billId));
  }

  confirmTreatment(caller: WardPrivateState, billId: Uint8Array) {
    return this.run(caller, (ctx) => this.contract.impureCircuits.confirmTreatment(ctx, billId));
  }
}
