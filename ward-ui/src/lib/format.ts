// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// SPDX-License-Identifier: Apache-2.0

import { formatNight } from "../../../api/src/utils/index";

export { formatNight, parseNight } from "../../../api/src/utils/index";

export const night = (stars: bigint): string => `${formatNight(stars)} tNIGHT`;

export const shortHex = (hex: string, keep = 6): string =>
  hex.length <= keep * 2 + 1 ? hex : `${hex.slice(0, keep)}…${hex.slice(-keep)}`;

export const shortAddress = (address: string): string =>
  address.length <= 28 ? address : `${address.slice(0, 18)}…${address.slice(-6)}`;

export const percentOf = (part: bigint, whole: bigint): number =>
  whole === 0n ? 0 : Math.min(100, Number((part * 10_000n) / whole) / 100);
