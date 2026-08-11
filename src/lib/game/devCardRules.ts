// Development card purchase + play logic. Kept separate from rules.ts (to
// stop that file growing without bound) but built entirely on the same
// exported primitives — getPlayer, hasResources, subtractResources,
// assertMainPhaseTurn, assertRobberResolved, applyWinCheck, applyRobberMove,
// canPlaceRoad — so there's no parallel reimplementation to drift out of
// sync with the core rules.

import { GameState } from "./state";
import { DevCardType, EdgeId, Resource } from "./types";
import { DEV_CARD_COST } from "./devCards";
import {
  getPlayer,
  hasResources,
  subtractResources,
  assertMainPhaseTurn,
  assertRobberResolved,
  applyWinCheck,
  applyRobberMove,
  canPlaceRoad,
} from "./rules";
import { recomputeLargestArmy, recomputeLongestRoad } from "./bonusVP";

/** Buying is allowed any time on your own turn (like building — doesn't
 * require having rolled first) but blocked while a 7's fallout is
 * unresolved, and unlimited per turn (only *playing* is capped at one). */
export function buyDevCard(state: GameState, playerId: string): GameState {
  assertMainPhaseTurn(state, playerId);
  assertRobberResolved(state);
  if (state.devDeck.length === 0) throw new Error("The development card deck is empty");
  const player = getPlayer(state, playerId);
  if (!hasResources(player, DEV_CARD_COST)) throw new Error("Not enough resources to buy a development card");

  const devDeck = [...state.devDeck];
  const drawn = devDeck.pop()!;

  const players = state.players.map((p) =>
    p.playerId === playerId
      ? {
          ...p,
          resources: subtractResources(p.resources, DEV_CARD_COST),
          newDevCards: { ...p.newDevCards, [drawn]: p.newDevCards[drawn] + 1 },
        }
      : p
  );

  // A drawn Victory Point card counts toward winning immediately even
  // though it's not "playable" in the action-card sense (see rules.ts's
  // totalVictoryPoints), so this can end the game right here.
  const next = { ...state, devDeck, players, log: [...state.log, `${player.nickname} bought a development card`] };
  return applyWinCheck(next);
}

function assertCanPlay(state: GameState, playerId: string, type: DevCardType) {
  assertMainPhaseTurn(state, playerId);
  assertRobberResolved(state);
  if (state.devCardPlayedThisTurn) throw new Error("You can only play one development card per turn");
  const player = getPlayer(state, playerId);
  if (player.devCards[type] <= 0) throw new Error("You don't have that card to play");
}

export function playKnight(
  state: GameState,
  playerId: string,
  targetTileId: string,
  victimPlayerId?: string
): GameState {
  assertCanPlay(state, playerId, "knight");
  const player = getPlayer(state, playerId);
  const { board, players: playersAfterMove, logLine } = applyRobberMove(state, playerId, targetTileId, victimPlayerId);

  const players = playersAfterMove.map((p) =>
    p.playerId === playerId
      ? { ...p, devCards: { ...p.devCards, knight: p.devCards.knight - 1 }, knightsPlayed: p.knightsPlayed + 1 }
      : p
  );

  let next: GameState = {
    ...state,
    board,
    players,
    devCardPlayedThisTurn: true,
    log: [...state.log, `${player.nickname} played a Knight — ${logLine}`],
  };
  next = recomputeLargestArmy(next);
  return applyWinCheck(next);
}

/** Places 1 or 2 free roads (bypassing cost, not legality) — the official
 * rule allows just 1 if that's all the board has room for. Roads are
 * placed sequentially against a progressively-updated board so the second
 * one can legally connect through the first. */
export function playRoadBuilding(state: GameState, playerId: string, edgeIds: EdgeId[]): GameState {
  assertCanPlay(state, playerId, "roadBuilding");
  if (edgeIds.length < 1 || edgeIds.length > 2) throw new Error("Road Building places 1 or 2 roads");

  const player = getPlayer(state, playerId);
  if (player.roadsLeft < edgeIds.length) throw new Error("Not enough road pieces left");

  let board = state.board;
  for (const edgeId of edgeIds) {
    if (!canPlaceRoad(board, playerId, edgeId)) throw new Error("That road spot is illegal");
    const edge = board.edges[edgeId];
    board = { ...board, edges: { ...board.edges, [edgeId]: { ...edge, road: { playerId } } } };
  }

  const players = state.players.map((p) =>
    p.playerId === playerId
      ? {
          ...p,
          roadsLeft: p.roadsLeft - edgeIds.length,
          devCards: { ...p.devCards, roadBuilding: p.devCards.roadBuilding - 1 },
        }
      : p
  );

  let next: GameState = {
    ...state,
    board,
    players,
    devCardPlayedThisTurn: true,
    log: [
      ...state.log,
      `${player.nickname} played Road Building and placed ${edgeIds.length} free road${edgeIds.length === 1 ? "" : "s"}`,
    ],
  };
  next = recomputeLongestRoad(next);
  return applyWinCheck(next);
}

/** Takes 2 resources of the player's choice (any combination, including
 * the same type twice) from the bank. This MVP never modeled a finite bank
 * supply anywhere (distributeResources just credits players), so this
 * stays consistent with that — an unlimited bank, not a new subsystem. */
export function playYearOfPlenty(state: GameState, playerId: string, resources: [Resource, Resource]): GameState {
  assertCanPlay(state, playerId, "yearOfPlenty");
  const player = getPlayer(state, playerId);

  const gained = { ...player.resources };
  for (const r of resources) gained[r] += 1;

  const players = state.players.map((p) =>
    p.playerId === playerId
      ? { ...p, resources: gained, devCards: { ...p.devCards, yearOfPlenty: p.devCards.yearOfPlenty - 1 } }
      : p
  );

  return {
    ...state,
    players,
    devCardPlayedThisTurn: true,
    log: [...state.log, `${player.nickname} played Year of Plenty and took ${resources[0]} + ${resources[1]}`],
  };
}

/** Takes every card of one resource type from every other player's hand. */
export function playMonopoly(state: GameState, playerId: string, resource: Resource): GameState {
  assertCanPlay(state, playerId, "monopoly");
  const player = getPlayer(state, playerId);

  let totalTaken = 0;
  const afterTake = state.players.map((p) => {
    if (p.playerId === playerId) return p;
    const amount = p.resources[resource];
    if (amount <= 0) return p;
    totalTaken += amount;
    return { ...p, resources: { ...p.resources, [resource]: 0 } };
  });
  const players = afterTake.map((p) =>
    p.playerId === playerId
      ? {
          ...p,
          resources: { ...p.resources, [resource]: p.resources[resource] + totalTaken },
          devCards: { ...p.devCards, monopoly: p.devCards.monopoly - 1 },
        }
      : p
  );

  return {
    ...state,
    players,
    devCardPlayedThisTurn: true,
    log: [
      ...state.log,
      `${player.nickname} played Monopoly on ${resource} and took ${totalTaken} card${totalTaken === 1 ? "" : "s"}`,
    ],
  };
}
