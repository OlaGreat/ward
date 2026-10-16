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

import { Header } from "./components/Header";
import { TxBanner } from "./components/TxBanner";
import { useWard } from "./hooks/ward";
import { useRoute } from "./lib/router";
import { ClaimPage } from "./pages/ClaimPage";
import { FundraiserPage } from "./pages/FundraiserPage";
import { Home } from "./pages/Home";
import { HospitalPage } from "./pages/HospitalPage";
import { OperatorPage } from "./pages/OperatorPage";

function Footer() {
  const { contractAddress, provingMode, forgetContract } = useWard();
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Ward runs on Midnight. Medical details never leave the people they belong to.</p>
        <p className="flex items-center gap-2 font-mono text-xs">
          <span>
            {contractAddress ? `contract ${contractAddress.slice(0, 10)}…` : "no instance selected"}
            {provingMode && ` · proving via ${provingMode === "wallet" ? "Lace" : "proof server"}`}
          </span>
          {contractAddress && (
            <button
              type="button"
              onClick={forgetContract}
              className="rounded-md px-1.5 py-0.5 font-sans font-medium text-ward hover:bg-ward-soft"
            >
              Change
            </button>
          )}
        </p>
      </div>
    </footer>
  );
}

export default function App() {
  const route = useRoute();
  return (
    <div className="flex min-h-screen flex-col">
      <Header route={route} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {route.name === "home" && <Home />}
        {route.name === "fundraiser" && <FundraiserPage billId={route.billId} />}
        {route.name === "claim" && <ClaimPage claim={route.claim} />}
        {route.name === "hospital" && <HospitalPage />}
        {route.name === "operator" && <OperatorPage />}
      </main>
      <Footer />
      <TxBanner />
    </div>
  );
}
