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

/** Shared "must strictly beat the current holder to take it over" overtake
 * rule behind both Longest Road and Largest Army — they're otherwise
 * identical algorithms (read the current holder's metric, require a
 * strictly higher challenger to switch holders, drop the bonus outright if
 * the holder falls below the qualifying threshold), differing only in
 * which per-player number they're comparing and how that number gets
 * described in the log line. */
function recomputeBonus(
  state: GameState,
  field: "longestRoad" | "largestArmy",
  threshold: number,
  metricFor: (playerId: string) => number,
  bonusName: string,
  describe: (metric: number) => string
): GameState {
  const currentHolderId = state[field];
  const currentMetric = currentHolderId ? metricFor(currentHolderId) : 0;

  let bestId = currentHolderId && currentMetric >= threshold ? currentHolderId : null;
  let bestMetric = bestId ? currentMetric : 0;

  for (const p of state.players) {
    if (p.playerId === currentHolderId) continue;
    const metric = metricFor(p.playerId);
    if (metric < threshold) continue;
    if (metric > bestMetric) {
      bestId = p.playerId;
      bestMetric = metric;
    }
  }

  if (bestId === state[field]) return state;
  const log =
    bestId !== null
      ? [...state.log, `${nicknameOf(state, bestId)} took ${bonusName} (${describe(bestMetric)}, +2 VP)!`]
      : state.log;
  return { ...state, [field]: bestId, log };
}

/** Re-evaluates every player's road length and decides who (if anyone)
 * holds Longest Road — it can be lost outright if an opponent's new
 * settlement breaks the holder's chain below the minimum. Call after any
 * action that adds a road or a building (buildRoad, buildSettlement,
 * playRoadBuilding). */
export function recomputeLongestRoad(state: GameState): GameState {
  return recomputeBonus(
    state,
    "longestRoad",
    LONGEST_ROAD_MIN_LENGTH,
    (playerId) => longestRoadLength(state.board, playerId),
    "Longest Road",
    (length) => `${length} roads`
  );
}

/** Same overtake rule as Longest Road, applied to knightsPlayed instead of
 * road length. Call after playKnight increments the player's count. */
export function recomputeLargestArmy(state: GameState): GameState {
  return recomputeBonus(
    state,
    "largestArmy",
    LARGEST_ARMY_MIN_KNIGHTS,
    (playerId) => state.players.find((p) => p.playerId === playerId)?.knightsPlayed ?? 0,
    "Largest Army",
    (count) => `${count} knights`
  );
}
