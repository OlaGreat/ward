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

import { Check, Loader2 } from "lucide-react";
import { useWard } from "../hooks/ward";
import type { TxStage } from "../lib/providers";
import { cn } from "./ui";

const steps: Array<{ stage: TxStage; label: string; detail: string }> = [
  { stage: "proving", label: "Proving", detail: "Building a zero-knowledge proof; your secrets stay on this device" },
  { stage: "approving", label: "Approve", detail: "Confirm the transaction in Lace" },
  { stage: "submitting", label: "Sending", detail: "Submitting to Midnight" },
  { stage: "confirming", label: "Confirming", detail: "Waiting for the network to include it" },
];

const order: TxStage[] = ["idle", "proving", "approving", "submitting", "confirming"];

/** A floating progress card for the transaction in flight. */
export function TxBanner() {
  const { activeTx } = useWard();
  if (!activeTx) return null;
  const current = order.indexOf(activeTx.stage);
  const active = steps.find((s) => s.stage === activeTx.stage);
  return (
    <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4" aria-live="polite">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-4 shadow-2xl">
        <p className="font-medium">{activeTx.label}</p>
        <p className="mt-0.5 text-sm text-muted">{active?.detail ?? "Preparing the transaction"}</p>
        <ol className="mt-3 grid grid-cols-4 gap-2">
          {steps.map((step, i) => {
            const position = i + 1;
            const state = current > position ? "done" : current === position ? "active" : "waiting";
            return (
              <li key={step.stage} className="space-y-1.5">
                <div
                  className={cn(
                    "h-1.5 rounded-full",
                    state === "done" && "bg-ward",
                    state === "active" && "animate-pulse-dot bg-ward",
                    state === "waiting" && "bg-ink/10",
                  )}
                />
                <p
                  className={cn(
                    "flex items-center gap-1 text-[11px] font-medium",
                    state === "waiting" ? "text-muted/70" : "text-ink",
                  )}
                >
                  {state === "done" && <Check className="size-3 text-ward" aria-hidden />}
                  {state === "active" && <Loader2 className="size-3 animate-spin text-ward" aria-hidden />}
                  {step.label}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
