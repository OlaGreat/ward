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

import { useMemo, useState } from "react";
import { KeyRound, Lock } from "lucide-react";
import { BillStatus } from "../../../api/src/index";
import { decodeClaim, toHex } from "../../../api/src/utils/index";
import { VerifiedBy } from "../components/Fundraiser";
import { RequireWard } from "../components/Gates";
import { Button, Card, CopyButton, Field, Notice } from "../components/ui";
import { useWard } from "../hooks/ward";
import { night } from "../lib/format";
import { absoluteHref, href, navigate } from "../lib/router";

function ClaimForm({ claim }: { claim: string }) {
  const { state, run } = useWard();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const decoded = useMemo(() => {
    try {
      return { billId: toHex(decodeClaim(claim).billId), problem: null };
    } catch (e) {
      return { billId: null, problem: e instanceof Error ? e.message : String(e) };
    }
  }, [claim]);

  if (decoded.problem || !decoded.billId) {
    return (
      <Notice tone="care" title="This claim link can't be used">
        {decoded.problem}
      </Notice>
    );
  }
  const bill = state?.bills.find((b) => b.id === decoded.billId);
  if (!bill) {
    return (
      <Notice tone="gold" title="Bill not found on this Ward instance">
        Check that the hospital sent you the full link, or ask them which Ward instance they use.
      </Notice>
    );
  }
  if (bill.status !== BillStatus.ISSUED) {
    return (
      <Notice title="A fundraiser is already open for this bill">
        Each bill can have exactly one fundraiser.{" "}
        <a className="font-semibold underline" href={href({ name: "fundraiser", billId: bill.id })}>
          View it here
        </a>
        .
      </Notice>
    );
  }

  const submit = async () => {
    const text = title.trim();
    if (text.length < 8) return setError("Give your fundraiser a short title (at least 8 characters)");
    if (text.length > 80) return setError("Keep the title under 80 characters");
    setBusy(true);
    setError(null);
    try {
      await run("Opening your fundraiser", (api) => api.openFundraiser(claim, text));
      navigate({ name: "fundraiser", billId: bill.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-paper p-4">
        <VerifiedBy name={bill.hospitalName} />
        <p className="mt-2 text-sm text-muted">Amount on the bill</p>
        <p className="font-display text-2xl font-semibold">{night(bill.amountDue)}</p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Fundraiser title"
          placeholder="Help Ada get her heart surgery"
          value={title}
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
          error={error}
          hint="This is the only thing you publish. Avoid your full name and your diagnosis."
          autoFocus
        />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          <KeyRound className="size-4" aria-hidden />
          Open fundraiser
        </Button>
      </form>
      <div className="flex gap-3 rounded-xl border border-line p-4 text-sm leading-relaxed text-muted">
        <Lock className="mt-0.5 size-4 shrink-0 text-ward" aria-hidden />
        <p>
          Your claim code stays on this device. Ward proves to the network, in zero knowledge, that you hold the code
          the hospital issued. The network checks the proof without ever seeing the code or learning who you are.
        </p>
      </div>
    </div>
  );
}

export function ClaimPage({ claim }: { claim: string }) {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Open your fundraiser</h1>
        <p className="mt-2 text-muted">
          Your hospital verified this bill on Midnight. Opening a fundraiser lets anyone donate toward it, and every
          donation is paid straight to the hospital.
        </p>
      </div>
      <Card className="p-6">
        <RequireWard>
          <ClaimForm claim={claim} />
        </RequireWard>
      </Card>
      <p className="flex items-center justify-between gap-3 text-xs text-muted">
        Keep this link private until your fundraiser is open.
        <CopyButton text={absoluteHref({ name: "claim", claim })} label="Copy claim link" />
      </p>
    </div>
  );
}
