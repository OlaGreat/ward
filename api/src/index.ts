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

import * as Ward from "../../contract/src/managed/ward/contract/index.js";
import { CompiledWardContract } from "../../contract/src/index";
import { type WardPrivateState, createWardPrivateState, withClaimCode } from "../../contract/src/witnesses.js";
import { type ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { BehaviorSubject, combineLatest, map, type Observable } from "rxjs";
import { type Logger } from "pino";
import {
  type BillView,
  type DeployedWardContract,
  type HospitalView,
  type IssuedBill,
  type WardContract,
  type WardProviders,
  type WardState,
  wardPrivateStateKey,
} from "./common-types.js";
import {
  bytesEqual,
  decodeClaim,
  encodeClaim,
  formatUnshieldedAddress,
  fromHex,
  parseUnshieldedAddress,
  randomBytes,
  toHex,
} from "./utils/index.js";

/** Combines the public ledger with this device's private state into one view. */
export const deriveWardState = (
  contractAddress: string,
  ledger: Ward.Ledger,
  privateState: WardPrivateState,
): WardState => {
  const networkId = getNetworkId();
  const myHospitalKey = Ward.pureCircuits.hospitalKey(privateState.secretKey);

  const hospitals: HospitalView[] = Array.from(ledger.hospitals, ([key, hospital]) => ({
    key: toHex(key),
    name: hospital.name,
    payoutAddress: formatUnshieldedAddress(hospital.payout.bytes, networkId),
    active: hospital.active,
  }));
  const hospitalsByKey = new Map(hospitals.map((h) => [h.key, h]));

  const bills: BillView[] = Array.from(ledger.bills, ([id, bill]) => ({
    id: toHex(id),
    hospitalKey: toHex(bill.hospital),
    hospitalName: hospitalsByKey.get(toHex(bill.hospital))?.name ?? "Unknown hospital",
    amountDue: bill.amountDue,
    raised: bill.raised,
    status: bill.status,
    title: bill.title.is_some ? bill.title.value : undefined,
    treatmentComplete: bill.treatmentComplete,
    claimCommitment: toHex(bill.claimCommitment),
    issuedByMe: bytesEqual(bill.hospital, myHospitalKey),
    claimCodeOnDevice: toHex(id) in privateState.claimCodes,
  }));

  return {
    contractAddress,
    operatorKey: toHex(ledger.operator),
    isOperator: bytesEqual(Ward.pureCircuits.operatorKey(privateState.secretKey), ledger.operator),
    myHospitalKey: toHex(myHospitalKey),
    myHospital: hospitalsByKey.get(toHex(myHospitalKey)),
    hospitals,
    bills,
    billCount: ledger.billCount,
    totalRaised: ledger.totalRaised,
    donationToken: toHex(ledger.donationToken),
  };
};

/**
 * A deployed Ward contract, joined from this device.
 *
 * Every action builds a zero-knowledge proof locally (through the configured
 * proof server) before it is submitted; secrets in the private state are used
 * while proving and are never sent to the network.
 */
export class WardAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<WardState>;
  readonly #privateState$: BehaviorSubject<WardPrivateState>;

  private constructor(
    readonly deployedContract: DeployedWardContract,
    private readonly providers: WardProviders,
    initialPrivateState: WardPrivateState,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
    this.#privateState$ = new BehaviorSubject(initialPrivateState);
    this.state$ = combineLatest([
      providers.publicDataProvider
        .contractStateObservable(this.deployedContractAddress, { type: "latest" })
        .pipe(map((contractState) => Ward.ledger(contractState.data))),
      this.#privateState$,
    ]).pipe(map(([ledger, privateState]) => deriveWardState(this.deployedContractAddress, ledger, privateState)));
  }

  /** Re-reads private state after a transaction, since witnesses may update it. */
  async #refreshPrivateState(): Promise<void> {
    const latest = await this.providers.privateStateProvider.get(wardPrivateStateKey);
    if (latest) this.#privateState$.next(latest);
  }

  #log(circuit: string, txHash: string, blockHeight?: number): void {
    this.logger?.info({ transactionAdded: { circuit, txHash, blockHeight } });
  }

  async registerHospital(hospitalKey: string, name: string, payoutAddress: string): Promise<string> {
    const payout = parseUnshieldedAddress(payoutAddress, getNetworkId());
    const tx = await this.deployedContract.callTx.registerHospital(fromHex(hospitalKey), name.trim(), {
      bytes: payout,
    });
    this.#log("registerHospital", tx.public.txHash, tx.public.blockHeight);
    return tx.public.txHash;
  }

  async setHospitalActive(hospitalKey: string, active: boolean): Promise<string> {
    const tx = await this.deployedContract.callTx.setHospitalActive(fromHex(hospitalKey), active);
    this.#log("setHospitalActive", tx.public.txHash, tx.public.blockHeight);
    return tx.public.txHash;
  }

  /** Issues a bill for `amountDue` (in Stars) and returns the claim to give the patient. */
  async issueBill(amountDue: bigint): Promise<IssuedBill> {
    const billId = randomBytes(32);
    const code = randomBytes(32);
    const tx = await this.deployedContract.callTx.issueBill(billId, amountDue, code);
    this.#log("issueBill", tx.public.txHash, tx.public.blockHeight);
    return { billId: toHex(billId), claim: encodeClaim({ billId, code }), txHash: tx.public.txHash };
  }

  /**
   * Saves the claim code on this device, then proves knowledge of it to open
   * the fundraiser. The code itself never leaves the device.
   */
  async openFundraiser(claim: string, title: string): Promise<string> {
    const { billId, code } = decodeClaim(claim);
    const current = (await this.providers.privateStateProvider.get(wardPrivateStateKey)) ?? this.#privateState$.value;
    const updated = withClaimCode(current, billId, code);
    await this.providers.privateStateProvider.set(wardPrivateStateKey, updated);
    this.#privateState$.next(updated);

    const tx = await this.deployedContract.callTx.openFundraiser(billId, title.trim());
    this.#log("openFundraiser", tx.public.txHash, tx.public.blockHeight);
    await this.#refreshPrivateState();
    return tx.public.txHash;
  }

  /** Donates `amount` Stars; the contract forwards it to the hospital's payout address. */
  async donate(billId: string, amount: bigint): Promise<string> {
    const tx = await this.deployedContract.callTx.donate(fromHex(billId), amount);
    this.#log("donate", tx.public.txHash, tx.public.blockHeight);
    return tx.public.txHash;
  }

  async cancelBill(billId: string): Promise<string> {
    const tx = await this.deployedContract.callTx.cancelBill(fromHex(billId));
    this.#log("cancelBill", tx.public.txHash, tx.public.blockHeight);
    return tx.public.txHash;
  }

  async confirmTreatment(billId: string): Promise<string> {
    const tx = await this.deployedContract.callTx.confirmTreatment(fromHex(billId));
    this.#log("confirmTreatment", tx.public.txHash, tx.public.blockHeight);
    return tx.public.txHash;
  }

  /**
   * Deploys a new Ward instance. The deploying device becomes the operator:
   * only a hash of its secret is published.
   */
  static async deploy(
    providers: WardProviders,
    options: { donationToken: Uint8Array; operatorSecret?: Uint8Array },
    logger?: Logger,
  ): Promise<WardAPI> {
    const initialPrivateState = createWardPrivateState(options.operatorSecret ?? randomBytes(32));
    logger?.info("Deploying Ward contract");
    const deployed = await deployContract(providers, {
      compiledContract: CompiledWardContract,
      privateStateId: wardPrivateStateKey,
      initialPrivateState,
      args: [options.donationToken],
    });
    logger?.info({ contractDeployed: deployed.deployTxData.public });
    return new WardAPI(deployed, providers, initialPrivateState, logger);
  }

  /**
   * Joins an existing Ward instance, reusing this device's private state if it
   * has one. Otherwise it starts from `secretKey` (or a fresh random secret).
   */
  static async join(
    providers: WardProviders,
    contractAddress: ContractAddress,
    logger?: Logger,
    options: { secretKey?: Uint8Array } = {},
  ): Promise<WardAPI> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(wardPrivateStateKey);
    const initialPrivateState = existing ?? createWardPrivateState(options.secretKey ?? randomBytes(32));
    logger?.info({ joinContract: { contractAddress } });
    const found = await findDeployedContract<WardContract>(providers, {
      contractAddress,
      compiledContract: CompiledWardContract,
      privateStateId: wardPrivateStateKey,
      initialPrivateState,
    });
    return new WardAPI(found, providers, initialPrivateState, logger);
  }

  /**
   * Queries the ledger as it is now. (`state$` starts from the state at the
   * moment the contract was joined and then follows updates.)
   */
  async currentState(): Promise<WardState> {
    const ledger = await WardAPI.readLedger(this.providers, this.deployedContractAddress);
    if (!ledger) throw new Error(`No Ward contract found at ${this.deployedContractAddress}`);
    return deriveWardState(this.deployedContractAddress, ledger, this.#privateState$.value);
  }

  /** Reads the current public state once, without joining. */
  static async readLedger(providers: WardProviders, contractAddress: ContractAddress): Promise<Ward.Ledger | null> {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    return state ? Ward.ledger(state.data) : null;
  }
}

export { BillStatus } from "../../contract/src/managed/ward/contract/index.js";
export * as utils from "./utils/index.js";
export * from "./common-types.js";
