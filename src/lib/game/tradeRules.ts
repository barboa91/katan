// Trading logic: bank/port trades (instant, ratio-based against the bank)
// and player-to-player trades (propose/respond/confirm/cancel, so the
// proposer can pick among multiple accepters exactly like the physical
// game — accepting doesn't move any resources by itself, only confirmTrade
// does). Kept separate from rules.ts for the same reason as devCardRules.ts
// — a distinct enough subsystem that folding it in would make that file
// grow without bound — built on the same exported primitives (getPlayer,
// hasResources, subtractResources, addResources, assertMainPhaseTurn,
// assertRobberResolved) so there's no parallel reimplementation to drift
// out of sync with the core rules.

import { GameState, TradeOffer } from "./state";
import { Resource } from "./types";
import {
  getPlayer,
  hasResources,
  subtractResources,
  addResources,
  assertMainPhaseTurn,
  assertRobberResolved,
} from "./rules";

const BANK_RATIO = 4;

/** Best trade ratio this player currently has for `resource`: 2:1 if they
 * hold a matching-resource port, else 3:1 if they hold any generic port,
 * else the 4:1 bank default. Port access requires a settlement/city on
 * either of a port's two vertices, mirroring how every other ownership
 * check in this codebase walks vertex.building.playerId. */
export function getBestRatio(state: GameState, playerId: string, resource: Resource): number {
  let hasGeneric = false;
  for (const port of state.board.ports) {
    const owned = port.vertices.some((vid) => state.board.vertices[vid]?.building?.playerId === playerId);
    if (!owned) continue;
    if (port.resource === resource) return port.ratio; // 2:1, the best possible rate — short-circuit
    if (port.resource === "any") hasGeneric = true;
  }
  return hasGeneric ? 3 : BANK_RATIO;
}

/** Trades `giveAmount` of `give` for exactly 1 of `receive` with the bank,
 * at whatever ratio the player currently qualifies for (see getBestRatio)
 * — the client is expected to have already shown that ratio, but the
 * server re-derives and enforces it regardless of what giveAmount the
 * client sends. Bank supply is treated as unlimited, matching every other
 * resource source in this MVP (distributeResources, Year of Plenty) — there
 * is no finite-bank model anywhere to plug this into. */
export function bankTrade(
  state: GameState,
  playerId: string,
  give: Resource,
  giveAmount: number,
  receive: Resource
): GameState {
  assertMainPhaseTurn(state, playerId);
  assertRobberResolved(state);
  if (give === receive) throw new Error("Can't trade a resource for itself");

  const ratio = getBestRatio(state, playerId, give);
  if (giveAmount !== ratio) throw new Error(`Your best rate for ${give} is ${ratio}:1`);

  const player = getPlayer(state, playerId);
  if (!hasResources(player, { [give]: giveAmount })) throw new Error(`Not enough ${give} to make that trade`);

  const players = state.players.map((p) =>
    p.playerId === playerId
      ? { ...p, resources: addResources(subtractResources(p.resources, { [give]: giveAmount }), { [receive]: 1 }) }
      : p
  );

  return {
    ...state,
    players,
    log: [...state.log, `${player.nickname} traded ${giveAmount} ${give} for 1 ${receive} with the bank`],
  };
}

