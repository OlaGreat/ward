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

import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
  unshieldedToken,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { type MidnightProvider, type UnboundTransaction, type WalletProvider } from "@midnight-ntwrk/midnight-js-types";
import { ttlOneHour } from "@midnight-ntwrk/midnight-js-utils";
import { type FacadeState, WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { type EnvironmentConfiguration, WalletSeeds } from "@midnight-ntwrk/testkit-js";
import {
  DustWallet,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  createKeystore,
  mergeWalletEntries,
} from "@midnight-ntwrk/wallet-sdk";
import { type UnshieldedKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as Rx from "rxjs";
import type { Logger } from "pino";

const isComplete = (progress: unknown): boolean => {
  const candidate = progress as { isStrictlyComplete?: () => boolean } | undefined;
  return typeof candidate?.isStrictlyComplete === "function" && candidate.isStrictlyComplete();
};

const isSynced = (state: FacadeState): boolean =>
  isComplete(state.shielded.state.progress) &&
  isComplete(state.dust.state.progress) &&
  isComplete(state.unshielded.progress);

/** Share of the chain each wallet component has processed, as a percentage. */
export type SyncProgress = {
  readonly shielded: number;
  readonly dust: number;
  readonly synced: boolean;
  readonly night: bigint;
};

const percent = (progress: unknown): number => {
  if (isComplete(progress)) return 100;
  const p = progress as { appliedIndex?: bigint | number; highestRelevantWalletIndex?: bigint | number } | undefined;
  const applied = Number(p?.appliedIndex ?? 0);
  const target = Number(p?.highestRelevantWalletIndex ?? 0);
  return target > 0 ? Math.min(99.9, (applied / target) * 100) : 0;
};

const progressOf = (state: FacadeState): SyncProgress => ({
  shielded: percent(state.shielded.state.progress),
  dust: percent(state.dust.state.progress),
  synced: isSynced(state),
  night: state.unshielded.balances[unshieldedToken().raw] ?? 0n,
});

export type Balances = { readonly night: bigint; readonly dust: bigint };

type SavedWalletState = { shielded?: string; unshielded?: string; dust?: string };

const SAVE_EVERY_MS = 60_000;

const balancesOf = (state: FacadeState): Balances => ({
  night: state.unshielded.balances[unshieldedToken().raw] ?? 0n,
  dust: state.dust.balance(new Date()),
});

/**
 * A headless wallet that pays fees and signs for Ward transactions sent from
 * the CLI. Built from the seed in ward-cli/.env.
 */
export class DeployerWallet implements MidnightProvider, WalletProvider {
  #saveTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly logger: Logger,
    readonly wallet: WalletFacade,
    private readonly keystore: UnshieldedKeystore,
    private readonly zswapSecretKeys: ZswapSecretKeys,
    private readonly dustSecretKey: DustSecretKey,
    private readonly stateFile: string | undefined,
  ) {}

  /**
   * Builds the wallet from its seed. When `stateFile` holds a previous sync,
   * each component resumes from it instead of replaying the chain from the
   * start (a fresh DUST sync on Preprod takes hours).
   */
  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    seed: string,
    stateFile?: string,
  ): Promise<DeployerWallet> {
    const seeds = WalletSeeds.fromMasterSeed(seed);
    const keystore = createKeystore(seeds.unshielded, env.walletNetworkId);
    const history = () => new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
    const configuration = {
      indexerClientConnection: { indexerHttpUrl: env.indexer, indexerWsUrl: env.indexerWS },
      provingServerUrl: new URL(env.proofServer),
      networkId: env.walletNetworkId,
      relayURL: new URL(env.nodeWS),
      txHistoryStorage: history(),
      costParameters: { feeBlocksMargin: 5 },
    };
    const dustConfiguration = {
      ...configuration,
      costParameters: {
        ledgerParams: LedgerParameters.initialParameters(),
        additionalFeeOverhead: env.walletNetworkId === "undeployed" ? 500_000_000_000_000_000n : 1_000n,
        feeBlocksMargin: 5,
      },
    };

    const saved: SavedWalletState =
      stateFile && existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as SavedWalletState) : {};
    if (saved.dust) logger.info("Resuming wallet sync from saved progress");

    const Shielded = ShieldedWallet(configuration);
    const Unshielded = UnshieldedWallet({ ...configuration, txHistoryStorage: history() });
    const Dust = DustWallet(dustConfiguration);
    const shielded = saved.shielded ? Shielded.restore(saved.shielded) : Shielded.startWithSeed(seeds.shielded);
    const unshielded = saved.unshielded
      ? Unshielded.restore(saved.unshielded)
      : Unshielded.startWithPublicKey(PublicKey.fromKeyStore(keystore));
    const dust = saved.dust
      ? Dust.restore(saved.dust)
      : Dust.startWithSeed(seeds.dust, LedgerParameters.initialParameters().dust);

    const wallet = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
    });
    return new DeployerWallet(
      logger,
      wallet,
      keystore,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      stateFile,
    );
  }

  /** Writes the current sync progress to disk (atomically; owner-only permissions). */
  async saveState(): Promise<void> {
    if (!this.stateFile) return;
    const state: SavedWalletState = {
      shielded: await this.wallet.shielded.serializeState(),
      unshielded: await this.wallet.unshielded.serializeState(),
      dust: await this.wallet.dust.serializeState(),
    };
    mkdirSync(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.tmp`;
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    renameSync(temporary, this.stateFile);
  }

  /** The unshielded address to send tNIGHT to (works before the wallet syncs). */
  address(): string {
    return this.keystore.getBech32Address().asString();
  }

  async start(): Promise<void> {
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
    this.#saveTimer = setInterval(() => {
      this.saveState().catch((error: unknown) => this.logger.warn({ error }, "Could not save wallet state"));
    }, SAVE_EVERY_MS);
  }

  async stop(): Promise<void> {
    clearInterval(this.#saveTimer);
    await this.saveState().catch((error: unknown) => this.logger.warn({ error }, "Could not save wallet state"));
    await this.wallet.stop();
  }

  /** Emits sync progress, at most every `intervalMs`. */
  progress$(intervalMs = 30_000): Rx.Observable<SyncProgress> {
    return this.wallet.state().pipe(Rx.throttleTime(intervalMs), Rx.map(progressOf));
  }

  /** Waits until the wallet has caught up with the chain, then returns its balances. */
  async sync(): Promise<Balances> {
    this.logger.info("Syncing wallet with the network...");
    const reporter = this.progress$().subscribe((p) => {
      if (!p.synced) {
        this.logger.info(
          `Sync progress: shielded ${p.shielded.toFixed(1)}%, fee (DUST) ${p.dust.toFixed(1)}%, NIGHT balance ${p.night / 1_000_000n}`,
        );
      }
    });
    try {
      const state = await Rx.firstValueFrom(this.wallet.state().pipe(Rx.throttleTime(2_000), Rx.filter(isSynced)));
      await this.saveState();
      return balancesOf(state);
    } finally {
      reporter.unsubscribe();
    }
  }

  /** Waits for tNIGHT to arrive, polling the synced wallet state. */
  async waitForNight(): Promise<bigint> {
    const state = await Rx.firstValueFrom(
      this.wallet.state().pipe(
        Rx.throttleTime(2_000),
        Rx.filter((s) => isSynced(s) && balancesOf(s).night > 0n),
      ),
    );
    return balancesOf(state).night;
  }

  /**
   * Registers any NIGHT not yet generating DUST. DUST pays transaction fees and
   * accrues over time from registered NIGHT. Returns the DUST balance once positive.
   */
  async ensureDust(): Promise<bigint> {
    const state = await Rx.firstValueFrom(this.wallet.state().pipe(Rx.filter(isSynced)));
    const unregistered = state.unshielded.availableCoins.filter((coin) => !coin.meta.registeredForDustGeneration);
    if (unregistered.length > 0) {
      this.logger.info(`Registering ${unregistered.length} NIGHT output(s) to generate DUST for fees...`);
      const dustState = await this.wallet.dust.waitForSyncedState();
      const recipe = await this.wallet.registerNightUtxosForDustGeneration(
        unregistered,
        this.keystore.getPublicKey(),
        (payload) => this.keystore.signData(payload),
        dustState.address,
      );
      const txId = await this.wallet.submitTransaction(await this.wallet.finalizeRecipe(recipe));
      this.logger.info(`DUST registration submitted: ${txId}`);
    }
    const withDust = await Rx.firstValueFrom(
      this.wallet.state().pipe(
        Rx.throttleTime(2_000),
        Rx.filter((s) => balancesOf(s).dust > 0n),
      ),
    );
    return balancesOf(withDust).dust;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.zswapSecretKeys, dustSecretKey: this.dustSecretKey },
      { ttl },
    );
    const signed = await this.wallet.signRecipe(recipe, (payload) => this.keystore.signData(payload));
    return this.wallet.finalizeRecipe(signed);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }
}
