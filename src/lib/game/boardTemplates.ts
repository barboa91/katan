// Static board shape + resource/number pool definitions, keyed by player
// count tier. Tile *positions* are generated from a row-length shape
// (adjacency-correct regardless of exact centering — the renderer centers
// the whole board in its container, so no fussy per-row alignment math is
// needed here). Resource/number *counts* come from the official rulebooks:
//
// - Standard 4-player board (19 tiles): 4 wood, 3 ore, 4 sheep, 3 brick,
//   4 wheat, 1 desert. 18 number tokens (2-12, two of each except 2/12,
//   no 7 — the desert has no number).
// - 5-6 player expansion (30 tiles): the base 19 tiles plus 12 more hexes
//   (2 wood, 2 brick, 2 sheep, 2 wheat, 2 ore, 1 desert, 1 non-resource
//   filler hex — the filler isn't placed on the land board, see below) for
//   30 land tiles total: wood 6, brick 5, sheep 6, wheat 6, ore 5, desert 2.
//   28 number tokens: two each of 2 and 12, three each of 3,4,5,6,8,9,10,11.
//   Source: catan.com official 5-6 Player Extension rulebook.

import { Axial, BoardSize, Resource } from "./types";

/**
 * Generates axial coords for a symmetric, unimodal hex-row board shape,
 * e.g. [3,4,5,4,3] (standard) or [3,4,5,6,5,4,3] (5-6p expansion).
 *
 * Naively centering each row independently (q0 = -floor((length-1)/2) per
 * row) does NOT produce a valid axial tiling: adjacent rows in axial
 * coordinates must be offset from each other by the growth/shrink amount,
 * not both centered on q=0, or hexes that look adjacent on screen aren't
 * actually axial neighbors — which silently breaks vertex/edge sharing
 * (caught by scripts/verifyBoard.ts: it produced 56 vertices/74 edges
 * instead of the correct 54/72 for the standard board).
 *
 * Instead, each row's range is derived from the previous row's range: a
 * row longer than the one above it extends further left (qMin decreases);
 * a row shorter than the one above it pulls in from the right (qMax
 * decreases). This is the same growth pattern as the standard axial
 * "hex disk" formula, generalized to asymmetric row-length sequences.
 */
function generateRowShape(rowLengths: number[]): Axial[] {
  const coords: Axial[] = [];
  const midRow = (rowLengths.length - 1) / 2;
  let qMin = 0;
  let qMax = 0;
  rowLengths.forEach((length, rowIndex) => {
    const r = rowIndex - midRow;
    if (rowIndex === 0) {
      qMax = length - 1;
    } else {
      const delta = length - rowLengths[rowIndex - 1];
      if (delta > 0) qMin -= delta;
      else if (delta < 0) qMax += delta;
    }
    for (let q = qMin; q <= qMax; q++) {
      coords.push({ q, r });
    }
  });
  return coords;
}

type BoardTemplate = {
  coords: Axial[];
  resources: (Resource | null)[]; // null = desert; length must match coords.length
  numbers: number[]; // length must match resources.length minus desert count
};

export const BOARD_TEMPLATES: Record<BoardSize, BoardTemplate> = {
  standard: {
    coords: generateRowShape([3, 4, 5, 4, 3]), // 19 tiles
    resources: [
      ...Array(4).fill("wood"),
      ...Array(3).fill("ore"),
      ...Array(4).fill("sheep"),
      ...Array(3).fill("brick"),
      ...Array(4).fill("wheat"),
      null, // desert
    ],
    numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
  },
  expansion: {
    coords: generateRowShape([3, 4, 5, 6, 5, 4, 3]), // 30 tiles
    resources: [
      ...Array(6).fill("wood"),
      ...Array(5).fill("ore"),
      ...Array(6).fill("sheep"),
      ...Array(5).fill("brick"),
      ...Array(6).fill("wheat"),
      null,
      null, // 2 deserts
    ],
    numbers: [
      2, 2,
      3, 3, 3,
      4, 4, 4,
      5, 5, 5,
      6, 6, 6,
      8, 8, 8,
      9, 9, 9,
      10, 10, 10,
      11, 11, 11,
      12, 12,
    ],
  },
};

export function boardSizeForPlayerCount(playerCount: number): BoardSize {
  return playerCount <= 4 ? "standard" : "expansion";
}

/** 5-6 player games use the official 5-6 Player Extension's "Special
 * Building Phase" rule (see rules.ts's advanceTurn/passSpecialBuildingTurn)
 * — 4-player games never trigger it. */
export function usesSpecialBuildingPhase(playerCount: number): boolean {
  return playerCount >= 5;
}

// Port counts, keyed by board size. The standard board's 9 ports (4
// generic 3:1 + 1 each of the 5 resources at 2:1) are the well-known
// official layout. The 5-6 player expansion board adds 2 more harbors on
// top of the base 9 (confirmed via the official rulebook/BGG community
// reference — the expansion doesn't add extra resource-specific ports,
// just more coastline to place generic ones on), for 11 total: 6 generic +
// 1 each resource. Exact *positions* aren't sourced from the rulebook
// diagram (same pragmatic tradeoff the rest of this file already makes:
// resource/number tiles are shuffled onto a generated shape rather than
// hand-copied from the official layout) — boardGen.ts spaces them evenly
// around the generated board's coastline instead.
export const PORT_COUNTS: Record<BoardSize, { generic: number; resources: Record<Resource, number> }> = {
  standard: { generic: 4, resources: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 } },
  expansion: { generic: 6, resources: { wood: 1, brick: 1, sheep: 1, wheat: 1, ore: 1 } },
};
