// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// Adapted from midnightntwrk/example-bboard (Copyright (C) Midnight Foundation).
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

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// The Midnight runtime ships as WebAssembly with top-level await, which needs
// the wasm and top-level-await plugins plus the exclusions below.
export default defineConfig({
  cacheDir: "./.vite",
  build: {
    target: "esnext",
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("onchain-runtime-v3") ? "wasm" : undefined),
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
      extensions: [".js", ".cjs"],
      ignoreDynamicRequires: true,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait({
      promiseExportName: "__tla",
      promiseImportName: (i) => `__tla_${i}`,
    }),
    {
      name: "wasm-module-resolver",
      resolveId(source, importer) {
        if (
          source === "@midnight-ntwrk/onchain-runtime-v3" &&
          importer &&
          importer.includes("@midnight-ntwrk/compact-runtime")
        ) {
          return { id: source, external: false, moduleSideEffects: true };
        }
        return null;
      },
    },
  ],
  optimizeDeps: {
    rolldownOptions: {
      target: "esnext",
      supported: { "top-level-await": true },
      platform: "browser",
      format: "esm",
      loader: { ".wasm": "binary" },
    },
    include: ["@midnight-ntwrk/compact-runtime"],
    exclude: [
      "@midnight-ntwrk/onchain-runtime-v3",
      "@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm",
      "@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js",
    ],
  },
  resolve: {
    extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json", ".wasm"],
    mainFields: ["browser", "module", "main"],
  },
});
