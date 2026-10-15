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

import type { ContractAddress, SigningKey } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import type {
  ExportPrivateStatesOptions,
  ExportSigningKeysOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
  PrivateStateExport,
  PrivateStateId,
  PrivateStateProvider,
  SigningKeyExport,
} from "@midnight-ntwrk/midnight-js-types";

/*
 * Private state lives in this browser's localStorage, so a hospital's key and a
 * patient's claim codes survive page reloads. It never leaves the device.
 * (A production build would encrypt it or keep it in the wallet.)
 */

const PREFIX = "ward:v1";
const stateKey = (address: ContractAddress, id: string) => `${PREFIX}:state:${address}:${id}`;
const signingKeyKey = (address: ContractAddress) => `${PREFIX}:signing:${address}`;

// JSON with byte arrays written as hex, so Uint8Array fields round-trip.
const encode = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v instanceof Uint8Array ? { $bytes: Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("") } : v,
  );

const decode = <T>(text: string): T =>
  JSON.parse(text, (_key, v: unknown) => {
    if (v && typeof v === "object" && "$bytes" in v && typeof v.$bytes === "string") {
      const hex = (v as { $bytes: string }).$bytes;
      return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
    }
    return v;
  }) as T;

const statesFor = (address: ContractAddress): Array<[string, string]> => {
  const prefix = `${PREFIX}:state:${address}:`;
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) entries.push([key.slice(prefix.length), localStorage.getItem(key) ?? ""]);
  }
  return entries;
};

type ConflictCounts = { imported: number; skipped: number; overwritten: number };

export const browserPrivateStateProvider = <PSI extends PrivateStateId, PS = unknown>(): PrivateStateProvider<
  PSI,
  PS
> => {
  let contractAddress: ContractAddress | null = null;
  const current = (): ContractAddress => {
    if (contractAddress === null) throw new Error("Contract address not set before accessing private state");
    return contractAddress;
  };

  const importEntries = (
    entries: Array<[string, string]>,
    keyFor: (id: string) => string,
    strategy: "error" | "skip" | "overwrite",
  ): ConflictCounts => {
    const counts: ConflictCounts = { imported: 0, skipped: 0, overwritten: 0 };
    for (const [id, value] of entries) {
      const key = keyFor(id);
      if (localStorage.getItem(key) !== null) {
        if (strategy === "skip") {
          counts.skipped++;
          continue;
        }
        if (strategy === "error") throw new Error(`Private state conflict for '${id}'`);
        counts.overwritten++;
      } else {
        counts.imported++;
      }
      localStorage.setItem(key, value);
    }
    return counts;
  };

  return {
    setContractAddress(address: ContractAddress): void {
      contractAddress = address;
    },
    set(id: PSI, state: PS): Promise<void> {
      localStorage.setItem(stateKey(current(), id), encode(state));
      return Promise.resolve();
    },
    get(id: PSI): Promise<PS | null> {
      const stored = localStorage.getItem(stateKey(current(), id));
      return Promise.resolve(stored === null ? null : decode<PS>(stored));
    },
    remove(id: PSI): Promise<void> {
      localStorage.removeItem(stateKey(current(), id));
      return Promise.resolve();
    },
    clear(): Promise<void> {
      const address = current();
      for (const [id] of statesFor(address)) localStorage.removeItem(stateKey(address, id));
      return Promise.resolve();
    },
    setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      localStorage.setItem(signingKeyKey(address), encode(signingKey));
      return Promise.resolve();
    },
    getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      const stored = localStorage.getItem(signingKeyKey(address));
      return Promise.resolve(stored === null ? null : decode<SigningKey>(stored));
    },
    removeSigningKey(address: ContractAddress): Promise<void> {
      localStorage.removeItem(signingKeyKey(address));
      return Promise.resolve();
    },
    clearSigningKeys(): Promise<void> {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(`${PREFIX}:signing:`)) localStorage.removeItem(key);
      }
      return Promise.resolve();
    },
    exportPrivateStates(options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
      void options;
      const address = current();
      return Promise.resolve({
        format: "midnight-private-state-export",
        encryptedPayload: JSON.stringify({ contractAddress: address, states: Object.fromEntries(statesFor(address)) }),
        salt: "ward-browser-storage",
      });
    },
    importPrivateStates(
      exportData: PrivateStateExport,
      options?: ImportPrivateStatesOptions,
    ): Promise<ImportPrivateStatesResult> {
      try {
        const address = current();
        const payload = JSON.parse(exportData.encryptedPayload) as { states?: Record<string, string> };
        return Promise.resolve(
          importEntries(
            Object.entries(payload.states ?? {}),
            (id) => stateKey(address, id),
            options?.conflictStrategy ?? "error",
          ),
        );
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    exportSigningKeys(options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
      void options;
      const keys: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(`${PREFIX}:signing:`))
          keys[key.slice(`${PREFIX}:signing:`.length)] = localStorage.getItem(key) ?? "";
      }
      return Promise.resolve({
        format: "midnight-signing-key-export",
        encryptedPayload: JSON.stringify({ keys }),
        salt: "ward-browser-storage",
      });
    },
    importSigningKeys(
      exportData: SigningKeyExport,
      options?: ImportSigningKeysOptions,
    ): Promise<ImportSigningKeysResult> {
      try {
        const payload = JSON.parse(exportData.encryptedPayload) as { keys?: Record<string, string> };
        return Promise.resolve(
          importEntries(Object.entries(payload.keys ?? {}), signingKeyKey, options?.conflictStrategy ?? "error"),
        );
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
};
