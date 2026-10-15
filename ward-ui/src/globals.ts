// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// SPDX-License-Identifier: Apache-2.0

import { Buffer } from "buffer";

// The Midnight SDK expects these Node globals in the browser.
const g = globalThis as unknown as { process: unknown; Buffer: unknown };
g.process = { env: { NODE_ENV: import.meta.env.MODE } };
g.Buffer = Buffer;
