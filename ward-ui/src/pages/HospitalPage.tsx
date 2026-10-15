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
import { QRCodeSVG } from "qrcode.react";
import { Building2, FilePlus2, HeartPulse, Printer, XCircle } from "lucide-react";
import { BillStatus, type BillView, type WardState } from "../../../api/src/index";
import { StatusBadges } from "../components/Fundraiser";
import { RequireWard } from "../components/Gates";
import { Button, Card, CopyButton, EmptyState, Field, Notice, ProgressBar } from "../components/ui";
import { useWallet } from "../hooks/wallet";
import { useWard } from "../hooks/ward";
import { night, parseNight, percentOf, shortHex } from "../lib/format";
import { absoluteHref, href } from "../lib/router";

// Claim links this hospital issued, kept on this device so they can be re-shared.
const claimsKey = (contract: string) => `ward:v1:issued:${contract}`;
const loadClaims = (contract: string): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(claimsKey(contract)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
};
const saveClaim = (contract: string, billId: string, claim: string) =>
  localStorage.setItem(claimsKey(contract), JSON.stringify({ ...loadClaims(contract), [billId]: claim }));

function Onboarding({ state }: { state: WardState }) {
  const { run } = useWard();
  const wallet = useWallet();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const registerSelf = async () => {
    if (name.trim().length < 3) return setError("Enter the hospital's name");
    if (!wallet.address) return setError("Connect your wallet first");
    setBusy(true);
    setError(null);
    try {
      await run("Registering your hospital", (api) =>
        api.registerHospital(state.myHospitalKey, name.trim(), wallet.address!),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card className="p-6">
        <h2 className="text-xl font-semibold">Join Ward as a hospital</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Ward's operator verifies each hospital before it can issue bills. Send these two values to the operator. They
          are public identifiers, not secrets.
        </p>
        <dl className="mt-5 space-y-4 text-sm">
          <div>
            <dt className="font-medium">Hospital ID</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-paper px-2 py-1.5 font-mono text-xs">
                {state.myHospitalKey}
              </code>
              <CopyButton text={state.myHospitalKey} />
            </dd>
          </div>
          {wallet.address && (
            <div>
              <dt className="font-medium">Payout address (this wallet)</dt>
              <dd className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-paper px-2 py-1.5 font-mono text-xs">
                  {wallet.address}
                </code>
                <CopyButton text={wallet.address} />
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-4 text-xs text-muted">
          The hospital ID is derived from a secret stored only in this browser, so keep using this browser to issue
          bills.
        </p>
      </Card>
      {state.isOperator && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold">You run this instance</h2>
          <p className="mt-2 text-sm text-muted">
            As the operator you can register this browser as a hospital right away, which is handy for trying Ward end
            to end.
          </p>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void registerSelf();
            }}
          >
            <Field
              label="Hospital name"
              placeholder="St. Mercy Medical Centre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={error}
            />
            <Button type="submit" className="w-full" loading={busy}>
              <Building2 className="size-4" aria-hidden />
              Register this browser as a hospital
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function ClaimHandoff({ claim, onDone }: { claim: string; onDone: () => void }) {
  const link = absoluteHref({ name: "claim", claim });
  return (
    <Card className="p-6 print:border-0 print:shadow-none">
      <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
        <div className="mx-auto rounded-2xl border border-line bg-white p-3">
          <QRCodeSVG value={link} size={176} level="M" marginSize={0} />
        </div>
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Give this to the patient</h2>
          <p className="text-sm leading-relaxed text-muted">
            Scanning the code or opening the link lets the patient open one fundraiser for this bill. Share it only with
            them. Even so, a leaked link can't redirect donations: they always go to your payout address.
          </p>
          <div className="flex flex-wrap gap-2 print:hidden">
            <CopyButton text={link} label="Copy claim link" />
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />
              Print
            </Button>
            <Button variant="ghost" size="sm" onClick={onDone}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function IssueBill({ onIssued }: { onIssued: (claim: string) => void }) {
  const { run, state } = useWard();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    let stars: bigint;
    try {
      stars = parseNight(amount);
    } catch (e) {
      return setError(e instanceof Error ? e.message : String(e));
    }
    if (stars <= 0n) return setError("Enter the amount due on the bill");
    setBusy(true);
    try {
      const bill = await run(`Issuing a bill for ${night(stars)}`, (api) => api.issueBill(stars));
      if (state) saveClaim(state.contractAddress, bill.billId, bill.claim);
      setAmount("");
      onIssued(bill.claim);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold">Issue a bill</h2>
      <p className="mt-1 text-sm text-muted">
        Only the amount and your hospital's name are published. Keep patient details in your own records.
      </p>
      <form
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Amount due (tNIGHT)"
          inputMode="decimal"
          placeholder="2400"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={error}
          className="flex-1"
        />
        <Button type="submit" className="sm:mt-7" loading={busy}>
          <FilePlus2 className="size-4" aria-hidden />
          Issue bill
        </Button>
      </form>
    </Card>
  );
}

function BillRow({ bill, claim, onShowClaim }: { bill: BillView; claim?: string; onShowClaim: (c: string) => void }) {
  const { run } = useWard();
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (kind: "confirm" | "cancel") => {
    setBusy(kind);
    setError(null);
    try {
      await (kind === "confirm"
        ? run("Confirming treatment", (api) => api.confirmTreatment(bill.id))
        : run("Cancelling the bill", (api) => api.cancelBill(bill.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const open = bill.status === BillStatus.ISSUED || bill.status === BillStatus.FUNDRAISING;
  return (
    <li className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={href({ name: "fundraiser", billId: bill.id })}
            className="font-medium hover:text-ward-dark hover:underline"
          >
            {bill.title ?? "Waiting for the patient"}
          </a>
          <p className="font-mono text-xs text-muted">bill {shortHex(bill.id)}</p>
        </div>
        <StatusBadges bill={bill} />
      </div>
      <ProgressBar percent={percentOf(bill.raised, bill.amountDue)} />
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted">
          {night(bill.raised)} of {night(bill.amountDue)}
        </p>
        <div className="flex flex-wrap gap-2">
          {bill.status === BillStatus.ISSUED && claim && (
            <Button variant="secondary" size="sm" onClick={() => onShowClaim(claim)}>
              Show claim code
            </Button>
          )}
          {!bill.treatmentComplete && bill.status !== BillStatus.CANCELLED && (
            <Button variant="secondary" size="sm" loading={busy === "confirm"} onClick={() => void act("confirm")}>
              <HeartPulse className="size-4" aria-hidden />
              Confirm treatment
            </Button>
          )}
          {open && (
            <Button variant="danger" size="sm" loading={busy === "cancel"} onClick={() => void act("cancel")}>
              <XCircle className="size-4" aria-hidden />
              Cancel
            </Button>
          )}
        </div>
      </div>
      {error && <Notice tone="care">{error}</Notice>}
    </li>
  );
}

function Dashboard({ state }: { state: WardState }) {
  const [handoff, setHandoff] = useState<string | null>(null);
  const mine = state.bills.filter((b) => b.issuedByMe);
  const claims = loadClaims(state.contractAddress);

  if (!state.myHospital!.active) {
    return (
      <Notice tone="care" title="This hospital is suspended">
        The Ward operator has paused this hospital. Its bills can't receive donations until it is reactivated.
      </Notice>
    );
  }
  return (
    <div className="space-y-6">
      {handoff ? <ClaimHandoff claim={handoff} onDone={() => setHandoff(null)} /> : <IssueBill onIssued={setHandoff} />}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Bills you issued</h2>
        {mine.length === 0 ? (
          <EmptyState icon={<FilePlus2 className="size-6" />} title="No bills yet">
            Issue a bill above and hand the claim code to the patient.
          </EmptyState>
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {mine.map((bill) => (
                <BillRow key={bill.id} bill={bill} claim={claims[bill.id]} onShowClaim={setHandoff} />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function HospitalContent() {
  const { state } = useWard();
  if (!state) return null;
  return state.myHospital ? <Dashboard state={state} /> : <Onboarding state={state} />;
}

export function HospitalPage() {
  const { state } = useWard();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">{state?.myHospital?.name ?? "For hospitals"}</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Issue verified bills so patients can raise money without exposing their medical details. Donations arrive at
          your payout address the moment they are made.
        </p>
      </div>
      <RequireWard>
        <HospitalContent />
      </RequireWard>
    </div>
  );
}
