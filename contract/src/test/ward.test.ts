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
import {
  encodeRawTokenType,
  encodeUserAddress,
  sampleRawTokenType,
  sampleUserAddress,
} from "@midnight-ntwrk/compact-runtime";
import { BillStatus, pureCircuits } from "../managed/ward/contract/index.js";
import { type WardPrivateState, createWardPrivateState, toHex, withClaimCode } from "../witnesses.js";
import { WardSimulator } from "./ward-simulator.js";
import { randomBytes } from "./utils.js";

setNetworkId("undeployed");

const TOKEN_HEX = sampleRawTokenType();
const TOKEN = encodeRawTokenType(TOKEN_HEX);

// Serialises anything the runtime hands back, including bigints and byte arrays,
// so tests can search it for leaked secrets.
const dump = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Uint8Array) return toHex(v);
    if (v instanceof Map) return Array.from(v.entries());
    return v;
  });

describe("Ward contract", () => {
  let sim: WardSimulator;
  let operator: WardPrivateState;
  let hospital: WardPrivateState;
  let hospitalPk: Uint8Array;
  let payoutHex: string;
  let stranger: WardPrivateState;

  // A bill issued by `hospital` with a fundraiser opened by `patient`.
  const openBill = (amount = 1_000n, title = "Help Ada get her heart surgery") => {
    const billId = randomBytes(32);
    const code = randomBytes(32);
    sim.issueBill(hospital, billId, amount, code);
    const patient = withClaimCode(createWardPrivateState(randomBytes(32)), billId, code);
    sim.openFundraiser(patient, billId, title);
    return { billId, code, patient };
  };

  beforeEach(() => {
    operator = createWardPrivateState(randomBytes(32));
    hospital = createWardPrivateState(randomBytes(32));
    stranger = createWardPrivateState(randomBytes(32));
    hospitalPk = pureCircuits.hospitalKey(hospital.secretKey);
    payoutHex = sampleUserAddress();
    sim = new WardSimulator(operator.secretKey, TOKEN);
    sim.registerHospital(operator, hospitalPk, "St. Mercy Medical Centre", encodeUserAddress(payoutHex));
  });

  describe("deployment", () => {
    it("stores only a hash of the operator's secret and the donation token", () => {
      const fresh = new WardSimulator(operator.secretKey, TOKEN).getLedger();
      expect(fresh.operator).toEqual(pureCircuits.operatorKey(operator.secretKey));
      expect(fresh.operator).not.toEqual(operator.secretKey);
      expect(fresh.donationToken).toEqual(TOKEN);
      expect(fresh.billCount).toEqual(0n);
      expect(fresh.totalRaised).toEqual(0n);
      expect(fresh.hospitals.isEmpty()).toBe(true);
    });

    it("derives unrelated operator and hospital keys from the same secret", () => {
      const secret = randomBytes(32);
      expect(pureCircuits.operatorKey(secret)).not.toEqual(pureCircuits.hospitalKey(secret));
    });
  });

  describe("hospital registry", () => {
    it("lets the operator register a hospital", () => {
      const record = sim.getLedger().hospitals.lookup(hospitalPk);
      expect(record.name).toEqual("St. Mercy Medical Centre");
      expect(record.payout.bytes).toEqual(encodeUserAddress(payoutHex));
      expect(record.active).toBe(true);
    });

    it("rejects registrations from anyone but the operator", () => {
      expect(() =>
        sim.registerHospital(stranger, randomBytes(32), "Fake Clinic", encodeUserAddress(sampleUserAddress())),
      ).toThrow("failed assert: Only the Ward operator can do this");
    });

    it("rejects registering the same hospital twice", () => {
      expect(() => sim.registerHospital(operator, hospitalPk, "St. Mercy again", encodeUserAddress(payoutHex))).toThrow(
        "failed assert: Hospital already registered",
      );
    });

    it("lets only the operator suspend a hospital", () => {
      expect(() => sim.setHospitalActive(stranger, hospitalPk, false)).toThrow(
        "failed assert: Only the Ward operator can do this",
      );
      sim.setHospitalActive(operator, hospitalPk, false);
      expect(sim.getLedger().hospitals.lookup(hospitalPk).active).toBe(false);
    });
  });

  describe("issuing bills", () => {
    it("records the bill with a commitment to the claim code, never the code itself", () => {
      const billId = randomBytes(32);
      const code = randomBytes(32);
      sim.issueBill(hospital, billId, 2_400n, code);

      const bill = sim.getLedger().bills.lookup(billId);
      expect(bill.hospital).toEqual(hospitalPk);
      expect(bill.amountDue).toEqual(2_400n);
      expect(bill.raised).toEqual(0n);
      expect(bill.status).toEqual(BillStatus.ISSUED);
      expect(bill.title.is_some).toBe(false);
      expect(bill.claimCommitment).toEqual(pureCircuits.claimCommitment(billId, code));
      expect(sim.getLedger().billCount).toEqual(1n);

      // The code was a private input to the proof: it must not appear in the
      // public transcript of the transaction or in the resulting ledger state.
      // The bill ID and commitment are public, so finding them confirms the
      // search would catch the code if it leaked.
      const transcript = dump(sim.lastTranscript);
      expect(transcript).toContain(toHex(billId));
      expect(transcript).toContain(toHex(bill.claimCommitment));
      expect(transcript).not.toContain(toHex(code));
      expect(dump(Array.from(sim.getLedger().bills))).not.toContain(toHex(code));
    });

    it("rejects bills from callers that are not registered hospitals", () => {
      expect(() => sim.issueBill(stranger, randomBytes(32), 100n, randomBytes(32))).toThrow(
        "failed assert: Caller is not a registered hospital",
      );
    });

    it("rejects bills from a suspended hospital", () => {
      sim.setHospitalActive(operator, hospitalPk, false);
      expect(() => sim.issueBill(hospital, randomBytes(32), 100n, randomBytes(32))).toThrow(
        "failed assert: Hospital is suspended",
      );
    });

    it("rejects a zero amount and a reused bill ID", () => {
      const billId = randomBytes(32);
      expect(() => sim.issueBill(hospital, billId, 0n, randomBytes(32))).toThrow(
        "failed assert: Bill amount must be greater than zero",
      );
      sim.issueBill(hospital, billId, 100n, randomBytes(32));
      expect(() => sim.issueBill(hospital, billId, 100n, randomBytes(32))).toThrow(
        "failed assert: Bill ID already used",
      );
    });
  });

  describe("opening a fundraiser", () => {
    it("lets the patient open it with the claim code", () => {
      const { billId } = openBill(1_000n, "Help Ada get her heart surgery");
      const bill = sim.getLedger().bills.lookup(billId);
      expect(bill.status).toEqual(BillStatus.FUNDRAISING);
      expect(bill.title).toEqual({ is_some: true, value: "Help Ada get her heart surgery" });
    });

    it("never publishes the claim code or the patient's key", () => {
      const billId = randomBytes(32);
      const code = randomBytes(32);
      sim.issueBill(hospital, billId, 500n, code);
      const patient = withClaimCode(createWardPrivateState(randomBytes(32)), billId, code);
      sim.openFundraiser(patient, billId, "Dialysis for Musa");
      const transcript = dump(sim.lastTranscript);
      expect(transcript).toContain(toHex(billId));
      expect(transcript).not.toContain(toHex(code));
      expect(transcript).not.toContain(toHex(patient.secretKey));
    });

    it("rejects a wrong claim code", () => {
      const billId = randomBytes(32);
      sim.issueBill(hospital, billId, 500n, randomBytes(32));
      const impostor = withClaimCode(createWardPrivateState(randomBytes(32)), billId, randomBytes(32));
      expect(() => sim.openFundraiser(impostor, billId, "Not my bill")).toThrow("failed assert: Invalid claim code");
    });

    it("rejects a claim code that belongs to a different bill", () => {
      const { code } = openBill();
      const otherBill = randomBytes(32);
      sim.issueBill(hospital, otherBill, 500n, randomBytes(32));
      const replayer = withClaimCode(createWardPrivateState(randomBytes(32)), otherBill, code);
      expect(() => sim.openFundraiser(replayer, otherBill, "Replay")).toThrow("failed assert: Invalid claim code");
    });

    it("allows only one fundraiser per bill", () => {
      const { billId, patient } = openBill();
      expect(() => sim.openFundraiser(patient, billId, "Second fundraiser")).toThrow(
        "failed assert: A fundraiser already exists for this bill",
      );
    });

    it("fails when the device has no claim code for the bill", () => {
      const billId = randomBytes(32);
      sim.issueBill(hospital, billId, 500n, randomBytes(32));
      expect(() => sim.openFundraiser(stranger, billId, "No code")).toThrow(
        "No claim code saved on this device for this bill",
      );
    });

    it("rejects unknown bills", () => {
      expect(() => sim.openFundraiser(stranger, randomBytes(32), "Ghost")).toThrow("failed assert: Unknown bill");
    });
  });

  describe("donations", () => {
    it("forwards every donation to the hospital's payout address", () => {
      const { billId } = openBill(1_000n);
      const donor = createWardPrivateState(randomBytes(32));
      sim.donate(donor, billId, 250n);

      const effects = sim.lastEffects!;
      const received = Array.from(effects.unshieldedInputs.entries());
      expect(received).toEqual([[{ tag: "unshielded", raw: TOKEN_HEX }, 250n]]);

      const sent = Array.from(effects.claimedUnshieldedSpends.entries());
      expect(sent).toEqual([
        [
          [
            { tag: "unshielded", raw: TOKEN_HEX },
            { tag: "user", address: payoutHex },
          ],
          250n,
        ],
      ]);
    });

    it("tracks the amount raised and closes the bill once fully funded", () => {
      const { billId } = openBill(1_000n);
      const donor = createWardPrivateState(randomBytes(32));
      sim.donate(donor, billId, 400n);
      expect(sim.getLedger().bills.lookup(billId).raised).toEqual(400n);
      expect(sim.getLedger().bills.lookup(billId).status).toEqual(BillStatus.FUNDRAISING);

      sim.donate(donor, billId, 600n);
      const bill = sim.getLedger().bills.lookup(billId);
      expect(bill.raised).toEqual(1_000n);
      expect(bill.status).toEqual(BillStatus.FUNDED);
      expect(sim.getLedger().totalRaised).toEqual(1_000n);

      expect(() => sim.donate(donor, billId, 1n)).toThrow("failed assert: This bill is not accepting donations");
    });

    it("rejects donations larger than the amount still owed", () => {
      const { billId } = openBill(1_000n);
      const donor = createWardPrivateState(randomBytes(32));
      sim.donate(donor, billId, 900n);
      expect(() => sim.donate(donor, billId, 101n)).toThrow(
        "failed assert: Donation is more than the amount still owed",
      );
    });

    it("rejects zero donations", () => {
      const { billId } = openBill();
      expect(() => sim.donate(stranger, billId, 0n)).toThrow("failed assert: Donation must be greater than zero");
    });

    it("rejects donations before the patient opens the fundraiser", () => {
      const billId = randomBytes(32);
      sim.issueBill(hospital, billId, 500n, randomBytes(32));
      expect(() => sim.donate(stranger, billId, 10n)).toThrow("failed assert: This bill is not accepting donations");
    });

    it("stops donations to a suspended hospital", () => {
      const { billId } = openBill();
      sim.setHospitalActive(operator, hospitalPk, false);
      expect(() => sim.donate(stranger, billId, 10n)).toThrow("failed assert: Hospital is suspended");
    });

    it("keeps a running total across bills", () => {
      const a = openBill(300n).billId;
      const b = openBill(700n).billId;
      sim.donate(stranger, a, 300n);
      sim.donate(stranger, b, 200n);
      expect(sim.getLedger().totalRaised).toEqual(500n);
    });
  });

  describe("hospital actions", () => {
    it("lets the issuing hospital cancel a bill, which stops donations", () => {
      const { billId } = openBill();
      sim.cancelBill(hospital, billId);
      expect(sim.getLedger().bills.lookup(billId).status).toEqual(BillStatus.CANCELLED);
      expect(() => sim.donate(stranger, billId, 10n)).toThrow("failed assert: This bill is not accepting donations");
      expect(() => sim.cancelBill(hospital, billId)).toThrow("failed assert: Bill is already cancelled");
    });

    it("does not let another hospital cancel the bill", () => {
      const { billId } = openBill();
      const otherHospital = createWardPrivateState(randomBytes(32));
      sim.registerHospital(
        operator,
        pureCircuits.hospitalKey(otherHospital.secretKey),
        "Other Clinic",
        encodeUserAddress(sampleUserAddress()),
      );
      expect(() => sim.cancelBill(otherHospital, billId)).toThrow(
        "failed assert: Only the issuing hospital can cancel this bill",
      );
    });

    it("does not allow cancelling a fully funded bill", () => {
      const { billId } = openBill(100n);
      sim.donate(stranger, billId, 100n);
      expect(() => sim.cancelBill(hospital, billId)).toThrow("failed assert: A fully funded bill cannot be cancelled");
    });

    it("lets the issuing hospital confirm treatment, and nobody else", () => {
      const { billId } = openBill(100n);
      expect(() => sim.confirmTreatment(stranger, billId)).toThrow(
        "failed assert: Caller is not a registered hospital",
      );
      sim.donate(stranger, billId, 100n);
      sim.confirmTreatment(hospital, billId);
      expect(sim.getLedger().bills.lookup(billId).treatmentComplete).toBe(true);
    });
  });
});
