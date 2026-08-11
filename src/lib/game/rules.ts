// Authoritative, pure game-rule functions — no Socket.IO/Node imports, so
// they're callable from a plain script or test runner. Every function
// either returns a new GameState (never mutates its input) or throws a
// plain Error with a user-facing message; the socket layer is responsible
// for catching that and turning it into a game:actionError event.

import { Board, DevCardType, EdgeId, Resource, VertexId } from "./types";
import { DiceRoll, GameState, PlayerState } from "./state";
import { BUILD_COSTS } from "./costs";
import { emptyDevCardCounts } from "./devCards";
import { recomputeLongestRoad } from "./bonusVP";

export function rollTwoDice(): DiceRoll {
  const die1 = 1 + Math.floor(Math.random() * 6);
  const die2 = 1 + Math.floor(Math.random() * 6);
  return { die1, die2, total: die1 + die2 };
}

/**
 * The settlement "distance rule": a vertex is legal only if it's unbuilt
 * and none of its immediate neighboring vertices are built on either,
 * regardless of who owns them. Doesn't check resource cost or connection
 * to the player's road network — those only apply to main-game builds
 * (Phase 4); setup placement only needs this check.
 */
export function canPlaceSettlement(board: Board, vertexId: VertexId): boolean {
  const vertex = board.vertices[vertexId];
  if (!vertex || vertex.building) return false;
  return vertex.adjacentVertexIds.every((id) => !board.vertices[id]?.building);
}

function edgesAtVertex(board: Board, vertexId: VertexId) {
  return Object.values(board.edges).filter((e) => e.endpoints.includes(vertexId));
}

/**
 * Main-game settlement legality: the distance rule, *plus* the vertex must
 * touch one of the player's own roads (unlike setup placement, which can
 * go anywhere legal with no network requirement).
 */
export function canBuildSettlement(board: Board, playerId: string, vertexId: VertexId): boolean {
  if (!canPlaceSettlement(board, vertexId)) return false;
  return edgesAtVertex(board, vertexId).some((e) => e.road?.playerId === playerId);
}

/**
 * Main-game road legality: unoccupied, and touching either one of the
 * player's own buildings or one of their existing roads at either
 * endpoint — i.e. connected to their existing network. (Setup-phase roads
 * use a stricter, different rule — must touch the settlement *just*
 * placed — handled separately in setup.ts.)
 */
export function canPlaceRoad(board: Board, playerId: string, edgeId: EdgeId): boolean {
  const edge = board.edges[edgeId];
  if (!edge || edge.road) return false;
  return edge.endpoints.some((vertexId) => {
    const vertex = board.vertices[vertexId];
    if (vertex?.building?.playerId === playerId) return true;
    return edgesAtVertex(board, vertexId).some((e) => e.id !== edgeId && e.road?.playerId === playerId);
  });
}

/** A city can only be built by upgrading the player's own existing settlement. */
export function canPlaceCity(board: Board, playerId: string, vertexId: VertexId): boolean {
  const vertex = board.vertices[vertexId];
  return vertex?.building?.playerId === playerId && vertex.building.type === "settlement";
}

/** Credits every player with a building adjacent to a tile showing `total`.
 * A roll of 7 never distributes (handled separately by applyDiceRoll's
 * discard/robber flow), and whichever tile the robber currently sits on is
 * skipped even if it shows the rolled number. */
export function distributeResources(state: GameState, total: number): GameState {
  if (total === 7) return state;

  const gains = new Map<string, Partial<Record<Resource, number>>>();
  for (const tile of state.board.tiles) {
    if (tile.number !== total || !tile.resource) continue;
    if (tile.id === state.board.robberTileId) continue;
    for (const vertex of Object.values(state.board.vertices)) {
      if (!vertex.building || !vertex.adjacentTileIds.includes(tile.id)) continue;
      const amount = vertex.building.type === "city" ? 2 : 1;
      const playerGains = gains.get(vertex.building.playerId) ?? {};
      playerGains[tile.resource] = (playerGains[tile.resource] ?? 0) + amount;
      gains.set(vertex.building.playerId, playerGains);
    }
  }

  const players = state.players.map((p) => {
    const gain = gains.get(p.playerId);
    if (!gain) return p;
    const resources = { ...p.resources };
    for (const [resource, amount] of Object.entries(gain)) {
      resources[resource as Resource] += amount as number;
    }
    return { ...p, resources };
  });

  return { ...state, players };
}

