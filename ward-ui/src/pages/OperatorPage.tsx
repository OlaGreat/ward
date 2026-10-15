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

import { useState } from "react";
import { Building2, PauseCircle, PlayCircle } from "lucide-react";
import type { HospitalView, WardState } from "../../../api/src/index";
import { RequireWard } from "../components/Gates";
import { Badge, Button, Card, CopyButton, EmptyState, Field, Notice } from "../components/ui";
import { useWard } from "../hooks/ward";
import { shortAddress, shortHex } from "../lib/format";

function RegisterHospital() {
  const { run } = useWard();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [payout, setPayout] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    if (!/^[0-9a-fA-F]{64}$/.test(key.trim())) return setError("The hospital ID is 64 hexadecimal characters");
    if (name.trim().length < 3) return setError("Enter the hospital's name");
    if (!payout.trim().startsWith("mn_addr")) return setError("Enter the hospital's unshielded address (mn_addr…)");
    setBusy(true);
    setError(null);
    try {
      await run(`Registering ${name.trim()}`, (api) => api.registerHospital(key.trim(), name.trim(), payout.trim()));
      setDone(name.trim());
      setKey("");
      setName("");
      setPayout("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold">Register a hospital</h2>
      <p className="mt-1 text-sm text-muted">
        Register a hospital only after verifying it off-chain. Its name and payout address become public.
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Hospital ID"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="64 hex characters"
        />
        <Field
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="St. Mercy Medical Centre"
        />
        <Field
          label="Payout address"
          value={payout}
          onChange={(e) => setPayout(e.target.value)}
          placeholder="mn_addr_preprod1…"
          hint="Every donation for this hospital's bills is forwarded here."
        />
        {error && <Notice tone="care">{error}</Notice>}
        {done && <Notice title={`${done} is registered`}>It can now issue bills from its own browser.</Notice>}
        <Button type="submit" className="w-full" loading={busy}>
          <Building2 className="size-4" aria-hidden />
          Register hospital
        </Button>
      </form>
    </Card>
  );
}

function HospitalItem({ hospital }: { hospital: HospitalView }) {
  const { run } = useWard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await run(hospital.active ? `Suspending ${hospital.name}` : `Reactivating ${hospital.name}`, (api) =>
        api.setHospitalActive(hospital.key, !hospital.active),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{hospital.name}</p>
          <p className="font-mono text-xs text-muted">
            ID {shortHex(hospital.key)} · pays to {shortAddress(hospital.payoutAddress)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={hospital.active ? "ward" : "neutral"}>{hospital.active ? "Active" : "Suspended"}</Badge>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void toggle()}>
            {hospital.active ? (
              <PauseCircle className="size-4" aria-hidden />
            ) : (
              <PlayCircle className="size-4" aria-hidden />
            )}
            {hospital.active ? "Suspend" : "Reactivate"}
          </Button>
        </div>
      </div>
      {error && <Notice tone="care">{error}</Notice>}
    </li>
  );
}

function OperatorContent({ state }: { state: WardState }) {
  if (!state.isOperator) {
    return (
      <Notice tone="gold" title="Operator only">
        This browser doesn't hold the operator key for this Ward instance.
      </Notice>
    );
  }
  const shareLink = `${window.location.origin}${window.location.pathname}?ward=${state.contractAddress}`;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-6">
        <RegisterHospital />
        <Card className="space-y-3 p-6">
          <h2 className="text-lg font-semibold">Share this instance</h2>
          <p className="text-sm text-muted">Anyone opening this link joins this Ward instance.</p>
          <code className="block truncate rounded-lg bg-paper px-3 py-2 font-mono text-xs">
            {state.contractAddress}
          </code>
          <CopyButton text={shareLink} label="Copy instance link" />
        </Card>
      </div>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Hospitals</h2>
        {state.hospitals.length === 0 ? (
          <EmptyState icon={<Building2 className="size-6" />} title="No hospitals yet">
            Registered hospitals appear here.
          </EmptyState>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {state.hospitals.map((h) => (
                <HospitalItem key={h.key} hospital={h} />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

export function OperatorPage() {
  const { state } = useWard();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Operator</h1>
        <p className="mt-2 text-muted">Verify hospitals and keep the registry trustworthy.</p>
      </div>
      <RequireWard>{state && <OperatorContent state={state} />}</RequireWard>
    </div>
  );
}
