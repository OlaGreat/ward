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

import { parseArgs } from "node:util";
import { WebSocket } from "ws";
import pino, { type Logger } from "pino";
import pinoPretty from "pino-pretty";
import * as Rx from "rxjs";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { logger as testkitLogger } from "@midnight-ntwrk/testkit-js";
import {
  BillStatus,
  WardAPI,
  type PrivateStateId,
  type WardCircuitKeys,
  type WardProviders,
} from "../../api/src/index";
import { NIGHT_TOKEN, formatNight, fromHex, parseNight, toHex } from "../../api/src/utils/index.js";
import { type WardPrivateState, pureCircuits } from "../../contract/src/index";
import {
  type NetworkName,
  environment,
  networkName,
  persistentSecret,
  readDeployment,
  saveDeployment,
  strongPassword,
  zkConfigPath,
} from "./config.js";
import { DeployerWallet } from "./wallet.js";

// The indexer client subscribes over WebSockets.
// @ts-expect-error: assigning the Node implementation to the browser global
globalThis.WebSocket = WebSocket;

const logger: Logger = pino(
  { level: process.env.WARD_LOG_LEVEL ?? "info" },
  pinoPretty({ colorize: true, sync: true, ignore: "pid,hostname" }),
);

// The SDK test kit logs connection settings, including endpoint URLs that carry
// the Blockfrost project ID, at "info". Keep it to warnings unless debugging.
testkitLogger.level = process.env.WARD_LOG_LEVEL === "debug" ? "debug" : "warn";

/** Masks the Blockfrost project ID wherever it might appear in printed text. */
const redact = (text: string): string => {
  const projectId = process.env.BLOCKFROST_PROJECT_ID?.trim();
  return projectId ? text.split(projectId).join("***") : text;
};

const say = (message = ""): void => console.log(redact(message));

const statusLabel: Record<BillStatus, string> = {
  [BillStatus.ISSUED]: "issued, waiting for the patient",
  [BillStatus.FUNDRAISING]: "fundraising",
  [BillStatus.FUNDED]: "fully funded",
  [BillStatus.CANCELLED]: "cancelled",
};

const HELP = `Ward CLI

Usage: npm run ward -- <command> [options]

Wallet and deployment
  address                 Show the deployer wallet address to fund with tNIGHT
  balance                 Sync the wallet, register NIGHT for DUST fees, show balances
  deploy                  Deploy a new Ward instance; this CLI becomes its operator
  status                  Show hospitals and bills of the recorded deployment
  whoami                  Show this CLI's operator and hospital keys

Operator
  register-hospital --key <hex> --name <text> --payout <mn_addr...>
  set-hospital-active --key <hex> --active <true|false>

Hospital, patient and donor actions (signed by this CLI)
  issue-bill --amount <NIGHT>
  open-fundraiser --claim <claim> --title <text>
  donate --bill <id> --amount <NIGHT>
  confirm-treatment --bill <id>
  cancel-bill --bill <id>

  smoke-test              Run the full flow on the network: register this CLI as a
                          hospital, issue a bill, open the fundraiser, donate, confirm

Configuration lives in ward-cli/.env (see .env.example). WARD_NETWORK selects
preprod (default), preview or undeployed.`;

const operatorSecret = (): Uint8Array => fromHex(persistentSecret("WARD_OPERATOR_SECRET"));

type Session = {
  readonly network: NetworkName;
  readonly wallet: DeployerWallet;
  readonly providers: WardProviders;
};

