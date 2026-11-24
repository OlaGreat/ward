// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// Adapted from midnightntwrk/midnight-examples (Copyright (C) Midnight Foundation).
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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { unshieldedToken } from "@midnight-ntwrk/midnight-js-protocol/v9";
import {
  DEFAULT_DUST_OPTIONS,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
  MidnightWalletProvider,
  syncWallet,
} from "@midnight-ntwrk/testkit-js";
import {
  DustWallet,
  type FacadeState,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
} from "@midnightntwrk/wallet-sdk";
import * as Rx from "rxjs";
import type { Logger } from "pino";

export type Balances = { readonly night: bigint; readonly dust: bigint };

/** Where a saved state was synced: the indexer host and a block on its chain. */
type ChainStamp = { indexer: string; height: number; blockHash: string };
type SavedWalletState = { version: 2; chain: ChainStamp; shielded: string; unshielded: string; dust: string };

const SAVE_EVERY_MS = 60_000;
const NIGHT = unshieldedToken().raw;

const balancesOf = (state: FacadeState): Balances => ({
  night: state.unshielded.balances[NIGHT] ?? 0n,
  dust: state.dust.balance(new Date()),
});

const indexerQuery = async <T>(indexerHttpUrl: string, query: string): Promise<T | undefined> => {
  try {
    const res = await fetch(indexerHttpUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok ? ((await res.json()) as { data?: T }).data : undefined;
  } catch {
    return undefined;
  }
};

const readChainStamp = async (indexerHttpUrl: string): Promise<ChainStamp | undefined> => {
  const data = await indexerQuery<{ block?: { height?: number; hash?: string } | null }>(
    indexerHttpUrl,
    "{ block { height hash } }",
  );
  const height = data?.block?.height;
  const blockHash = data?.block?.hash;
  if (typeof height !== "number" || height <= 0 || typeof blockHash !== "string") return undefined;
  return { indexer: new URL(indexerHttpUrl).host, height, blockHash };
};

/** Null when the saved state belongs to this indexer's chain, otherwise the reason it doesn't. */
const checkChainStamp = async (indexerHttpUrl: string, stamp: ChainStamp): Promise<string | null> => {
  const host = new URL(indexerHttpUrl).host;
  if (stamp.indexer !== host) return `it was synced against ${stamp.indexer}, not ${host}`;
  const data = await indexerQuery<{ block?: { hash?: string } | null }>(
    indexerHttpUrl,
    `{ block(offset: { height: ${Math.trunc(stamp.height)} }) { hash } }`,
  );
  if (data?.block?.hash !== stamp.blockHash) return `block ${stamp.height} no longer matches (was the network reset?)`;
  return null;
};

/**
 * A fresh wallet on a chain that crossed the ledger 9 upgrade can start at the upgrade
 * instead of replaying every ledger 8 DUST event. testkit keeps the builder's
 * configuration private, so the flag is set there (as midnight-examples does).
 */
const skipLedgerV8DustHistory = (builder: FluentWalletBuilder): void => {
  (builder as unknown as { config: { skipLedgerV8DustHistory?: boolean } }).config.skipLedgerV8DustHistory = true;
};

/** The three sub-wallets restored from a saved state, configured as testkit configures new ones. */
const restoreFacade = async (builder: FluentWalletBuilder, saved: SavedWalletState): Promise<WalletFacade> => {
  const config = (builder as unknown as { config: Parameters<typeof ShieldedWallet>[0] }).config;
  const shielded = ShieldedWallet(config).restore(saved.shielded);
  const unshielded = UnshieldedWallet({
    ...config,
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  }).restore(saved.unshielded);
  const dust = DustWallet({
    ...config,
    costParameters: {
      ledgerParams: DEFAULT_DUST_OPTIONS.ledgerParams,
      additionalFeeOverhead: DEFAULT_DUST_OPTIONS.additionalFeeOverhead,
      feeBlocksMargin: DEFAULT_DUST_OPTIONS.feeBlocksMargin,
    },
  } as Parameters<typeof DustWallet>[0]).restore(saved.dust);
  return WalletFacade.init({
    configuration: config as Parameters<typeof WalletFacade.init>[0]["configuration"],
    shielded: () => shielded,
    unshielded: () => unshielded,
    dust: () => dust,
  });
};

const PROTOCOL_VERSION_MISMATCH =
  "@midnightntwrk/wallet-sdk-abstractions/WalletTransaction/ProtocolVersionMismatchError";

/**
 * A headless wallet that pays fees and signs for Ward transactions sent from the CLI.
 * Built from the seed in ward-cli/.env. `provider` serves as both the wallet and the
 * midnight provider for Midnight.js.
 */
export class DeployerWallet {
  #saveTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly logger: Logger,
    private readonly env: EnvironmentConfiguration,
    readonly provider: MidnightWalletProvider,
    private readonly stateFile: string | undefined,
  ) {}

  get wallet(): WalletFacade {
    return this.provider.wallet;
  }

  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    seed: string,
    stateFile?: string,
  ): Promise<DeployerWallet> {
    const builder = FluentWalletBuilder.forEnvironment(env).withSeed(seed);
    skipLedgerV8DustHistory(builder);
    const { wallet: fresh, seeds, keystore } = await builder.buildWithoutStarting();
    let wallet = fresh;
    if (stateFile && existsSync(stateFile)) {
      try {
        const saved = JSON.parse(readFileSync(stateFile, "utf8")) as SavedWalletState;
        const mismatch = saved.version === 2 ? await checkChainStamp(env.indexer, saved.chain) : "unknown format";
        if (mismatch) {
          logger.warn(`Not resuming saved wallet state: ${mismatch}. Syncing from the start.`);
        } else {
          wallet = await restoreFacade(builder, saved);
          logger.info(`Resuming wallet sync from block ${saved.chain.height}`);
        }
      } catch (error) {
        logger.warn(`Could not read saved wallet state (${String(error)}); syncing from the start.`);
      }
    }
    const provider = await MidnightWalletProvider.withWallet(logger, env, wallet, seeds, keystore);
    return new DeployerWallet(logger, env, provider, stateFile);
  }

  async saveState(): Promise<void> {
    if (!this.stateFile) return;
    const chain = await readChainStamp(this.env.indexer);
    if (!chain) return; // an unstamped save could never be checked, so keep the previous file
    const state: SavedWalletState = {
      version: 2,
      chain,
      shielded: await this.wallet.shielded.serializeState(),
      unshielded: await this.wallet.unshielded.serializeState(),
      dust: await this.wallet.dust.serializeState(),
    };
    mkdirSync(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.tmp`;
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    renameSync(temporary, this.stateFile);
  }

  address(): string {
    return String(this.provider.unshieldedKeystore.getBech32Address());
  }

  async start(): Promise<void> {
    await this.provider.start(false);
    this.#saveTimer = setInterval(() => {
      this.saveState().catch((error: unknown) => this.logger.warn({ error }, "Could not save wallet state"));
    }, SAVE_EVERY_MS);
  }

  async stop(): Promise<void> {
    clearInterval(this.#saveTimer);
    await this.saveState().catch((error: unknown) => this.logger.warn({ error }, "Could not save wallet state"));
    await this.provider.stop();
  }

  async sync(): Promise<Balances> {
    this.logger.info("Syncing wallet with the network...");
    const state = await syncWallet(this.wallet, 2_000, 30 * 60_000);
    await this.saveState();
    return balancesOf(state);
  }

  async waitForNight(): Promise<bigint> {
    const state = await Rx.firstValueFrom(
      this.wallet.state().pipe(
        Rx.throttleTime(2_000),
        Rx.filter((s) => balancesOf(s).night > 0n),
      ),
    );
    return balancesOf(state).night;
  }

  /** Registers unregistered NIGHT for DUST generation, then waits for DUST to spend on fees. */
  async ensureDust(): Promise<bigint> {
    // Registration needs the wallets settled on one side of a protocol boundary.
    const state = await Rx.firstValueFrom(
      this.wallet.state().pipe(Rx.filter((s: FacadeState) => s.protocol._tag === "Settled")),
    );
    const keystore = this.provider.unshieldedKeystore;
    const unregistered = state.unshielded.availableCoins.filter(
      (coin) => coin.utxo.type === NIGHT && !coin.meta.registeredForDustGeneration,
    );
    if (unregistered.length > 0) {
      this.logger.info(`Registering ${unregistered.length} NIGHT output(s) to generate DUST for fees...`);
      for (let attempt = 1; ; attempt++) {
        try {
          const recipe = await this.wallet.registerNightUtxosForDustGeneration(
            unregistered,
            keystore.getPublicKey(),
            (payload) => Promise.resolve(keystore.signData(payload)),
          );
          const txId = await this.wallet.submitTransaction(await this.wallet.finalizeRecipe(recipe));
          this.logger.info(`DUST registration submitted: ${txId}`);
          break;
        } catch (error) {
          const tag = (error as { _tag?: unknown } | null)?._tag;
          if (tag !== PROTOCOL_VERSION_MISMATCH || attempt >= 10) throw error;
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    }
    const withDust = await Rx.firstValueFrom(
      this.wallet.state().pipe(
        Rx.throttleTime(2_000),
        Rx.filter((s) => balancesOf(s).dust > 0n),
      ),
    );
    return balancesOf(withDust).dust;
  }
}
