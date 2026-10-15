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

import { Buffer } from "buffer";
import { MidnightBech32m, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import type { NetworkId } from "@midnight-ntwrk/midnight-js-network-id";

export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string): Uint8Array => {
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) {
    throw new Error("Expected a hex string");
  }
  return Uint8Array.from(clean.match(/../g) ?? [], (byte) => parseInt(byte, 16));
};

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** The token type of NIGHT (tNIGHT on test networks) is all zero bytes. */
export const NIGHT_TOKEN = new Uint8Array(32);

/** NIGHT has six decimal places; its smallest unit is called a Star. */
export const STARS_PER_NIGHT = 1_000_000n;

export const formatNight = (stars: bigint): string => {
  const whole = stars / STARS_PER_NIGHT;
  const fraction = (stars % STARS_PER_NIGHT).toString().padStart(6, "0").replace(/0+$/, "");
  const wholeText = whole.toLocaleString("en-US");
  return fraction ? `${wholeText}.${fraction}` : wholeText;
};

export const parseNight = (input: string): bigint => {
  const text = input.trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) {
    throw new Error("Enter an amount like 250 or 12.5 (up to 6 decimal places)");
  }
  const [, whole, fraction = ""] = match;
  return BigInt(whole) * STARS_PER_NIGHT + BigInt(fraction.padEnd(6, "0"));
};

// A claim is the bill ID plus the patient's secret code. The hospital hands it
// to the patient as a link; Ward puts it in the URL fragment (after "#"), which
// browsers never send to a server.
const CLAIM_PREFIX = "ward1";

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (text: string): Uint8Array => {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

export type Claim = { readonly billId: Uint8Array; readonly code: Uint8Array };

export const encodeClaim = ({ billId, code }: Claim): string => {
  if (billId.length !== 32 || code.length !== 32) {
    throw new Error("Bill ID and claim code must be 32 bytes each");
  }
  const joined = new Uint8Array(64);
  joined.set(billId, 0);
  joined.set(code, 32);
  return CLAIM_PREFIX + toBase64Url(joined);
};

/** Accepts either the bare claim or a full claim link containing it. */
export const decodeClaim = (input: string): Claim => {
  const token = input.trim().split("#").pop()!.split("/").pop()!.trim();
  if (!token.startsWith(CLAIM_PREFIX)) {
    throw new Error("This doesn't look like a Ward claim link");
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(token.slice(CLAIM_PREFIX.length));
  } catch {
    throw new Error("This claim link is damaged. Ask the hospital to share it again");
  }
  if (bytes.length !== 64) {
    throw new Error("This claim link is incomplete. Ask the hospital to share it again");
  }
  return { billId: bytes.slice(0, 32), code: bytes.slice(32) };
};

/** Converts a bech32m unshielded address (mn_addr_...) to the 32 bytes the contract stores. */
export const parseUnshieldedAddress = (address: string, networkId: NetworkId): Uint8Array => {
  try {
    return new Uint8Array(MidnightBech32m.parse(address.trim()).decode(UnshieldedAddress, networkId).data);
  } catch {
    throw new Error(`Not a valid unshielded address for the ${String(networkId)} network`);
  }
};

export const formatUnshieldedAddress = (bytes: Uint8Array, networkId: NetworkId): string =>
  UnshieldedAddress.codec.encode(networkId, new UnshieldedAddress(Buffer.from(bytes))).asString();
