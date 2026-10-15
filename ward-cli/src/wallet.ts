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
import { type FacadeState, type WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { type DustWalletOptions, type EnvironmentConfiguration, FluentWalletBuilder } from "@midnight-ntwrk/testkit-js";
import { type UnshieldedKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
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

export type Balances = { readonly night: bigint; readonly dust: bigint };

const balancesOf = (state: FacadeState): Balances => ({
  night: state.unshielded.balances[unshieldedToken().raw] ?? 0n,
  dust: state.dust.balance(new Date()),
});

/**
 * A headless wallet that pays fees and signs for Ward transactions sent from
 * the CLI. Built from the seed in ward-cli/.env.
 */
export class DeployerWallet implements MidnightProvider, WalletProvider {
  private constructor(
    private readonly logger: Logger,
    readonly wallet: WalletFacade,
    private readonly keystore: UnshieldedKeystore,
    private readonly zswapSecretKeys: ZswapSecretKeys,
    private readonly dustSecretKey: DustSecretKey,
  ) {}

  static async build(logger: Logger, env: EnvironmentConfiguration, seed: string): Promise<DeployerWallet> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: env.walletNetworkId === "undeployed" ? 500_000_000_000_000_000n : 1_000n,
      feeBlocksMargin: 5,
    };
    // testkit's published typings reference an internal path alias for the seed
    // type, so spell out the shape we rely on.
    const built: unknown = await FluentWalletBuilder.forEnvironment(env)
      .withDustOptions(dustOptions)
      .withSeed(seed)
      .buildWithoutStarting();
    const { wallet, seeds, keystore } = built as {
      wallet: WalletFacade;
      seeds: { shielded: Uint8Array; dust: Uint8Array };
      keystore: UnshieldedKeystore;
    };
    return new DeployerWallet(
      logger,
      wallet,
      keystore,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
    );
  }

  /** The unshielded address to send tNIGHT to (works before the wallet syncs). */
  address(): string {
    return this.keystore.getBech32Address().asString();
  }

  async start(): Promise<void> {
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    await this.wallet.stop();
  }

  /** Waits until the wallet has caught up with the chain, then returns its balances. */
  async sync(): Promise<Balances> {
    this.logger.info("Syncing wallet with the network (this can take a minute)...");
    const state = await Rx.firstValueFrom(this.wallet.state().pipe(Rx.throttleTime(2_000), Rx.filter(isSynced)));
    return balancesOf(state);
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
