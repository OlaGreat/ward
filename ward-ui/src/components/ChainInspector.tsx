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

import { EyeOff, Globe2, Lock } from "lucide-react";
import { BillStatus, type BillView } from "../../../api/src/index";
import { shortHex } from "../lib/format";

const statusName: Record<BillStatus, string> = {
  [BillStatus.ISSUED]: "ISSUED",
  [BillStatus.FUNDRAISING]: "FUNDRAISING",
  [BillStatus.FUNDED]: "FUNDED",
  [BillStatus.CANCELLED]: "CANCELLED",
};

function Row({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className="grid grid-cols-[9.5rem_1fr] gap-3 border-b border-chain-line/70 py-2 last:border-0">
      <dt className="font-mono text-xs text-sky-300/70">{name}</dt>
      <dd className="min-w-0">
        <span className="break-all font-mono text-xs text-sky-50">{value}</span>
        {note && <span className="mt-0.5 block text-[11px] text-sky-200/50">{note}</span>}
      </dd>
    </div>
  );
}

function PrivateItem({ children }: { children: string }) {
  return (
    <li className="flex items-start gap-2 text-sm text-ink">
      <Lock className="mt-0.5 size-4 shrink-0 text-ward" aria-hidden />
      {children}
    </li>
  );
}

/**
 * Shows, side by side, exactly what any observer can read from the Midnight
 * ledger for a bill, and what never leaves the people involved.
 */
export function ChainInspector({ bill }: { bill: BillView }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <section className="rounded-2xl bg-chain p-5 text-sky-50" aria-labelledby="public-heading">
        <div className="mb-3 flex items-center gap-2">
          <Globe2 className="size-4 text-sky-300" aria-hidden />
          <h3 id="public-heading" className="font-sans text-sm font-semibold tracking-normal">
            What the blockchain sees
          </h3>
        </div>
        <dl>
          <Row name="bills[id]" value={shortHex(bill.id, 10)} />
          <Row name="hospital" value={shortHex(bill.hospitalKey, 10)} note={`registered as "${bill.hospitalName}"`} />
          <Row name="amountDue" value={`${bill.amountDue.toString()} Stars`} />
          <Row name="raised" value={`${bill.raised.toString()} Stars`} />
          <Row name="status" value={statusName[bill.status]} />
          <Row name="title" value={bill.title ? `"${bill.title}"` : "none"} note="chosen by the patient" />
          <Row
            name="claimCommitment"
            value={shortHex(bill.claimCommitment, 10)}
            note="a hash: it binds the bill to the claim code without revealing it"
          />
          <Row name="treatmentComplete" value={String(bill.treatmentComplete)} />
        </dl>
      </section>
      <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby="private-heading">
        <div className="mb-3 flex items-center gap-2">
          <EyeOff className="size-4 text-ward" aria-hidden />
          <h3 id="private-heading" className="font-sans text-sm font-semibold tracking-normal">
            What stays private
          </h3>
        </div>
        <ul className="space-y-2.5">
          <PrivateItem>The patient's name and identity</PrivateItem>
          <PrivateItem>The diagnosis and medical records</PrivateItem>
          <PrivateItem>The claim code, kept only on the patient's device</PrivateItem>
          <PrivateItem>Which wallet opened the fundraiser</PrivateItem>
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          The patient opened this fundraiser with a zero-knowledge proof that they hold the hospital's claim code. The
          network verified the proof; it never saw the code.
        </p>
      </section>
    </div>
  );
}