/** Starts the wallet, makes sure it can pay fees, and builds the contract providers. */
const openSession = async (network: NetworkName): Promise<Session> => {
  const env = environment(network);
  const seed = persistentSecret("WARD_WALLET_SEED");
  const wallet = await DeployerWallet.build(logger, env, seed);
  await wallet.start();

  const { night } = await wallet.sync();
  if (night === 0n) {
    say(`\nThis wallet has no tNIGHT yet. Fund it from the faucet, then run the command again:`);
    say(`  address: ${wallet.address()}`);
    say(`  faucet:  ${env.faucet ?? "(none for this network)"}`);
    say(`\nWaiting for funds (Ctrl+C to stop)...`);
    await wallet.waitForNight();
  }
  const dust = await wallet.ensureDust();
  logger.info(`DUST available for fees: ${dust}`);

  const zkConfigProvider = new NodeZkConfigProvider<WardCircuitKeys>(zkConfigPath);
  const providers: WardProviders = {
    privateStateProvider: levelPrivateStateProvider<PrivateStateId, WardPrivateState>({
      privateStateStoreName: `ward-${network}-private-state`,
      signingKeyStoreName: `ward-${network}-signing-keys`,
      privateStoragePasswordProvider: () => persistentSecret("WARD_STATE_PASSWORD", strongPassword),
      accountId: wallet.address(),
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(env.proofServer, zkConfigProvider),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
  return { network, wallet, providers };
};

const joinRecorded = (session: Session): Promise<WardAPI> =>
  WardAPI.join(session.providers, readDeployment(session.network).contractAddress, logger, {
    secretKey: operatorSecret(),
  });

const latestState = (api: WardAPI) => Rx.firstValueFrom(api.state$);

const printStatus = async (api: WardAPI): Promise<void> => {
  const state = await latestState(api);
  say(`\nWard at ${state.contractAddress}`);
  say(`  bills issued: ${state.billCount}   total donated: ${formatNight(state.totalRaised)} NIGHT`);
  say(`  this CLI is ${state.isOperator ? "" : "not "}the operator`);
  say(`\nHospitals (${state.hospitals.length})`);
  for (const h of state.hospitals) {
    say(`  ${h.active ? "active   " : "suspended"} ${h.name}`);
    say(`            key ${h.key}`);
    say(`            payouts to ${h.payoutAddress}`);
  }
  say(`\nBills (${state.bills.length})`);
  for (const b of state.bills) {
    say(`  ${b.id}`);
    say(`    ${b.title ?? "(no fundraiser yet)"} — ${b.hospitalName}`);
    say(
      `    ${formatNight(b.raised)} of ${formatNight(b.amountDue)} NIGHT, ${statusLabel[b.status]}${b.treatmentComplete ? ", treatment completed" : ""}`,
    );
  }
};

const required = (values: Record<string, string | boolean | undefined>, name: string): string => {
  const value = values[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing --${name}. Run "npm run ward -- help" for usage.`);
  }
  return value;
};

const main = async (): Promise<void> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      key: { type: "string" },
      name: { type: "string" },
      payout: { type: "string" },
      active: { type: "string" },
      amount: { type: "string" },
      claim: { type: "string" },
      title: { type: "string" },
      bill: { type: "string" },
    },
  });
  const command = positionals[0] ?? "help";
  if (command === "help") {
    say(HELP);
    return;
  }

  const network = networkName();

  if (command === "address") {
    const env = environment(network, { offline: true });
    const wallet = await DeployerWallet.build(logger, env, persistentSecret("WARD_WALLET_SEED"));
    say(`Deployer wallet on ${network}: ${wallet.address()}`);
    say(`Fund it with tNIGHT from ${env.faucet ?? "your local devnet"}`);
    return;
  }

  if (command === "whoami") {
    const secret = operatorSecret();
    say(`operator key: ${toHex(pureCircuits.operatorKey(secret))}`);
    say(`hospital key: ${toHex(pureCircuits.hospitalKey(secret))}`);
    return;
  }

  const session = await openSession(network);
  try {
    switch (command) {
      case "balance": {
        const balances = await session.wallet.sync();
        say(`address: ${session.wallet.address()}`);
        say(`NIGHT:   ${formatNight(balances.night)}`);
        say(`DUST:    ${balances.dust}`);
        break;
      }
      case "deploy": {
        const secret = operatorSecret();
        const api = await WardAPI.deploy(
          session.providers,
          { donationToken: NIGHT_TOKEN, operatorSecret: secret },
          logger,
        );
        const file = saveDeployment({
          network,
          contractAddress: api.deployedContractAddress,
          txHash: api.deployedContract.deployTxData.public.txHash,
          deployedAt: new Date().toISOString(),
          operatorKey: toHex(pureCircuits.operatorKey(secret)),
          donationToken: toHex(NIGHT_TOKEN),
        });
        say(`\nWard deployed on ${network} at ${api.deployedContractAddress}`);
        say(`Recorded in ${file}`);
        break;
      }
      case "status":
        await printStatus(await joinRecorded(session));
        break;
      case "register-hospital": {
        const api = await joinRecorded(session);
        const tx = await api.registerHospital(
          required(values, "key"),
          required(values, "name"),
          required(values, "payout"),
        );
        say(`Hospital registered (tx ${tx})`);
        break;
      }
      case "set-hospital-active": {
        const active = required(values, "active") === "true";
        const tx = await (await joinRecorded(session)).setHospitalActive(required(values, "key"), active);
        say(`Hospital ${active ? "activated" : "suspended"} (tx ${tx})`);
        break;
      }
      case "issue-bill": {
        const bill = await (await joinRecorded(session)).issueBill(parseNight(required(values, "amount")));
        say(`Bill ${bill.billId} issued (tx ${bill.txHash})`);
        say(`Give this claim to the patient (it is the only way to open the fundraiser):\n  ${bill.claim}`);
        break;
      }
      case "open-fundraiser": {
        const tx = await (
          await joinRecorded(session)
        ).openFundraiser(required(values, "claim"), required(values, "title"));
        say(`Fundraiser opened (tx ${tx})`);
        break;
      }
      case "donate": {
        const tx = await (
          await joinRecorded(session)
        ).donate(required(values, "bill"), parseNight(required(values, "amount")));
        say(`Donation sent to the hospital (tx ${tx})`);
        break;
      }
      case "confirm-treatment": {
        const tx = await (await joinRecorded(session)).confirmTreatment(required(values, "bill"));
        say(`Treatment confirmed (tx ${tx})`);
        break;
      }
      case "cancel-bill": {
        const tx = await (await joinRecorded(session)).cancelBill(required(values, "bill"));
        say(`Bill cancelled (tx ${tx})`);
        break;
      }
      case "smoke-test": {
        const api = await joinRecorded(session);
        const state = await latestState(api);
        if (!state.isOperator) throw new Error("The smoke test must run from the operator's CLI");
        if (!state.myHospital) {
          say("1/5 registering this CLI as a test hospital...");
          await api.registerHospital(state.myHospitalKey, "Ward Smoke Test Clinic", session.wallet.address());
        }
        say("2/5 issuing a 5 NIGHT bill...");
        const bill = await api.issueBill(parseNight("5"));
        say("3/5 opening the fundraiser with the claim...");
        await api.openFundraiser(bill.claim, "Smoke test fundraiser");
        say("4/5 donating 5 NIGHT (forwarded to the hospital payout address)...");
        await api.donate(bill.billId, parseNight("5"));
        say("5/5 confirming treatment...");
        await api.confirmTreatment(bill.billId);
        const final = (await latestState(api)).bills.find((b) => b.id === bill.billId);
        say(`\nSmoke test passed: bill ${bill.billId} is ${final ? statusLabel[final.status] : "missing"}`);
        break;
      }
      default:
        say(`Unknown command "${command}".\n`);
        say(HELP);
        process.exitCode = 1;
    }
  } finally {
    await session.wallet.stop();
  }
};

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error: unknown) => {
    console.error(redact(`\nError: ${error instanceof Error ? error.message : String(error)}`));
    logger.debug(error);
    process.exit(1);
  },
);
