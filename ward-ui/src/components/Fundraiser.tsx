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
import { BadgeCheck, HeartHandshake, HeartPulse, ShieldCheck } from "lucide-react";
import { BillStatus, type BillView } from "../../../api/src/index";
import { useWallet } from "../hooks/wallet";
import { useWard } from "../hooks/ward";
import { formatNight, night, parseNight, percentOf } from "../lib/format";
import { href } from "../lib/router";
import { Badge, Button, Card, Field, Modal, Notice, ProgressBar, cn } from "./ui";

export function StatusBadges({ bill }: { bill: BillView }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {bill.status === BillStatus.FUNDED && (
        <Badge tone="ward" icon={<BadgeCheck className="size-3.5" />}>
          Bill fully paid
        </Badge>
      )}
      {bill.status === BillStatus.CANCELLED && <Badge tone="neutral">Closed by hospital</Badge>}
      {bill.treatmentComplete && (
        <Badge tone="care" icon={<HeartPulse className="size-3.5" />}>
          Treatment completed
        </Badge>
      )}
    </div>
  );
}

export function VerifiedBy({ name, className }: { name: string; className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-sm text-ward-dark", className)}>
      <ShieldCheck className="size-4 shrink-0" aria-hidden />
      <span>
        Verified by <span className="font-semibold">{name}</span>
      </span>
    </p>
  );
}

export function Funding({ bill, large = false }: { bill: BillView; large?: boolean }) {
  const percent = percentOf(bill.raised, bill.amountDue);
  return (
    <div className="space-y-2">
      <ProgressBar percent={percent} className={large ? "h-3" : undefined} />
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p>
          <span className={cn("font-semibold text-ink", large && "text-lg")}>{night(bill.raised)}</span>
          <span className="text-muted"> of {night(bill.amountDue)}</span>
        </p>
        <p className="font-medium text-muted">{Math.floor(percent)}%</p>
      </div>
    </div>
  );
}

export function FundraiserCard({ bill, onDonate }: { bill: BillView; onDonate: (bill: BillView) => void }) {
  return (
    <Card className="flex flex-col p-5 transition-shadow hover:shadow-lg">
      <VerifiedBy name={bill.hospitalName} />
      <a
        href={href({ name: "fundraiser", billId: bill.id })}
        className="mt-3 font-display text-lg leading-snug font-semibold text-ink hover:text-ward-dark"
      >
        {bill.title ?? "Fundraiser"}
      </a>
      <div className="mt-2 min-h-6">
        <StatusBadges bill={bill} />
      </div>
      <div className="mt-auto space-y-4 pt-5">
        <Funding bill={bill} />
        <div className="flex gap-2">
          {bill.status === BillStatus.FUNDRAISING && (
            <Button className="flex-1" onClick={() => onDonate(bill)}>
              <HeartHandshake className="size-4" aria-hidden />
              Donate
            </Button>
          )}
          <a
            href={href({ name: "fundraiser", billId: bill.id })}
            className={cn(
              "inline-flex h-10 items-center justify-center rounded-xl border border-line bg-white px-4 text-sm font-medium",
              "hover:border-ward/40 hover:bg-ward-soft/40",
              bill.status !== BillStatus.FUNDRAISING && "flex-1",
            )}
          >
            View
          </a>
        </div>
      </div>
    </Card>
  );
}

export function DonateDialog({ bill, onClose }: { bill: BillView | null; onClose: () => void }) {
  const { run } = useWard();
  const wallet = useWallet();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (!bill) return null;
  const remaining = bill.amountDue - bill.raised;

  const close = () => {
    setAmount("");
    setError(null);
    setDone(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    let stars: bigint;
    try {
      stars = parseNight(amount);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (stars <= 0n) return setError("Enter an amount greater than zero");
    if (stars > remaining) return setError(`Only ${night(remaining)} is still needed`);
    if (wallet.night !== null && stars > wallet.night) return setError("That's more tNIGHT than your wallet holds");
    setBusy(true);
    try {
      await run(`Donating ${night(stars)}`, (api) => api.donate(bill.id, stars));
      setDone(night(stars));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={done ? "Thank you" : "Make a donation"} onClose={close}>
      {done ? (
        <div className="space-y-4">
          <Notice title={`${done} sent to ${bill.hospitalName}`}>
            Your donation went straight to the hospital's payout address and now counts toward this bill.
          </Notice>
          <Button className="w-full" onClick={close}>
            Done
          </Button>
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="rounded-xl bg-paper p-4">
            <p className="font-medium">{bill.title}</p>
            <VerifiedBy name={bill.hospitalName} className="mt-1" />
            <p className="mt-2 text-sm text-muted">{night(remaining)} still needed</p>
          </div>
          <div>
            <Field
              label="Amount (tNIGHT)"
              inputMode="decimal"
              placeholder="50"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              error={error}
              hint={wallet.night !== null ? `Your wallet holds ${night(wallet.night)}` : undefined}
              autoFocus
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {["10", "50", "100"].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="rounded-lg border border-line px-3 py-1 text-sm hover:border-ward/40"
                  onClick={() => setAmount(value)}
                >
                  {value}
                </button>
              ))}
              <button
                type="button"
                className="rounded-lg border border-line px-3 py-1 text-sm hover:border-ward/40"
                onClick={() => setAmount(formatNight(remaining))}
              >
                Cover the rest
              </button>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            The Ward contract forwards your donation directly to {bill.hospitalName}'s payout address. Ward never holds
            it, and nobody can redirect it to a copied appeal.
          </p>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Donate
          </Button>
        </form>
      )}
    </Modal>
  );
}