export function getPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) throw new Error("Unknown player");
  return player;
}

export function assertMainPhaseTurn(state: GameState, playerId: string) {
  if (state.phase === "ended") throw new Error("The game has already ended");
  if (state.phase !== "main") throw new Error("The game hasn't started yet");
  if (state.turnOrder[state.currentPlayerIndex] !== playerId) throw new Error("It's not your turn");
}

export const WIN_VICTORY_POINTS = 10;

/** VP visible to every other player: buildings plus Largest Army/Longest
 * Road bonuses (both are public — everyone can see who holds them). Does
 * NOT include unrevealed Victory Point dev cards, matching the real game
 * where those stay hidden until played or the game ends. Used for display
 * to anyone other than the player themselves. */
export function publicVictoryPoints(state: GameState, playerId: string): number {
  const player = getPlayer(state, playerId);
  let total = player.victoryPoints;
  if (state.largestArmy === playerId) total += 2;
  if (state.longestRoad === playerId) total += 2;
  return total;
}

/** publicVictoryPoints plus the player's own hidden Victory Point dev
 * cards (both playable and just-bought — a VP card counts the instant
 * it's drawn, it doesn't need to be "played"). This is the true number the
 * win condition checks, and the only one a player's own client should show
 * for themselves. */
export function totalVictoryPoints(state: GameState, playerId: string): number {
  const player = getPlayer(state, playerId);
  return publicVictoryPoints(state, playerId) + player.devCards.victoryPoint + player.newDevCards.victoryPoint;
}

/** Scans hidden totals too, so a player can win the instant a bought (or
 * even just-bought) Victory Point card secretly pushes them over the
 * threshold — same as the physical game, where nobody else need have
 * suspected it. */
export function checkWinCondition(state: GameState): string | null {
  return state.players.find((p) => totalVictoryPoints(state, p.playerId) >= WIN_VICTORY_POINTS)?.playerId ?? null;
}

/** Called after any VP-changing action — building, Largest Army/Longest
 * Road changing hands, or buying/holding a Victory Point dev card —
 * transitions the game to "ended" the moment someone crosses the
 * threshold. A no-op once already ended. */
export function applyWinCheck(state: GameState): GameState {
  if (state.phase === "ended") return state;
  const winnerId = checkWinCondition(state);
  if (!winnerId) return state;
  const winner = getPlayer(state, winnerId);
  return {
    ...state,
    phase: "ended",
    winnerId,
    log: [...state.log, `${winner.nickname} wins with ${totalVictoryPoints(state, winnerId)} victory points!`],
  };
}

/** How many cards a player over the 7-card hand limit must discard on a 7:
 * half their hand, rounded down. Only players over the limit owe anything. */
function computeDiscardsOwed(state: GameState): Record<string, number> {
  const owed: Record<string, number> = {};
  for (const p of state.players) {
    const total = Object.values(p.resources).reduce((sum, n) => sum + n, 0);
    if (total > 7) owed[p.playerId] = Math.floor(total / 2);
  }
  return owed;
}

export function applyDiceRoll(state: GameState, playerId: string): { state: GameState; roll: DiceRoll } {
  assertMainPhaseTurn(state, playerId);
  if (state.turnSubphase !== "preRoll") throw new Error("You already rolled this turn");

  const roll = rollTwoDice();
  const nickname = state.players.find((p) => p.playerId === playerId)?.nickname ?? "Someone";

  if (roll.total === 7) {
    const discardsOwed = computeDiscardsOwed(state);
    const anyoneOwes = Object.keys(discardsOwed).length > 0;
    const next: GameState = {
      ...state,
      lastRoll: roll,
      discardsOwed,
      turnSubphase: anyoneOwes ? "discarding" : "moveRobber",
      log: [
        ...state.log,
        `${nickname} rolled 7${anyoneOwes ? " — some players must discard down to 7 cards" : ""}`,
      ],
    };
    return { state: next, roll };
  }

  const distributed = distributeResources(state, roll.total);
  const next: GameState = {
    ...distributed,
    lastRoll: roll,
    turnSubphase: "postRoll",
    log: [...distributed.log, `${nickname} rolled ${roll.total}`],
  };
  return { state: next, roll };
}

