// Development card deck composition + cost. Counts are sourced from the
// official rulebooks (verified against the primary-source 5-6 Player
// Extension rulebook PDF, not just secondhand summaries):
//
// - Standard (base game, up to 4 players): 25 cards — 14 Knight, 5 Victory
//   Point, 2 Road Building, 2 Year of Plenty, 2 Monopoly.
// - Expansion (5-6 players): the base 25 PLUS 9 more (6 Knight, 1 Road
//   Building, 1 Year of Plenty, 1 Monopoly) — notably zero additional
//   Victory Point cards. Total 34: 20/5/3/3/3.

import { BoardSize, DevCardType, Resource } from "./types";
import { shuffle } from "./random";

export const DEV_CARD_COUNTS: Record<BoardSize, Record<DevCardType, number>> = {
  standard: { knight: 14, victoryPoint: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 },
  expansion: { knight: 20, victoryPoint: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 },
};

export const DEV_CARD_COST: Partial<Record<Resource, number>> = { wheat: 1, sheep: 1, ore: 1 };

export function createDevDeck(size: BoardSize): DevCardType[] {
  const counts = DEV_CARD_COUNTS[size];
  const deck: DevCardType[] = [];
  for (const [type, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) deck.push(type as DevCardType);
  }
  return shuffle(deck);
}

export function emptyDevCardCounts(): Record<DevCardType, number> {
  return { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, victoryPoint: 0 };
}
