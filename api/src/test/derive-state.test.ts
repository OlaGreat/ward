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

import { beforeEach, describe, expect, it } from "vitest";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { BillStatus, pureCircuits } from "../../../contract/src/managed/ward/contract/index.js";
import { createWardPrivateState, withClaimCode } from "../../../contract/src/witnesses.js";
import { WardSimulator } from "../../../contract/src/test/ward-simulator.js";
import { deriveWardState } from "../index.js";
import { NIGHT_TOKEN, formatUnshieldedAddress, parseUnshieldedAddress, randomBytes, toHex } from "../utils/index.js";

setNetworkId("undeployed");

describe("deriveWardState", () => {
  const operator = createWardPrivateState(randomBytes(32));
  const hospital = createWardPrivateState(randomBytes(32));
  const payout = formatUnshieldedAddress(randomBytes(32), "undeployed");
  let sim: WardSimulator;
  let billId: Uint8Array;
  let code: Uint8Array;

  beforeEach(() => {
    sim = new WardSimulator(operator.secretKey, NIGHT_TOKEN);
    sim.registerHospital(
      operator,
      pureCircuits.hospitalKey(hospital.secretKey),
      "St. Mercy Medical Centre",
      parseUnshieldedAddress(payout, "undeployed"),
    );
    billId = randomBytes(32);
    code = randomBytes(32);
    sim.issueBill(hospital, billId, 2_400_000_000n, code);
  });

  it("recognises the operator only on the operator's device", () => {
    expect(deriveWardState("addr", sim.getLedger(), operator).isOperator).toBe(true);
    expect(deriveWardState("addr", sim.getLedger(), hospital).isOperator).toBe(false);
  });

  it("shows a hospital its own registration and the bills it issued", () => {
    const view = deriveWardState("addr", sim.getLedger(), hospital);
    expect(view.myHospital?.name).toBe("St. Mercy Medical Centre");
    expect(view.myHospital?.payoutAddress).toBe(payout);
    expect(view.bills).toHaveLength(1);
    expect(view.bills[0].issuedByMe).toBe(true);
    expect(view.bills[0].hospitalName).toBe("St. Mercy Medical Centre");
    expect(view.donationToken).toBe(toHex(NIGHT_TOKEN));
  });

  it("knows which bills this device holds a claim code for", () => {
    const patient = withClaimCode(createWardPrivateState(randomBytes(32)), billId, code);
    expect(deriveWardState("addr", sim.getLedger(), patient).bills[0].claimCodeOnDevice).toBe(true);
    expect(deriveWardState("addr", sim.getLedger(), hospital).bills[0].claimCodeOnDevice).toBe(false);
  });

  it("follows a bill from issue to funded", () => {
    const patient = withClaimCode(createWardPrivateState(randomBytes(32)), billId, code);
    sim.openFundraiser(patient, billId, "Help Ada get her heart surgery");
    sim.donate(createWardPrivateState(randomBytes(32)), billId, 2_400_000_000n);

    const bill = deriveWardState("addr", sim.getLedger(), patient).bills[0];
    expect(bill.title).toBe("Help Ada get her heart surgery");
    expect(bill.status).toBe(BillStatus.FUNDED);
    expect(bill.raised).toBe(bill.amountDue);
  });
});