/** Any player owing a discard (see computeDiscardsOwed) must resolve it
 * before anyone can build, and before the roller can move the robber —
 * this is deliberately not gated to the current turn player, since anyone
 * at the table can be over the limit. */
export function discard(state: GameState, playerId: string, resources: Partial<Record<Resource, number>>): GameState {
  if (state.phase === "ended") throw new Error("The game has already ended");
  if (state.phase !== "main") throw new Error("The game hasn't started yet");
  if (state.turnSubphase !== "discarding") throw new Error("No discard is owed right now");

  const owed = state.discardsOwed[playerId];
  if (owed === undefined) throw new Error("You don't owe a discard");

  const player = getPlayer(state, playerId);
  const requested = Object.values(resources).reduce((sum, n) => sum + (n ?? 0), 0);
  if (requested !== owed) throw new Error(`You must discard exactly ${owed} card${owed === 1 ? "" : "s"}`);
  if (!hasResources(player, resources)) throw new Error("You don't have that many of those resources");

  const players = state.players.map((p) =>
    p.playerId === playerId ? { ...p, resources: subtractResources(p.resources, resources) } : p
  );
  const remainingOwed = { ...state.discardsOwed };
  delete remainingOwed[playerId];
  const stillWaiting = Object.keys(remainingOwed).length > 0;

  return {
    ...state,
    players,
    discardsOwed: remainingOwed,
    turnSubphase: stillWaiting ? "discarding" : "moveRobber",
    log: [...state.log, `${player.nickname} discarded ${owed} card${owed === 1 ? "" : "s"}`],
  };
}

/** Every non-actor player with a building on the target tile and at least
 * one resource card — i.e. legal steal targets. Shared between move-robber
 * validation and picking who actually loses a card. */
export function stealCandidates(state: GameState, actorId: string, targetTileId: string): string[] {
  const candidates = new Set<string>();
  for (const vertex of Object.values(state.board.vertices)) {
    if (!vertex.building || vertex.building.playerId === actorId) continue;
    if (!vertex.adjacentTileIds.includes(targetTileId)) continue;
    const victim = getPlayer(state, vertex.building.playerId);
    const total = Object.values(victim.resources).reduce((sum, n) => sum + n, 0);
    if (total > 0) candidates.add(vertex.building.playerId);
  }
  return [...candidates];
}

/** The actual robber-relocation + steal mechanic, shared between the
 * post-7 flow (moveRobber, below) and the Knight dev card (playKnight in
 * devCardRules.ts) — both need identical legality/steal behavior but
 * different surrounding state transitions (moveRobber always ends in
 * "postRoll"; a Knight can be played whenever, so it leaves turnSubphase
 * alone). Steals a uniformly-random card from the victim's actual hand —
 * the server picks it, never the client, so nobody can see what the victim
 * is holding. */
export function applyRobberMove(
  state: GameState,
  playerId: string,
  targetTileId: string,
  victimPlayerId?: string
): { board: Board; players: PlayerState[]; logLine: string } {
  if (!state.board.tiles.some((t) => t.id === targetTileId)) throw new Error("Unknown tile");
  if (targetTileId === state.board.robberTileId) throw new Error("The robber must move to a different tile");

  const candidates = stealCandidates(state, playerId, targetTileId);
  if (victimPlayerId && !candidates.includes(victimPlayerId)) {
    throw new Error("You can't steal from that player");
  }
  if (!victimPlayerId && candidates.length > 0) {
    throw new Error("Choose a player to steal from");
  }

  const board = { ...state.board, robberTileId: targetTileId };
  const actor = getPlayer(state, playerId);
  let players = state.players;
  let logLine = `${actor.nickname} moved the robber`;

  if (victimPlayerId) {
    const victim = getPlayer(state, victimPlayerId);
    const pool: Resource[] = [];
    for (const [resource, amount] of Object.entries(victim.resources)) {
      for (let i = 0; i < amount; i++) pool.push(resource as Resource);
    }
    const stolen = pool[Math.floor(Math.random() * pool.length)];
    players = state.players.map((p) => {
      if (p.playerId === victimPlayerId) return { ...p, resources: { ...p.resources, [stolen]: p.resources[stolen] - 1 } };
      if (p.playerId === playerId) return { ...p, resources: { ...p.resources, [stolen]: p.resources[stolen] + 1 } };
      return p;
    });
    logLine = `${actor.nickname} moved the robber and stole a card from ${victim.nickname}`;
  }

  return { board, players, logLine };
}

