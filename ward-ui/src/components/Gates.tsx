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

import { useState, type ReactNode } from "react";
import { Loader2, Rocket, Wallet } from "lucide-react";
import { useWallet } from "../hooks/wallet";
import { useWard } from "../hooks/ward";
import { Button, Card, Field, Notice } from "./ui";

function ConnectPrompt() {
  const wallet = useWallet();
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto mb-4 w-fit rounded-full bg-ward-soft p-3 text-ward">
        <Wallet className="size-6" aria-hidden />
      </div>
      <h2 className="text-2xl font-semibold">Connect your Lace wallet</h2>
      <p className="mt-2 text-muted">
        Ward reads live fundraisers from Midnight {import.meta.env.VITE_NETWORK_ID} through your wallet, and every
        action is a transaction you approve in Lace.
      </p>
      {wallet.error && (
        <Notice tone="care" className="mt-5 text-left">
          {wallet.error}
        </Notice>
      )}
      <Button size="lg" className="mt-6" onClick={() => void wallet.connect()} loading={wallet.status === "connecting"}>
        Connect Lace
      </Button>
      {wallet.status === "missing" && (
        <div className="mt-4">
          <GetLace />
        </div>
      )}
    </Card>
  );
}

const GetLace = () => (
  <p className="text-sm text-muted">
    Get Lace from the{" "}
    <a
      className="font-medium text-ward underline"
      href="https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk"
      target="_blank"
      rel="noreferrer"
    >
      Chrome Web Store
    </a>{" "}
    and switch it to {import.meta.env.VITE_NETWORK_ID}.
  </p>
);

/**
 * The submit button of a form that sends a transaction. Fundraisers can be read
 * without a wallet, so until Lace is connected this asks for it instead.
 */
export function WalletSubmit({ action, loading, children }: { action: string; loading: boolean; children: ReactNode }) {
  const wallet = useWallet();
  if (wallet.status === "connected") {
    return (
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        {children}
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      {wallet.error && <Notice tone="care">{wallet.error}</Notice>}
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={() => void wallet.connect()}
        loading={wallet.status === "connecting"}
      >
        <Wallet className="size-4" aria-hidden />
        Connect Lace to {action}
      </Button>
      {wallet.status === "missing" && <GetLace />}
    </div>
  );
}

function ChooseInstance() {
  const { selectContract, deployInstance, error } = useWard();
  const [address, setAddress] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  const deploy = async () => {
    setDeploying(true);
    setDeployError(null);
    try {
      await deployInstance();
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
      <Card className="p-6">
        <h2 className="text-xl font-semibold">Open a Ward instance</h2>
        <p className="mt-1 text-sm text-muted">Paste the contract address of an existing deployment.</p>
        <form
          className="mt-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (address.trim()) selectContract(address);
          }}
        >
          <Field label="Contract address" value={address} onChange={(e) => setAddress(e.target.value)} />
          {error && <Notice tone="care">{error}</Notice>}
          <Button type="submit" className="w-full" disabled={!address.trim()}>
            Open
          </Button>
        </form>
      </Card>
      <Card className="p-6">
        <h2 className="text-xl font-semibold">Deploy your own</h2>
        <p className="mt-1 text-sm text-muted">
          Start a fresh Ward instance with this wallet as its operator, then register yourself as a test hospital to try
          the whole flow.
        </p>
        {deployError && (
          <Notice tone="care" className="mt-4">
            {deployError}
          </Notice>
        )}
        <Button variant="secondary" className="mt-5 w-full" onClick={() => void deploy()} loading={deploying}>
          <Rocket className="size-4" aria-hidden />
          Deploy a new instance
        </Button>
      </Card>
    </div>
  );
}

/** Renders `children` only once a wallet is connected and a Ward instance is open. */
export function RequireWard({ children }: { children: ReactNode }) {
  const { status, error, forgetContract } = useWard();
  if (status === "needs-wallet") return <ConnectPrompt />;
  if (status === "needs-contract") return <ChooseInstance />;
  if (status === "error") {
    return (
      <Card className="mx-auto max-w-xl p-6">
        <Notice tone="care" title="Something went wrong">
          {error}
        </Notice>
        <Button variant="secondary" className="mt-4" onClick={forgetContract}>
          Choose another instance
        </Button>
      </Card>
    );
  }
  if (status === "joining") {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        Loading Ward from Midnight…
      </div>
    );
  }
  return <>{children}</>;
}
