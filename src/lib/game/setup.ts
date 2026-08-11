// Initial-placement phase logic: each player places 2 settlements + 2
// roads in snake order before the main game begins. Not in the originally
// "locked" MVP scope list, but required for a game to be playable at all —
// treated as in-scope by necessity (see the plan's open questions).

import { GameState } from "./state";
import { canPlaceSettlement, buildRoad, buildSettlement, buildCity } from "./rules";
import { Resource } from "./types";

export function placeSetupSettlement(state: GameState, playerId: string, vertexId: string): GameState {
  if (state.phase !== "setup" || !state.setup) throw new Error("The game isn't in setup phase");
  const { setup } = state;
  if (setup.subphase !== "placeSettlement") throw new Error("Place a road, not a settlement, right now");
  if (setup.order[setup.index] !== playerId) throw new Error("It's not your turn");
  if (!canPlaceSettlement(state.board, vertexId)) {
    throw new Error("That spot is taken or too close to another settlement");
  }

  const vertex = state.board.vertices[vertexId];
  // Setup order visits every player once, then again in reverse — the
  // second occurrence of a player in `order` is their second settlement,
  // which grants starting resources from its adjacent tiles.
  const isSecondRound = setup.index >= state.turnOrder.length;

  const board = {
    ...state.board,
    vertices: {
      ...state.board.vertices,
      [vertexId]: { ...vertex, building: { playerId, type: "settlement" as const } },
    },
  };

  let players = state.players.map((p) =>
    p.playerId === playerId
      ? { ...p, settlementsLeft: p.settlementsLeft - 1, victoryPoints: p.victoryPoints + 1 }
      : p
  );

  const log = [...state.log];
  if (isSecondRound) {
    const gains: Partial<Record<Resource, number>> = {};
    for (const tileId of vertex.adjacentTileIds) {
      const tile = state.board.tiles.find((t) => t.id === tileId);
      if (tile?.resource) gains[tile.resource] = (gains[tile.resource] ?? 0) + 1;
    }
    players = players.map((p) => {
      if (p.playerId !== playerId) return p;
      const resources = { ...p.resources };
      for (const [resource, amount] of Object.entries(gains)) {
        resources[resource as Resource] += amount as number;
      }
      return { ...p, resources };
    });
    const nickname = players.find((p) => p.playerId === playerId)?.nickname ?? "Someone";
    log.push(`${nickname} placed their second settlement and collected starting resources`);
  }

  return {
    ...state,
    board,
    players,
    log,
    setup: { ...setup, subphase: "placeRoad", pendingSettlementVertexId: vertexId },
  };
}

export function placeSetupRoad(state: GameState, playerId: string, edgeId: string): GameState {
  if (state.phase !== "setup" || !state.setup) throw new Error("The game isn't in setup phase");
  const { setup } = state;
  if (setup.subphase !== "placeRoad") throw new Error("Place a settlement, not a road, right now");
  if (setup.order[setup.index] !== playerId) throw new Error("It's not your turn");

  const edge = state.board.edges[edgeId];
  if (!edge || edge.road) throw new Error("That road spot is taken");
  if (!setup.pendingSettlementVertexId || !edge.endpoints.includes(setup.pendingSettlementVertexId)) {
    throw new Error("Your setup road must connect to the settlement you just placed");
  }

  const board = {
    ...state.board,
    edges: { ...state.board.edges, [edgeId]: { ...edge, road: { playerId } } },
  };
  const players = state.players.map((p) => (p.playerId === playerId ? { ...p, roadsLeft: p.roadsLeft - 1 } : p));

  const nextIndex = setup.index + 1;
  if (nextIndex >= setup.order.length) {
    return {
      ...state,
      board,
      players,
      phase: "main",
      setup: null,
      currentPlayerIndex: 0,
      turnSubphase: "preRoll",
      log: [...state.log, "Setup complete — the game begins!"],
    };
  }

  return {
    ...state,
    board,
    players,
    setup: { ...setup, index: nextIndex, subphase: "placeSettlement", pendingSettlementVertexId: null },
  };
}

/** Single dispatch point for the wire-level "build" action (server/index.ts's
 * game:build handler): setup-phase placement routes to placeSetupSettlement/
 * placeSetupRoad (with "cities can't be built during setup" as a genuine
 * game rule, not a transport-layer special case — this is why that check
 * lives here rather than in server/index.ts), main-phase building routes to
 * the normal buildRoad/buildSettlement/buildCity. Each of those already
 * validates everything else (turn, legality, cost); this only decides which
 * one applies given the current phase and requested piece type. */
export function applyBuildAction(
  state: GameState,
  playerId: string,
  type: "settlement" | "road" | "city",
  targetId: string
): GameState {
  if (state.phase === "setup") {
    if (type === "settlement") return placeSetupSettlement(state, playerId, targetId);
    if (type === "road") return placeSetupRoad(state, playerId, targetId);
    throw new Error("Cities can't be built during setup");
  }
  if (type === "road") return buildRoad(state, playerId, targetId);
  if (type === "settlement") return buildSettlement(state, playerId, targetId);
  return buildCity(state, playerId, targetId);
}