/** Moves the robber via the post-7 discard/move flow — only valid while
 * turnSubphase is "moveRobber", and always resolves back to "postRoll". */
export function moveRobber(
  state: GameState,
  playerId: string,
  targetTileId: string,
  victimPlayerId?: string
): GameState {
  assertMainPhaseTurn(state, playerId);
  if (state.turnSubphase !== "moveRobber") throw new Error("You don't need to move the robber right now");
  const { board, players, logLine } = applyRobberMove(state, playerId, targetTileId, victimPlayerId);
  return { ...state, board, players, turnSubphase: "postRoll", log: [...state.log, logLine] };
}

/** Building (and dev-card buying/playing) is blocked while a 7's fallout is
 * unresolved — waiting on discards, or waiting on the roller to move the
 * robber. */
export function assertRobberResolved(state: GameState) {
  if (state.turnSubphase === "discarding") throw new Error("Waiting for players to discard down to 7 cards");
  if (state.turnSubphase === "moveRobber") throw new Error("Move the robber before building");
}

export function advanceTurn(state: GameState, playerId: string): GameState {
  assertMainPhaseTurn(state, playerId);
  if (state.turnSubphase !== "postRoll") throw new Error("Roll the dice before ending your turn");

  const nextIndex = (state.currentPlayerIndex + 1) % state.turnOrder.length;
  const nextPlayerId = state.turnOrder[nextIndex];
  // Dev cards bought last turn become playable now that it's that player's
  // turn again (official "can't play the turn you bought it" rule) —
  // merge whatever's pending into the playable pile.
  const players = state.players.map((p) => {
    if (p.playerId !== nextPlayerId) return p;
    const hasPending = Object.values(p.newDevCards).some((n) => n > 0);
    if (!hasPending) return p;
    const devCards = { ...p.devCards };
    for (const [type, count] of Object.entries(p.newDevCards)) {
      devCards[type as DevCardType] += count;
    }
    return { ...p, devCards, newDevCards: emptyDevCardCounts() };
  });

  return {
    ...state,
    players,
    currentPlayerIndex: nextIndex,
    turnSubphase: "preRoll",
    lastRoll: null,
    devCardPlayedThisTurn: false,
    // Trade offers are turn-scoped (see state.ts's TradeOffer comment) —
    // whatever's still open when the turn ends is moot, not carried over.
    pendingTrades: [],
  };
}

export function hasResources(player: PlayerState, cost: Partial<Record<Resource, number>>): boolean {
  return Object.entries(cost).every(([resource, amount]) => player.resources[resource as Resource] >= (amount ?? 0));
}

export function subtractResources(
  resources: Record<Resource, number>,
  cost: Partial<Record<Resource, number>>
): Record<Resource, number> {
  const result = { ...resources };
  for (const [resource, amount] of Object.entries(cost)) {
    result[resource as Resource] -= amount ?? 0;
  }
  return result;
}

/** Symmetric to subtractResources — used by tradeRules.ts for both sides of
 * a trade (the bank credit, and each player's half of a player-to-player
 * swap), so gaining resources isn't hand-rolled per call site. */
export function addResources(
  resources: Record<Resource, number>,
  gain: Partial<Record<Resource, number>>
): Record<Resource, number> {
  const result = { ...resources };
  for (const [resource, amount] of Object.entries(gain)) {
    result[resource as Resource] += amount ?? 0;
  }
  return result;
}

