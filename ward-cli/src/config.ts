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

import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { validatePassword } from "@midnight-ntwrk/midnight-js-utils";
import type { EnvironmentConfiguration } from "@midnight-ntwrk/testkit-js";
import { randomBytes, toHex } from "../../api/src/utils/index.js";

export type NetworkName = "preprod" | "preview" | "undeployed";

export const cliDir = path.resolve(new URL(import.meta.url).pathname, "..", "..");
export const envFile = path.join(cliDir, ".env");
export const zkConfigPath = path.resolve(cliDir, "..", "contract", "src", "managed", "ward");
export const deploymentFile = (network: NetworkName) => path.join(cliDir, "deployments", `${network}.json`);

export const networkName = (): NetworkName => {
  const value = (process.env.WARD_NETWORK ?? "preprod").trim();
  if (value !== "preprod" && value !== "preview" && value !== "undeployed") {
    throw new Error(`WARD_NETWORK must be preprod, preview or undeployed (got "${value}")`);
  }
  setNetworkId(value);
  return value;
};

const proofServer = () => process.env.WARD_PROOF_SERVER?.trim() || "http://localhost:6300";

/** Endpoints for the selected network. Preprod is served by Blockfrost and needs a project ID to connect. */
export const environment = (network: NetworkName, options: { offline?: boolean } = {}): EnvironmentConfiguration => {
  switch (network) {
    case "preprod": {
      // Offline commands (such as showing the wallet address) never connect, so they
      // do not need a Blockfrost project ID.
      const projectId = process.env.BLOCKFROST_PROJECT_ID?.trim() || (options.offline ? "offline" : undefined);
      if (!projectId) {
        throw new Error(
          "BLOCKFROST_PROJECT_ID is not set. Create a free 'Midnight Preprod' project at https://blockfrost.io and add its ID to ward-cli/.env",
        );
      }
      const withKey = (url: string) => `${url}?project_id=${encodeURIComponent(projectId)}`;
      return {
        walletNetworkId: "preprod",
        networkId: "preprod",
        indexer: withKey("https://midnight-preprod.blockfrost.io/api/v0"),
        indexerWS: withKey("wss://midnight-preprod.blockfrost.io/api/v0/ws"),
        node: withKey("https://rpc.midnight-preprod.blockfrost.io"),
        nodeWS: withKey("wss://rpc.midnight-preprod.blockfrost.io"),
        faucet: "https://faucet.preprod.midnight.network",
        proofServer: proofServer(),
      };
    }
    case "preview":
      return {
        walletNetworkId: "preview",
        networkId: "preview",
        indexer: "https://indexer.preview.midnight.network/api/v4/graphql",
        indexerWS: "wss://indexer.preview.midnight.network/api/v4/graphql/ws",
        node: "https://rpc.preview.midnight.network",
        nodeWS: "wss://rpc.preview.midnight.network",
        faucet: "https://midnight-tmnight-preview.nethermind.dev/",
        proofServer: proofServer(),
      };
    case "undeployed":
      return {
        walletNetworkId: "undeployed",
        networkId: "undeployed",
        indexer: "http://127.0.0.1:8088/api/v4/graphql",
        indexerWS: "ws://127.0.0.1:8088/api/v4/graphql/ws",
        node: "http://127.0.0.1:9944",
        nodeWS: "ws://127.0.0.1:9944",
        faucet: undefined,
        proofServer: proofServer(),
      };
  }
};

/**
 * Reads a secret from the environment, generating and saving it to ward-cli/.env
 * on first use. The file is git-ignored; secrets are never printed.
 */
export const persistentSecret = (name: string, generate: () => string = () => toHex(randomBytes(32))): string => {
  const existing = process.env[name]?.trim();
  if (existing) return existing;
  const value = generate();
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const line = `${name}=${value}`;
  const updated = new RegExp(`^${name}=.*$`, "m").test(current)
    ? current.replace(new RegExp(`^${name}=.*$`, "m"), line)
    : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`;
  writeFileSync(envFile, updated, { mode: 0o600 });
  process.env[name] = value;
  return value;
};

/** A random password that meets the private state store's strength policy. */
export const strongPassword = (): string => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%^*-_=+";
  for (;;) {
    const candidate = Array.from(randomBytes(28), (b) => alphabet[b % alphabet.length]).join("");
    try {
      validatePassword(candidate);
      return candidate;
    } catch {
      // Rare: retry until the random draw satisfies every rule.
    }
  }
};

export type Deployment = {
  readonly network: NetworkName;
  readonly contractAddress: string;
  readonly txHash: string;
  readonly deployedAt: string;
  readonly operatorKey: string;
  readonly donationToken: string;
};

export const readDeployment = (network: NetworkName): Deployment => {
  const file = deploymentFile(network);
  if (!existsSync(file)) {
    throw new Error(`No Ward deployment recorded for ${network}. Run "npm run ward -- deploy" first.`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
};

export const saveDeployment = (deployment: Deployment): string => {
  const file = deploymentFile(deployment.network);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(deployment, null, 2) + "\n");
  return file;
};
