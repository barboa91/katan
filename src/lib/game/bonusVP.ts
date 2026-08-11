// Largest Army and Longest Road: two +2 VP bonuses that share the same
// "current holder, must be strictly overtaken" mechanic, so both live here
// together rather than being reimplemented per-feature. Neither existed
// anywhere in the MVP (Phases 1-5 shipped with zero bonus-VP sources), so
// this is new ground, not a Phase 6/7 carryover.

import { Board, VertexId } from "./types";
import { GameState } from "./state";

export const LARGEST_ARMY_MIN_KNIGHTS = 3;
export const LONGEST_ROAD_MIN_LENGTH = 5;

/**
 * Longest continuous chain of `playerId`'s own roads, as a count of edges.
 * A vertex occupied by an *opponent's* settlement/city breaks the chain —
 * you can still arrive at it (that edge counts), but the path can't
 * continue past it, matching the official rule. A DFS enumerating simple
 * edge-paths is worst-case exponential, but real hands cap at 15 roads
 * with vertex degree <=3, so in practice this is a handful of short
 * branches, not a real cost — no memoization needed at this scale.
 */
export function longestRoadLength(board: Board, playerId: string): number {
  const myEdges = Object.values(board.edges).filter((e) => e.road?.playerId === playerId);
  if (myEdges.length === 0) return 0;

  const byVertex = new Map<VertexId, typeof myEdges>();
  for (const e of myEdges) {
    for (const v of e.endpoints) {
      if (!byVertex.has(v)) byVertex.set(v, []);
      byVertex.get(v)!.push(e);
    }
  }

  function isBlocked(vertexId: VertexId): boolean {
    const building = board.vertices[vertexId]?.building;
    return !!building && building.playerId !== playerId;
  }

  let best = 0;
  function dfs(vertexId: VertexId, visitedEdges: Set<string>, length: number) {
    best = Math.max(best, length);
    for (const e of byVertex.get(vertexId) ?? []) {
      if (visitedEdges.has(e.id)) continue;
      const next = e.endpoints.find((v) => v !== vertexId)!;
      if (isBlocked(next)) {
        // Reaching an opponent's town still counts this edge, but the
        // chain can't continue past it — don't recurse further from here.
        best = Math.max(best, length + 1);
        continue;
      }
      visitedEdges.add(e.id);
      dfs(next, visitedEdges, length + 1);
      visitedEdges.delete(e.id);
    }
  }

  // Start from every vertex touched by one of the player's roads (not just
  // unblocked ones) — a chain can legally begin right next to an opponent's
  // town and extend away from it; only *continuing past* a blocked vertex
  // is disallowed, never starting there.
  for (const v of byVertex.keys()) {
    dfs(v, new Set(), 0);
  }
  return best;
}

function nicknameOf(state: GameState, playerId: string): string {
  return state.players.find((p) => p.playerId === playerId)?.nickname ?? "Someone";
}

/** Re-evaluates every player's road length and decides who (if anyone)
 * holds Longest Road, applying the "must strictly beat the current holder
 * to take it over" rule — a tie leaves it with whoever already has it,
 * and it can also be lost outright if an opponent's new settlement breaks
 * the holder's chain below the minimum. Call after any action that adds a
 * road or a building (buildRoad, buildSettlement, playRoadBuilding). */
export function recomputeLongestRoad(state: GameState): GameState {
  const currentHolderId = state.longestRoad;
  const currentLength = currentHolderId ? longestRoadLength(state.board, currentHolderId) : 0;

  let bestId = currentHolderId && currentLength >= LONGEST_ROAD_MIN_LENGTH ? currentHolderId : null;
  let bestLength = bestId ? currentLength : 0;

  for (const p of state.players) {
    if (p.playerId === currentHolderId) continue;
    const length = longestRoadLength(state.board, p.playerId);
    if (length < LONGEST_ROAD_MIN_LENGTH) continue;
    if (length > bestLength) {
      bestId = p.playerId;
      bestLength = length;
    }
  }

  if (bestId === state.longestRoad) return state;
  const log =
    bestId !== null
      ? [...state.log, `${nicknameOf(state, bestId)} took Longest Road (${bestLength} roads, +2 VP)!`]
      : state.log;
  return { ...state, longestRoad: bestId, log };
}

/** Same overtake rule as Longest Road, applied to knightsPlayed instead of
 * road length. Call after playKnight increments the player's count. */
export function recomputeLargestArmy(state: GameState): GameState {
  const currentHolderId = state.largestArmy;
  const currentHolder = currentHolderId ? state.players.find((p) => p.playerId === currentHolderId) : undefined;
  const currentCount = currentHolder?.knightsPlayed ?? 0;

  let bestId = currentHolderId && currentCount >= LARGEST_ARMY_MIN_KNIGHTS ? currentHolderId : null;
  let bestCount = bestId ? currentCount : 0;

  for (const p of state.players) {
    if (p.playerId === currentHolderId) continue;
    if (p.knightsPlayed < LARGEST_ARMY_MIN_KNIGHTS) continue;
    if (p.knightsPlayed > bestCount) {
      bestId = p.playerId;
      bestCount = p.knightsPlayed;
    }
  }

  if (bestId === state.largestArmy) return state;
  const log =
    bestId !== null
      ? [...state.log, `${nicknameOf(state, bestId)} took Largest Army (${bestCount} knights, +2 VP)!`]
      : state.log;
  return { ...state, largestArmy: bestId, log };
}
