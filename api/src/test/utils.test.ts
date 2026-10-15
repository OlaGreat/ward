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

import { describe, expect, it } from "vitest";
import {
  decodeClaim,
  encodeClaim,
  formatNight,
  formatUnshieldedAddress,
  fromHex,
  parseNight,
  parseUnshieldedAddress,
  randomBytes,
  toHex,
} from "../utils/index.js";

describe("claim links", () => {
  it("round-trips a bill ID and claim code", () => {
    const billId = randomBytes(32);
    const code = randomBytes(32);
    const claim = encodeClaim({ billId, code });
    expect(claim.startsWith("ward1")).toBe(true);
    expect(decodeClaim(claim)).toEqual({ billId, code });
  });

  it("reads the claim from the fragment of a full link", () => {
    const billId = randomBytes(32);
    const code = randomBytes(32);
    const link = `https://ward.example/claim#${encodeClaim({ billId, code })}`;
    expect(decodeClaim(link)).toEqual({ billId, code });
  });

  it("produces URL-safe text", () => {
    const claim = encodeClaim({ billId: new Uint8Array(32).fill(0xfb), code: new Uint8Array(32).fill(0xff) });
    expect(claim).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects text that is not a claim, or a truncated one", () => {
    expect(() => decodeClaim("hello")).toThrow("doesn't look like a Ward claim link");
    const claim = encodeClaim({ billId: randomBytes(32), code: randomBytes(32) });
    expect(() => decodeClaim(claim.slice(0, 40))).toThrow("incomplete");
  });
});

describe("NIGHT amounts", () => {
  it("formats Stars as NIGHT", () => {
    expect(formatNight(2_400_000_000n)).toBe("2,400");
    expect(formatNight(12_500_000n)).toBe("12.5");
    expect(formatNight(1n)).toBe("0.000001");
    expect(formatNight(0n)).toBe("0");
  });

  it("parses user input into Stars", () => {
    expect(parseNight("2400")).toBe(2_400_000_000n);
    expect(parseNight("1,250.75")).toBe(1_250_750_000n);
    expect(parseNight(" 0.000001 ")).toBe(1n);
  });

  it("rejects malformed amounts", () => {
    for (const bad of ["", "abc", "-5", "1.1234567", "1e6"]) {
      expect(() => parseNight(bad)).toThrow();
    }
  });
});

describe("hex and addresses", () => {
  it("round-trips hex", () => {
    const bytes = randomBytes(32);
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(fromHex("0x" + toHex(bytes))).toEqual(bytes);
    expect(() => fromHex("xyz")).toThrow("Expected a hex string");
  });

  it("round-trips unshielded addresses for a network", () => {
    const bytes = randomBytes(32);
    const address = formatUnshieldedAddress(bytes, "preprod");
    expect(address.startsWith("mn_addr_preprod1")).toBe(true);
    expect(parseUnshieldedAddress(address, "preprod")).toEqual(bytes);
  });

  it("refuses an address from another network", () => {
    const address = formatUnshieldedAddress(randomBytes(32), "preview");
    expect(() => parseUnshieldedAddress(address, "preprod")).toThrow("Not a valid unshielded address");
  });
});
