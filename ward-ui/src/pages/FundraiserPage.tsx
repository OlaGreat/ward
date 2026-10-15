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
import { ArrowLeft, HeartHandshake, HeartPulse } from "lucide-react";
import { BillStatus } from "../../../api/src/index";
import { ChainInspector } from "../components/ChainInspector";
import { DonateDialog, Funding, StatusBadges, VerifiedBy } from "../components/Fundraiser";
import { RequireWard } from "../components/Gates";
import { Button, Card, CopyButton, EmptyState, Notice } from "../components/ui";
import { useWard } from "../hooks/ward";
import { night } from "../lib/format";
import { absoluteHref, href } from "../lib/router";

function Detail({ billId }: { billId: string }) {
  const { state } = useWard();
  const [donating, setDonating] = useState(false);
  const bill = state?.bills.find((b) => b.id === billId);

  if (!bill) {
    return (
      <EmptyState icon={<HeartHandshake className="size-6" />} title="Fundraiser not found">
        It may belong to a different Ward instance, or the link is incomplete.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      <Card className="p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <VerifiedBy name={bill.hospitalName} />
            <h1 className="text-3xl font-semibold">
              {bill.title ?? "Waiting for the patient to open this fundraiser"}
            </h1>
            <StatusBadges bill={bill} />
          </div>
          <CopyButton text={absoluteHref({ name: "fundraiser", billId: bill.id })} label="Copy link" />
        </div>
        <div className="mt-8 grid items-end gap-6 md:grid-cols-[1fr_auto]">
          <Funding bill={bill} large />
          {bill.status === BillStatus.FUNDRAISING && (
            <Button size="lg" onClick={() => setDonating(true)}>
              <HeartHandshake className="size-5" aria-hidden />
              Donate
            </Button>
          )}
        </div>
        {bill.treatmentComplete && (
          <Notice tone="care" className="mt-6" title="Treatment completed">
            <span className="inline-flex items-center gap-1.5">
              <HeartPulse className="size-4" aria-hidden />
              {bill.hospitalName} confirmed the treatment this bill paid for. No medical details were shared.
            </span>
          </Notice>
        )}
        {bill.status === BillStatus.FUNDED && !bill.treatmentComplete && (
          <Notice className="mt-6" title="This bill is fully paid">
            {night(bill.amountDue)} reached {bill.hospitalName}. Thank you to everyone who gave.
          </Notice>
        )}
      </Card>

      <section className="space-y-3" aria-labelledby="ledger-heading">
        <div>
          <h2 id="ledger-heading" className="text-xl font-semibold">
            Public by design, private by default
          </h2>
          <p className="mt-1 text-sm text-muted">
            This is the complete on-chain record of this fundraiser, next to what Ward keeps off-chain.
          </p>
        </div>
        <ChainInspector bill={bill} />
      </section>

      <DonateDialog bill={donating ? bill : null} onClose={() => setDonating(false)} />
    </div>
  );
}

export function FundraiserPage({ billId }: { billId: string }) {
  return (
    <div className="space-y-6">
      <a href={href({ name: "home" })} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        All fundraisers
      </a>
      <RequireWard>
        <Detail billId={billId} />
      </RequireWard>
    </div>
  );
}
