/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// Keep client-side allocations bounded even when the server configuration
// arrives through an untrusted WebSocket payload.
export const MAX_SHOT_SLOTS = 64;

export function normalizeShotSlotCount(value) {
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) {
    return 1;
  }
  if (parsedValue > MAX_SHOT_SLOTS) {
    return MAX_SHOT_SLOTS;
  }
  return parsedValue;
}
