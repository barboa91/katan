// Build cost table. Not consumed yet — setup-phase placement (Phase 3) is
// free, as in real Catan — but Phase 4's main-game building will deduct
// from here, so it's defined once now rather than invented ad hoc later.

import { Resource } from "./types";

export const BUILD_COSTS: Record<"road" | "settlement" | "city", Partial<Record<Resource, number>>> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 },
  city: { wheat: 2, ore: 3 },
};
