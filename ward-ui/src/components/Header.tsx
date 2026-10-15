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

import { LogOut, Wallet } from "lucide-react";
import { useWallet } from "../hooks/wallet";
import { useWard } from "../hooks/ward";
import { formatNight, shortAddress } from "../lib/format";
import { href, type Route } from "../lib/router";
import { Button, cn } from "./ui";

export function WardMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M16 2.5 4.5 7v8.2c0 7.1 4.9 12.6 11.5 14.3 6.6-1.7 11.5-7.2 11.5-14.3V7L16 2.5Z" fill="#0E7C66" />
      <path
        d="M16 22.2c-.3 0-.6-.1-.8-.3l-4.3-4.1a3.4 3.4 0 0 1 4.7-4.9l.4.4.4-.4a3.4 3.4 0 0 1 4.7 4.9l-4.3 4.1c-.2.2-.5.3-.8.3Z"
        fill="#FBF8F3"
      />
    </svg>
  );
}

function NavLink({ to, active, children }: { to: Route; active: boolean; children: string }) {
  return (
    <a
      href={href(to)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-ward-soft text-ward-dark" : "text-muted hover:bg-ink/5 hover:text-ink",
      )}
    >
      {children}
    </a>
  );
}

export function WalletButton() {
  const wallet = useWallet();
  if (wallet.status === "connected" && wallet.address) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden text-right leading-tight sm:block">
          <p className="text-xs text-muted">{shortAddress(wallet.address)}</p>
          <p className="text-sm font-medium">{wallet.night !== null ? `${formatNight(wallet.night)} tNIGHT` : "…"}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={wallet.disconnect} aria-label="Disconnect wallet">
          <LogOut className="size-4" />
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" onClick={() => void wallet.connect()} loading={wallet.status === "connecting"}>
      <Wallet className="size-4" aria-hidden />
      Connect Lace
    </Button>
  );
}

export function Header({ route }: { route: Route }) {
  const { state } = useWard();
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <a href={href({ name: "home" })} className="flex items-center gap-2" aria-label="Ward home">
          <WardMark className="size-8" />
          <span className="font-display text-xl font-semibold">Ward</span>
        </a>
        <nav className="flex items-center gap-1" aria-label="Main">
          <NavLink to={{ name: "home" }} active={route.name === "home" || route.name === "fundraiser"}>
            Fundraisers
          </NavLink>
          <NavLink to={{ name: "hospital" }} active={route.name === "hospital"}>
            Hospitals
          </NavLink>
          {state?.isOperator && (
            <NavLink to={{ name: "operator" }} active={route.name === "operator"}>
              Operator
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted md:inline">
            Midnight {import.meta.env.VITE_NETWORK_ID}
          </span>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