/** Building is allowed any time on your own turn in the main phase — real
 * Catan doesn't require having rolled first (you might be spending
 * resources banked from earlier turns), so this deliberately doesn't
 * check turnSubphase the way applyDiceRoll/advanceTurn do. */
export function buildRoad(state: GameState, playerId: string, edgeId: EdgeId): GameState {
  assertMainPhaseTurn(state, playerId);
  assertRobberResolved(state);
  const player = getPlayer(state, playerId);
  if (player.roadsLeft <= 0) throw new Error("You're out of roads");
  if (!canPlaceRoad(state.board, playerId, edgeId)) throw new Error("That road spot is illegal");
  if (!hasResources(player, BUILD_COSTS.road)) throw new Error("Not enough resources for a road");

  const edge = state.board.edges[edgeId];
  const board = {
    ...state.board,
    edges: { ...state.board.edges, [edgeId]: { ...edge, road: { playerId } } },
  };
  const players = state.players.map((p) =>
    p.playerId === playerId
      ? { ...p, roadsLeft: p.roadsLeft - 1, resources: subtractResources(p.resources, BUILD_COSTS.road) }
      : p
  );
  let next = { ...state, board, players, log: [...state.log, `${player.nickname} built a road`] };
  // A road never grants VP directly, but it can hand someone the Longest
  // Road bonus (or take it from whoever had it), which does — so this
  // needs the same win check buildSettlement/buildCity already get.
  next = recomputeLongestRoad(next);
  return applyWinCheck(next);
}

export function buildSettlement(state: GameState, playerId: string, vertexId: VertexId): GameState {
  assertMainPhaseTurn(state, playerId);
  assertRobberResolved(state);
  const player = getPlayer(state, playerId);
  if (player.settlementsLeft <= 0) throw new Error("You're out of settlements");
  if (!canBuildSettlement(state.board, playerId, vertexId)) throw new Error("That settlement spot is illegal");
  if (!hasResources(player, BUILD_COSTS.settlement)) throw new Error("Not enough resources for a settlement");

  const vertex = state.board.vertices[vertexId];
  const board = {
    ...state.board,
    vertices: {
      ...state.board.vertices,
      [vertexId]: { ...vertex, building: { playerId, type: "settlement" as const } },
    },
  };
  const players = state.players.map((p) =>
    p.playerId === playerId
      ? {
          ...p,
          settlementsLeft: p.settlementsLeft - 1,
          victoryPoints: p.victoryPoints + 1,
          resources: subtractResources(p.resources, BUILD_COSTS.settlement),
        }
      : p
  );
  let next = { ...state, board, players, log: [...state.log, `${player.nickname} built a settlement`] };
  // A new settlement's vertex could sit in the middle of an opponent's road
  // chain and break it (Longest Road is lost, not just capped, at that
  // point) — recompute everyone's, not just the builder's.
  next = recomputeLongestRoad(next);
  return applyWinCheck(next);
}

export function buildCity(state: GameState, playerId: string, vertexId: VertexId): GameState {
  assertMainPhaseTurn(state, playerId);
  assertRobberResolved(state);
  const player = getPlayer(state, playerId);
  if (player.citiesLeft <= 0) throw new Error("You're out of cities");
  if (!canPlaceCity(state.board, playerId, vertexId)) throw new Error("You can only upgrade your own settlement to a city");
  if (!hasResources(player, BUILD_COSTS.city)) throw new Error("Not enough resources for a city");

  const vertex = state.board.vertices[vertexId];
  const board = {
    ...state.board,
    vertices: {
      ...state.board.vertices,
      [vertexId]: { ...vertex, building: { playerId, type: "city" as const } },
    },
  };
  const players = state.players.map((p) =>
    p.playerId === playerId
      ? {
          ...p,
          citiesLeft: p.citiesLeft - 1,
          settlementsLeft: p.settlementsLeft + 1, // the settlement piece returns to the player's supply
          victoryPoints: p.victoryPoints + 1, // was already 1 for the settlement; a city is worth 2 total
          resources: subtractResources(p.resources, BUILD_COSTS.city),
        }
      : p
  );
  const next = { ...state, board, players, log: [...state.log, `${player.nickname} upgraded a settlement to a city`] };
  return applyWinCheck(next);
}
