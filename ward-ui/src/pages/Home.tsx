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
import { FileCheck2, HandCoins, HeartHandshake, KeyRound, Stethoscope } from "lucide-react";
import { BillStatus, type BillView } from "../../../api/src/index";
import { DonateDialog, FundraiserCard } from "../components/Fundraiser";
import { RequireWard } from "../components/Gates";
import { Card, EmptyState } from "../components/ui";
import { useWard } from "../hooks/ward";
import { night } from "../lib/format";

const steps = [
  {
    icon: Stethoscope,
    title: "The hospital issues the bill",
    body: "A registered hospital records the bill on Midnight. Its name and the amount are public; the patient's identity and diagnosis never touch the chain.",
  },
  {
    icon: KeyRound,
    title: "The patient opens the fundraiser",
    body: "With the claim code from the hospital, the patient proves in zero knowledge that the bill is theirs, without revealing who they are. One bill, one fundraiser.",
  },
  {
    icon: HandCoins,
    title: "Donors give with confidence",
    body: "Every donation is forwarded by the contract straight to the hospital. A copied appeal can't redirect money, and the fundraiser closes when the bill is paid.",
  },
];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-display text-2xl font-semibold">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

function LiveFundraisers() {
  const { state } = useWard();
  const [donating, setDonating] = useState<BillView | null>(null);
  if (!state) return null;

  const open = state.bills.filter((b) => b.status === BillStatus.FUNDRAISING);
  const funded = state.bills.filter((b) => b.status === BillStatus.FUNDED);
  const shown = [...open, ...funded];

  return (
    <div className="space-y-6">
      <Card className="grid grid-cols-3 gap-4 p-5">
        <Stat label="donated to hospitals" value={night(state.totalRaised)} />
        <Stat label="open fundraisers" value={String(open.length)} />
        <Stat label="verified hospitals" value={String(state.hospitals.filter((h) => h.active).length)} />
      </Card>
      {shown.length === 0 ? (
        <EmptyState icon={<HeartHandshake className="size-6" />} title="No fundraisers yet">
          When a patient opens a fundraiser for a hospital-verified bill, it appears here.
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((bill) => (
            <FundraiserCard key={bill.id} bill={bill} onDonate={setDonating} />
          ))}
        </div>
      )}
      <DonateDialog bill={donating} onClose={() => setDonating(null)} />
    </div>
  );
}

export function Home() {
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-ward-soft px-3 py-1 text-sm font-medium text-ward-dark">
            <FileCheck2 className="size-4" aria-hidden />
            Hospital-verified medical fundraising
          </p>
          <h1 className="text-4xl leading-[1.1] font-semibold sm:text-5xl">
            Prove the bill is real.
            <br />
            <span className="text-ward">Keep the diagnosis private.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
            Families shouldn't have to publish their medical records to be believed. On Ward, hospitals vouch for the
            bill, patients stay anonymous, and every donation goes straight to the hospital.
          </p>
        </div>
        <Card className="space-y-5 p-6">
          {steps.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="flex gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ward-soft text-ward">
                <Icon className="size-5" aria-hidden />
              </div>
              <div>
                <p className="font-semibold">
                  <span className="mr-1.5 text-muted">{i + 1}.</span>
                  {title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            </div>
          ))}
        </Card>
      </section>

      <section aria-labelledby="fundraisers-heading" className="space-y-6">
        <h2 id="fundraisers-heading" className="text-2xl font-semibold">
          Fundraisers
        </h2>
        <RequireWard>
          <LiveFundraisers />
        </RequireWard>
      </section>
    </div>
  );
}