function makeTradeId(): string {
  // No Node/browser crypto dependency (this module, like rules.ts and
  // devCardRules.ts, has to stay import-safe for both the Node server and
  // the client bundle) — a timestamp plus a random suffix is more than
  // unique enough for a handful of concurrently-pending trade offers.
  return `trade_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function totalOf(resources: Partial<Record<Resource, number>>): number {
  return Object.values(resources).reduce((sum, n) => sum + (n ?? 0), 0);
}

function getTrade(state: GameState, tradeId: string): TradeOffer {
  const trade = state.pendingTrades.find((t) => t.id === tradeId);
  if (!trade) throw new Error("That trade offer no longer exists");
  return trade;
}

/** Opens a new pending trade — offering/requesting must each name at least
 * one resource, and the proposer must actually hold what they're offering
 * (re-checked again at confirmTrade time, since hands can change between
 * proposing and confirming). Only the current turn player may propose,
 * same as building — trading is a during-your-turn action in this MVP. */
export function proposeTrade(
  state: GameState,
  playerId: string,
  offering: Partial<Record<Resource, number>>,
  requesting: Partial<Record<Resource, number>>,
  targetPlayerId: string | null = null
): GameState {
  assertMainPhaseTurn(state, playerId);
  assertRobberResolved(state);
  if (totalOf(offering) === 0) throw new Error("You must offer at least one resource");
  if (totalOf(requesting) === 0) throw new Error("You must request at least one resource");
  if (targetPlayerId === playerId) throw new Error("You can't trade with yourself");
  if (targetPlayerId && !state.players.some((p) => p.playerId === targetPlayerId)) {
    throw new Error("Unknown trade target");
  }

  const player = getPlayer(state, playerId);
  if (!hasResources(player, offering)) throw new Error("You don't have the resources you're offering");

  const trade: TradeOffer = {
    id: makeTradeId(),
    proposerId: playerId,
    offering,
    requesting,
    targetPlayerId,
    respondedBy: {},
  };

  return {
    ...state,
    pendingTrades: [...state.pendingTrades, trade],
    log: [...state.log, `${player.nickname} proposed a trade`],
  };
}

/** Any non-proposer eligible to see this trade (the target, or anyone if
 * it's open) records accept/reject. Doesn't move any resources yet — the
 * proposer picks who to actually finalize with via confirmTrade. A player
 * can respond more than once (e.g. change their mind before the proposer
 * confirms); the latest response replaces the previous one. */
export function respondTrade(
  state: GameState,
  playerId: string,
  tradeId: string,
  response: "accepted" | "rejected"
): GameState {
  const trade = getTrade(state, tradeId);
  if (trade.proposerId === playerId) throw new Error("You can't respond to your own trade offer");
  if (trade.targetPlayerId && trade.targetPlayerId !== playerId) {
    throw new Error("That trade wasn't offered to you");
  }
  if (response === "accepted" && !hasResources(getPlayer(state, playerId), trade.requesting)) {
    throw new Error("You don't have the resources this trade asks for");
  }

  const pendingTrades = state.pendingTrades.map((t) =>
    t.id === tradeId ? { ...t, respondedBy: { ...t.respondedBy, [playerId]: response } } : t
  );
  return { ...state, pendingTrades };
}

/** Proposer-only: finalizes the swap with whichever accepter they choose —
 * more than one player can accept an open offer, but only one trade
 * actually happens, exactly like passing cards across the table in the
 * physical game. Re-validates both hands still have what the trade calls
 * for, since either side may have spent or traded resources away since
 * the offer went out. */
export function confirmTrade(state: GameState, playerId: string, tradeId: string, counterpartyId: string): GameState {
  assertMainPhaseTurn(state, playerId);
  assertRobberResolved(state);
  const trade = getTrade(state, tradeId);
  if (trade.proposerId !== playerId) throw new Error("Only the proposer can confirm this trade");
  if (trade.respondedBy[counterpartyId] !== "accepted") throw new Error("That player hasn't accepted this trade");

  const proposer = getPlayer(state, playerId);
  const counterparty = getPlayer(state, counterpartyId);
  if (!hasResources(proposer, trade.offering)) throw new Error("You no longer have the resources you offered");
  if (!hasResources(counterparty, trade.requesting)) throw new Error("The other player no longer has what this trade asks for");

  const players = state.players.map((p) => {
    if (p.playerId === playerId) {
      return { ...p, resources: addResources(subtractResources(p.resources, trade.offering), trade.requesting) };
    }
    if (p.playerId === counterpartyId) {
      return { ...p, resources: addResources(subtractResources(p.resources, trade.requesting), trade.offering) };
    }
    return p;
  });

  return {
    ...state,
    players,
    pendingTrades: state.pendingTrades.filter((t) => t.id !== tradeId),
    log: [...state.log, `${proposer.nickname} traded with ${counterparty.nickname}`],
  };
}

/** Proposer can withdraw an open offer any time before it's confirmed. */
export function cancelTrade(state: GameState, playerId: string, tradeId: string): GameState {
  const trade = getTrade(state, tradeId);
  if (trade.proposerId !== playerId) throw new Error("Only the proposer can cancel this trade");
  return { ...state, pendingTrades: state.pendingTrades.filter((t) => t.id !== tradeId) };
}
