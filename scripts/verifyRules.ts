// Standalone sanity check for the pure rules engine: drives a full 4-player
// game through setup placement and a batch of main-phase turns, using only
// src/lib/game/* (no sockets, no server). Run with `npm run verify:rules`.

import { createGameState, GameState } from "../src/lib/game/state";
import {
  canPlaceSettlement,
  canBuildSettlement,
  canPlaceRoad,
  canPlaceCity,
  applyDiceRoll,
  advanceTurn,
  buildRoad,
  buildSettlement,
  buildCity,
  checkWinCondition,
  discard,
  moveRobber,
  distributeResources,
  stealCandidates,
  publicVictoryPoints,
  totalVictoryPoints,
} from "../src/lib/game/rules";
import { placeSetupSettlement, placeSetupRoad } from "../src/lib/game/setup";
import { Board, Resource } from "../src/lib/game/types";
import { longestRoadLength, recomputeLongestRoad } from "../src/lib/game/bonusVP";
import { emptyDevCardCounts } from "../src/lib/game/devCards";
import { buyDevCard, playKnight, playRoadBuilding, playYearOfPlenty, playMonopoly } from "../src/lib/game/devCardRules";
import { getBestRatio, bankTrade, proposeTrade, respondTrade, confirmTrade, cancelTrade } from "../src/lib/game/tradeRules";

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Always picking the deterministically-first legal target (Object.keys
// order) makes every player's setup settlements cluster in the same
// corner of the board — unrealistic and it starves later BFS/road-network
// checks of room to work with. Pick randomly among legal options instead,
// closer to how spread-out real players actually place.
function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

const players = [
  { playerId: "p1", nickname: "Alex" },
  { playerId: "p2", nickname: "Sam" },
  { playerId: "p3", nickname: "Jordan" },
  { playerId: "p4", nickname: "Riley" },
];

let state: GameState = createGameState(players);
console.log("Created game. Turn order:", state.turnOrder);
console.log("Setup order length:", state.setup?.order.length, "(expect", players.length * 2, ")");
if (state.setup?.order.length !== players.length * 2) fail("setup order length wrong");

// --- Drive the full setup phase ---
let steps = 0;
// Setup needs one action per player per round (settlement, then road),
// 2 rounds: players.length * 2 * 2 total actions, plus slack against bugs.
const MAX_STEPS = players.length * 2 * 2 + 5;
while (state.phase === "setup" && steps < MAX_STEPS) {
  steps++;
  const setup = state.setup!;
  const playerId = setup.order[setup.index];

  if (setup.subphase === "placeSettlement") {
    const legalVertices = Object.keys(state.board.vertices).filter((vid) => canPlaceSettlement(state.board, vid));
    const legalVertex = pickRandom(legalVertices);
    if (!legalVertex) fail("no legal settlement vertex found during setup");
    state = placeSetupSettlement(state, playerId, legalVertex!);
  } else {
    const pendingVertexId = setup.pendingSettlementVertexId!;
    const legalEdges = Object.values(state.board.edges).filter(
      (e) => !e.road && e.endpoints.includes(pendingVertexId)
    );
    const legalEdge = pickRandom(legalEdges);
    if (!legalEdge) fail("no legal setup road found touching the just-placed settlement");
    state = placeSetupRoad(state, playerId, legalEdge!.id);
  }
}

if (state.phase !== "main") fail(`setup did not complete within ${MAX_STEPS} steps (still: ${state.phase})`);
console.log(`Setup completed in ${steps} steps.`);

for (const p of state.players) {
  if (p.settlementsLeft !== 3) fail(`${p.nickname} should have 3 settlements left (2 placed), got ${p.settlementsLeft}`);
  if (p.roadsLeft !== 13) fail(`${p.nickname} should have 13 roads left (2 placed), got ${p.roadsLeft}`);
  if (p.victoryPoints !== 2) fail(`${p.nickname} should have 2 VP after setup, got ${p.victoryPoints}`);
}
console.log("All players have 2 settlements, 2 roads, 2 VP after setup. OK");

const totalStartingResources = state.players.reduce(
  (sum, p) => sum + Object.values(p.resources).reduce((a, b) => a + b, 0),
  0
);
console.log("Total starting resources granted from second settlements:", totalStartingResources);
if (totalStartingResources === 0) {
  console.warn("WARN: zero starting resources granted — possible (all 2nd settlements on desert-only spots) but worth a second look if it happens often.");
}

// A real 7 roll (~1-in-6 per turn) leaves turnSubphase as "discarding" or
// "moveRobber" instead of "postRoll" — resolve it the way a real game would
// (greedily discard whatever's owed, move the robber to any other tile,
// steal from the first eligible candidate if there is one) so the 20-round
// loop below can keep calling advanceTurn unconditionally, same as a real
// client would after the robber banner clears. The deterministic
// discard/moveRobber correctness checks live in their own dedicated test
// block further down — this just needs to not get stuck.
function resolveRobberIfNeeded(gs: GameState, rollerId: string): GameState {
  let s = gs;
  if (s.turnSubphase === "discarding") {
    for (const [pid, owed] of Object.entries(s.discardsOwed)) {
      const player = s.players.find((p) => p.playerId === pid)!;
      const toDiscard: Partial<Record<Resource, number>> = {};
      let remaining = owed;
      for (const resource of Object.keys(player.resources) as Resource[]) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, player.resources[resource]);
        if (take > 0) {
          toDiscard[resource] = take;
          remaining -= take;
        }
      }
      s = discard(s, pid, toDiscard);
    }
  }
  if (s.turnSubphase === "moveRobber") {
    const targetTile = s.board.tiles.find((t) => t.id !== s.board.robberTileId)!;
    const candidates = new Set<string>();
    for (const vertex of Object.values(s.board.vertices)) {
      if (!vertex.building || vertex.building.playerId === rollerId) continue;
      if (!vertex.adjacentTileIds.includes(targetTile.id)) continue;
      const victim = s.players.find((p) => p.playerId === vertex.building!.playerId)!;
      const total = Object.values(victim.resources).reduce((a, b) => a + b, 0);
      if (total > 0) candidates.add(vertex.building.playerId);
    }
    const victimId = candidates.size > 0 ? [...candidates][0] : undefined;
    s = moveRobber(s, rollerId, targetTile.id, victimId);
  }
  return s;
}

// --- Drive a batch of main-phase turns ---
const ROUNDS = 20;
let rollCount = 0;
let distributionEvents = 0;
let sevensRolled = 0;
for (let i = 0; i < ROUNDS; i++) {
  const currentId = state.turnOrder[state.currentPlayerIndex];
  const before = state.players.find((p) => p.playerId === currentId)!;
  const beforeTotal = Object.values(before.resources).reduce((a, b) => a + b, 0);

  const { state: afterRoll, roll } = applyDiceRoll(state, currentId);
  if (roll.total === 7) sevensRolled++;
  state = resolveRobberIfNeeded(afterRoll, currentId);
  rollCount++;

  const after = state.players.find((p) => p.playerId === currentId)!;
  const afterTotal = Object.values(after.resources).reduce((a, b) => a + b, 0);
  if (afterTotal > beforeTotal) distributionEvents++;
  if (roll.total !== roll.die1 + roll.die2) fail("dice total doesn't match die1+die2");
  if (state.turnSubphase !== "postRoll") fail(`expected turnSubphase "postRoll" after resolving the roll, got "${state.turnSubphase}"`);

  state = advanceTurn(state, currentId);
}

console.log(
  `Ran ${rollCount} dice rolls across ${ROUNDS} turns; ${distributionEvents} produced a resource gain for the roller; ${sevensRolled} were 7s (all correctly resolved back to postRoll).`
);
if (state.turnOrder[state.currentPlayerIndex] === undefined) fail("current player index out of range after turn cycling");

// --- Illegal-action checks ---
try {
  advanceTurn(state, "not-a-real-player");
  fail("advanceTurn should have thrown for a non-current player");
} catch {
  console.log("advanceTurn correctly rejected an out-of-turn player. OK");
}

const currentId = state.turnOrder[state.currentPlayerIndex];
state = applyDiceRoll(state, currentId).state; // legal: fresh turn, preRoll
// This roll can land on a real 7 same as any other — resolve it the same
// way the main loop above does, or the next section's buildRoad calls
// would spuriously fail with "Move the robber before building" (a latent
// test-script gap, not a rules bug: real 7s just weren't landing here
// often enough in earlier runs to catch it).
state = resolveRobberIfNeeded(state, currentId);
try {
  applyDiceRoll(state, currentId); // illegal: already rolled this turn
  fail("applyDiceRoll should have thrown for a second roll in the same turn");
} catch {
  console.log("applyDiceRoll correctly rejected a second roll in the same turn. OK");
}

try {
  advanceTurn(state, state.turnOrder[(state.currentPlayerIndex + 1) % state.turnOrder.length]);
  fail("advanceTurn should have thrown for the wrong player ending someone else's turn");
} catch {
  console.log("advanceTurn correctly rejected the wrong player ending the turn. OK");
}

// --- Phase 4: main-game building ---
const builderId = state.turnOrder[state.currentPlayerIndex];
const builderBefore = state.players.find((p) => p.playerId === builderId)!;
console.log(`\nTesting building as ${builderBefore.nickname} (current player).`);

// Grant a stack of every resource directly (bypassing dice) so legality —
// not luck — is what's under test here.
state = {
  ...state,
  players: state.players.map((p) =>
    p.playerId === builderId
      ? { ...p, resources: { wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 } }
      : p
  ),
};

const firstRoadEdge = Object.keys(state.board.edges).find((eid) => canPlaceRoad(state.board, builderId, eid));
if (!firstRoadEdge) fail("expected at least one legal road for the builder after setup");
state = buildRoad(state, builderId, firstRoadEdge!);
let builder = state.players.find((p) => p.playerId === builderId)!;
if (builder.roadsLeft !== builderBefore.roadsLeft - 1) fail("roadsLeft did not decrement after buildRoad");
if (builder.resources.wood !== 9 || builder.resources.brick !== 9) fail("buildRoad did not deduct the correct cost");
console.log("buildRoad: piece count and resource cost correct. OK");

// The vertex right next to an existing settlement always fails the
// distance rule (even for its own owner) — that's correct Catan behavior,
// not a bug. A greedy single-direction walk can also dead-end (boxed in
// by other players' setup roads), so find a real path via BFS: cheapest
// route (fewest new roads) from the player's current network to any
// vertex that's actually legal for a settlement.
function findSettlementPath(gs: GameState, pid: string): { edgesToBuild: string[]; vertex: string } | null {
  const board = gs.board;
  const start = new Set<string>();
  for (const [vid, v] of Object.entries(board.vertices)) {
    if (v.building?.playerId === pid) start.add(vid);
  }
  for (const e of Object.values(board.edges)) {
    if (e.road?.playerId === pid) {
      start.add(e.endpoints[0]);
      start.add(e.endpoints[1]);
    }
  }

  const visited = new Set(start);
  const queue: { vertex: string; edgesToBuild: string[] }[] = Array.from(start).map((vertex) => ({
    vertex,
    edgesToBuild: [],
  }));

  while (queue.length) {
    const { vertex, edgesToBuild } = queue.shift()!;
    // Only the distance rule needs checking against the real board here —
    // reaching `vertex` via a non-empty edgesToBuild path already proves
    // it touches the player's network (own road or one we'd build), which
    // is canBuildSettlement's other half. Checking canBuildSettlement
    // itself would look for an *already-placed* road at a vertex whose
    // connecting road is still hypothetical, and always fail past hop 1.
    if (edgesToBuild.length > 0 && canPlaceSettlement(board, vertex)) return { edgesToBuild, vertex };
    if (edgesToBuild.length >= 10) continue;
    for (const e of Object.values(board.edges)) {
      if (!e.endpoints.includes(vertex)) continue;
      if (e.road && e.road.playerId !== pid) continue; // blocked by another player
      const other = e.endpoints.find((x) => x !== vertex)!;
      if (visited.has(other)) continue;
      visited.add(other);
      queue.push({ vertex: other, edgesToBuild: e.road ? edgesToBuild : [...edgesToBuild, e.id] });
    }
  }
  return null;
}

const found = findSettlementPath(state, builderId);
if (!found) fail("BFS found no reachable legal settlement spot at all — suspicious on a mostly-empty board");
for (const edgeId of found!.edgesToBuild) {
  state = buildRoad(state, builderId, edgeId);
}
console.log(`Found a legal settlement spot ${found!.edgesToBuild.length} road(s) out.`);
// Unlike the BFS's internal check, this runs against the real, now-mutated
// board — the actual way canBuildSettlement is meant to be used.
if (!canBuildSettlement(state.board, builderId, found!.vertex)) {
  fail("canBuildSettlement rejected the exact spot the BFS just built a road network to reach");
}
state = buildSettlement(state, builderId, found!.vertex);
builder = state.players.find((p) => p.playerId === builderId)!;
if (builder.victoryPoints !== builderBefore.victoryPoints + 1) fail("VP did not increase after buildSettlement");
console.log("buildSettlement: VP and piece count correct. OK");

const ownSettlementVertex = Object.entries(state.board.vertices).find(
  ([, v]) => v.building?.playerId === builderId && v.building.type === "settlement"
)?.[0];
if (!ownSettlementVertex) fail("builder should own at least one settlement to upgrade");
if (!canPlaceCity(state.board, builderId, ownSettlementVertex!)) fail("canPlaceCity rejected the builder's own settlement");
const settlementsBeforeCity = builder.settlementsLeft;
state = buildCity(state, builderId, ownSettlementVertex!);
builder = state.players.find((p) => p.playerId === builderId)!;
if (builder.settlementsLeft !== settlementsBeforeCity + 1) fail("settlement piece should return to supply after a city upgrade");
if (builder.victoryPoints !== builderBefore.victoryPoints + 2) fail("city upgrade should be worth 2 total VP for that building");
console.log("buildCity: settlement piece returned to supply, VP correct. OK");

// Illegal build checks
try {
  buildRoad(state, builderId, firstRoadEdge!); // already built, now occupied
  fail("buildRoad should reject an already-occupied edge");
} catch {
  console.log("buildRoad correctly rejected an occupied edge. OK");
}

const poorPlayerId = state.turnOrder.find((id) => id !== builderId)!;
try {
  // Not poorPlayerId's turn regardless of resources.
  const anyEdge = Object.keys(state.board.edges)[0];
  buildRoad(state, poorPlayerId, anyEdge);
  fail("buildRoad should reject a player acting out of turn");
} catch {
  console.log("buildRoad correctly rejected an out-of-turn player. OK");
}

const broke = { ...state.players.find((p) => p.playerId === builderId)!, resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 } };
const brokeState = { ...state, players: state.players.map((p) => (p.playerId === builderId ? broke : p)) };
const anotherLegalEdge = Object.keys(brokeState.board.edges).find((eid) => canPlaceRoad(brokeState.board, builderId, eid));
if (anotherLegalEdge) {
  try {
    buildRoad(brokeState, builderId, anotherLegalEdge);
    fail("buildRoad should reject when the player can't afford it");
  } catch {
    console.log("buildRoad correctly rejected insufficient resources. OK");
  }
}

// --- Phase 6: Robber (7-roll discard/move/steal) ---
// Constructed directly (bypassing the 1-in-6 chance of a real dice roll
// landing on 7) so discard/move/steal logic is under test, not luck — same
// "directly boost state" approach the win-condition test below uses.
console.log("\nTesting robber (discard/move/steal).");

const others = state.turnOrder.filter((id) => id !== builderId);
const [debtorA, debtorB] = others;

let robberState: GameState = {
  ...state,
  turnSubphase: "discarding",
  discardsOwed: { [debtorA]: 3, [debtorB]: 2 }, // floor(6/2)=3, floor(4/2)=2
  players: state.players.map((p) => {
    if (p.playerId === debtorA) return { ...p, resources: { wood: 6, brick: 0, sheep: 0, wheat: 0, ore: 0 } };
    if (p.playerId === debtorB) return { ...p, resources: { wood: 0, brick: 4, sheep: 0, wheat: 0, ore: 0 } };
    return p;
  }),
};

try {
  discard(robberState, builderId, {});
  fail("discard should reject a player who doesn't owe one");
} catch {
  console.log("discard correctly rejected a player with nothing owed. OK");
}

try {
  discard(robberState, debtorA, { wood: 2 }); // owes 3, not 2
  fail("discard should reject a count that doesn't match what's owed");
} catch {
  console.log("discard correctly rejected a wrong discard count. OK");
}

robberState = discard(robberState, debtorA, { wood: 3 });
if (robberState.turnSubphase !== "discarding") fail("turnSubphase should stay 'discarding' until every debtor has discarded");
if (robberState.discardsOwed[debtorA] !== undefined) fail("debtorA should be cleared from discardsOwed after discarding");
if (robberState.players.find((p) => p.playerId === debtorA)!.resources.wood !== 3) {
  fail("debtorA's hand should be reduced by exactly what was discarded");
}

robberState = discard(robberState, debtorB, { brick: 2 });
if (robberState.turnSubphase !== "moveRobber") fail("turnSubphase should advance to 'moveRobber' once every debtor has discarded");
console.log("discard: count validation, hand deduction, and subphase advancement all correct. OK");

const originalRobberTile = robberState.board.robberTileId;
const anyOtherTile = robberState.board.tiles.find((t) => t.id !== originalRobberTile)!.id;

try {
  moveRobber(robberState, debtorA, anyOtherTile); // debtorA isn't the current turn player
  fail("moveRobber should reject a player other than the current turn player");
} catch {
  console.log("moveRobber correctly rejected a non-current-turn player. OK");
}

try {
  moveRobber(robberState, builderId, originalRobberTile); // same tile it's already on
  fail("moveRobber should reject moving the robber to the tile it's already on");
} catch {
  console.log("moveRobber correctly rejected moving to the same tile. OK");
}

function tileWithVictim(gs: GameState, actorId: string): { tileId: string; victimId: string } | null {
  for (const tile of gs.board.tiles) {
    if (tile.id === gs.board.robberTileId) continue;
    for (const vertex of Object.values(gs.board.vertices)) {
      if (vertex.building && vertex.building.playerId !== actorId && vertex.adjacentTileIds.includes(tile.id)) {
        return { tileId: tile.id, victimId: vertex.building.playerId };
      }
    }
  }
  return null;
}

const stealSetup = tileWithVictim(robberState, builderId);
if (!stealSetup) fail("expected at least one tile with a stealable victim adjacent to it");

// Zero every hand, then give only the chosen victim one wood card, so the
// steal's outcome (which resource, whose hands change) is fully
// predictable instead of random.
robberState = {
  ...robberState,
  players: robberState.players.map((p) =>
    p.playerId === stealSetup!.victimId
      ? { ...p, resources: { wood: 1, brick: 0, sheep: 0, wheat: 0, ore: 0 } }
      : { ...p, resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 } }
  ),
};

try {
  moveRobber(robberState, builderId, stealSetup.tileId); // no victim, despite one being available
  fail("moveRobber should require a victim when one is available");
} catch {
  console.log("moveRobber correctly required a victim when one was available. OK");
}

try {
  moveRobber(robberState, builderId, stealSetup.tileId, "not-a-real-player");
  fail("moveRobber should reject stealing from an ineligible player");
} catch {
  console.log("moveRobber correctly rejected an invalid steal target. OK");
}

const actorBeforeSteal = robberState.players.find((p) => p.playerId === builderId)!;
robberState = moveRobber(robberState, builderId, stealSetup.tileId, stealSetup.victimId);

if (robberState.board.robberTileId !== stealSetup.tileId) fail("robber did not move to the target tile");
if (robberState.turnSubphase !== "postRoll") fail("turnSubphase should return to 'postRoll' once the robber is resolved");
const victimAfterSteal = robberState.players.find((p) => p.playerId === stealSetup!.victimId)!;
const actorAfterSteal = robberState.players.find((p) => p.playerId === builderId)!;
if (victimAfterSteal.resources.wood !== 0) fail("victim should have lost their only card to the steal");
if (actorAfterSteal.resources.wood !== actorBeforeSteal.resources.wood + 1) fail("actor should have gained exactly the stolen card");
console.log("moveRobber: steal correctly transferred one card from victim to actor. OK");

const blockedState: GameState = { ...state, turnSubphase: "discarding", discardsOwed: { [debtorA]: 1 } };
const legalRoadForBlockTest = Object.keys(blockedState.board.edges).find((eid) => canPlaceRoad(blockedState.board, builderId, eid));
if (legalRoadForBlockTest) {
  try {
    buildRoad(blockedState, builderId, legalRoadForBlockTest);
    fail("buildRoad should be rejected while a 7's discard is unresolved");
  } catch (e) {
    if (!(e instanceof Error) || !/discard|robber/i.test(e.message)) {
      fail(`expected a discard/robber-related rejection, got: ${e}`);
    }
    console.log("buildRoad correctly rejected while a 7's discard is unresolved. OK");
  }
}

// Isolated board so the "robber blocks its own tile" check doesn't depend
// on the real board's random layout happening to have two tiles sharing a
// number — hand-crafted so the assertion is unambiguous either way.
const fakeBoard = {
  tiles: [
    { id: "T1", coord: { q: 0, r: 0 }, resource: "wood" as const, number: 8 },
    { id: "T2", coord: { q: 1, r: 0 }, resource: "brick" as const, number: 8 },
  ],
  vertices: {
    V1: { id: "V1", coord: { x: 0, y: 0 }, adjacentTileIds: ["T1"], adjacentVertexIds: [], building: { playerId: builderId, type: "settlement" as const } },
    V2: { id: "V2", coord: { x: 1, y: 1 }, adjacentTileIds: ["T2"], adjacentVertexIds: [], building: { playerId: builderId, type: "settlement" as const } },
  },
  edges: {},
  ports: [],
  robberTileId: "T1",
};
const fakeState: GameState = {
  ...state,
  board: fakeBoard,
  players: state.players.map((p) =>
    p.playerId === builderId ? { ...p, resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 } } : p
  ),
};
const afterFakeDistribution = distributeResources(fakeState, 8);
const builderAfterFake = afterFakeDistribution.players.find((p) => p.playerId === builderId)!;
if (builderAfterFake.resources.wood !== 0) fail("the robber-occupied tile should not have produced resources");
if (builderAfterFake.resources.brick !== 1) fail("a different tile showing the same number should still produce");
console.log("distributeResources: robber-occupied tile blocked, other tile with the same number unaffected. OK");

// --- Phase 7: Development cards + Largest Army/Longest Road ---
console.log("\nTesting development cards (buy/play mechanics).");

const devPlayerId = state.turnOrder[state.currentPlayerIndex]; // still builderId, current turn
const otherIds = state.turnOrder.filter((id) => id !== devPlayerId);

// --- buyDevCard: cost, deck draw, and the "not yet playable this turn" bucket ---
let buyState: GameState = {
  ...state,
  devDeck: ["knight", "victoryPoint", "roadBuilding", "monopoly", "yearOfPlenty"], // pop() draws from the end: yearOfPlenty first
  players: state.players.map((p) =>
    p.playerId === devPlayerId ? { ...p, resources: { wood: 0, brick: 0, sheep: 1, wheat: 1, ore: 1 } } : p
  ),
};
const deckBefore = buyState.devDeck.length;
buyState = buyDevCard(buyState, devPlayerId);
let devPlayer = buyState.players.find((p) => p.playerId === devPlayerId)!;
if (buyState.devDeck.length !== deckBefore - 1) fail("buyDevCard should remove exactly one card from the deck");
if (devPlayer.resources.sheep !== 0 || devPlayer.resources.wheat !== 0 || devPlayer.resources.ore !== 0) {
  fail("buyDevCard did not deduct the correct cost");
}
if (devPlayer.newDevCards.yearOfPlenty !== 1) {
  fail(`bought card should land in newDevCards (not yet playable), got ${JSON.stringify(devPlayer.newDevCards)}`);
}
console.log("buyDevCard: deck draw, cost deduction, and newDevCards bucket correct. OK");

try {
  playYearOfPlenty(buyState, devPlayerId, ["wood", "wood"]);
  fail("a card bought this same turn should not be playable yet");
} catch {
  console.log("playYearOfPlenty correctly rejected a card bought this same turn. OK");
}

try {
  const brokeBuyer = {
    ...buyState,
    players: buyState.players.map((p) =>
      p.playerId === devPlayerId ? { ...p, resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 } } : p
    ),
  };
  buyDevCard(brokeBuyer, devPlayerId);
  fail("buyDevCard should reject insufficient resources");
} catch {
  console.log("buyDevCard correctly rejected insufficient resources. OK");
}

// Verify advanceTurn's real merge logic (not a hand-rolled replica of it):
// cycle turns (forcing postRoll each time so this doesn't depend on dice)
// until it's the buyer's turn again, and confirm newDevCards merged in.
let mergeState: GameState = { ...buyState, turnSubphase: "postRoll" };
mergeState = advanceTurn(mergeState, devPlayerId);
while (mergeState.turnOrder[mergeState.currentPlayerIndex] !== devPlayerId) {
  mergeState = { ...mergeState, turnSubphase: "postRoll" };
  mergeState = advanceTurn(mergeState, mergeState.turnOrder[mergeState.currentPlayerIndex]);
}
const mergedPlayer = mergeState.players.find((p) => p.playerId === devPlayerId)!;
if (mergedPlayer.devCards.yearOfPlenty !== 1 || mergedPlayer.newDevCards.yearOfPlenty !== 0) {
  fail("advanceTurn should merge newDevCards into devCards once it's the buyer's turn again");
}
console.log("advanceTurn correctly merges newDevCards -> devCards on the buyer's next turn. OK");

// --- playYearOfPlenty ---
const resourcesBeforeYop = { ...mergedPlayer.resources };
let yopState = playYearOfPlenty(mergeState, devPlayerId, ["wood", "brick"]);
let yopPlayer = yopState.players.find((p) => p.playerId === devPlayerId)!;
if (yopPlayer.resources.wood !== resourcesBeforeYop.wood + 1 || yopPlayer.resources.brick !== resourcesBeforeYop.brick + 1) {
  fail("playYearOfPlenty should grant exactly the two chosen resources");
}
if (yopPlayer.devCards.yearOfPlenty !== 0) fail("playYearOfPlenty should consume the card");
if (!yopState.devCardPlayedThisTurn) fail("devCardPlayedThisTurn should be set after playing a card");
console.log("playYearOfPlenty: resource grant, card consumption, one-per-turn flag all correct. OK");

try {
  playMonopoly(yopState, devPlayerId, "wood");
  fail("a second dev-card play in the same turn should be rejected");
} catch {
  console.log("Correctly rejected a second dev-card play in the same turn (one-per-turn rule). OK");
}

// --- playMonopoly ---
let monoState: GameState = {
  ...state,
  players: state.players.map((p) =>
    p.playerId === devPlayerId
      ? { ...p, resources: { ...p.resources, ore: 2 }, devCards: { ...emptyDevCardCounts(), monopoly: 1 } }
      : { ...p, resources: { ...p.resources, ore: p.playerId === otherIds[0] ? 3 : 1 } }
  ),
};
const oreBeforeTotal = monoState.players.reduce((sum, p) => sum + p.resources.ore, 0);
monoState = playMonopoly(monoState, devPlayerId, "ore");
const monoPlayerAfter = monoState.players.find((p) => p.playerId === devPlayerId)!;
if (monoPlayerAfter.resources.ore !== oreBeforeTotal) fail("Monopoly should give the player every ore card, including their own");
for (const p of monoState.players) {
  if (p.playerId !== devPlayerId && p.resources.ore !== 0) fail(`Monopoly should leave ${p.nickname} with zero ore`);
}
if (monoPlayerAfter.devCards.monopoly !== 0) fail("playMonopoly should consume the card");
console.log("playMonopoly: transferred all ore from every other player, card consumed. OK");

// --- playKnight + Largest Army ---
console.log("\nTesting Knight + Largest Army.");

// Reused across all three knight plays below: pick any non-robber tile and
// automatically supply a victim if the tile happens to have one, mirroring
// what a real client (or the server itself) would resolve — this test
// isn't about the steal mechanic (already covered by the robber block
// above), just knightsPlayed/Largest Army bookkeeping.
function playKnightSafely(gs: GameState, actorId: string): GameState {
  const targetTile = gs.board.tiles.find((t) => t.id !== gs.board.robberTileId)!.id;
  const victim = stealCandidates(gs, actorId, targetTile)[0];
  return playKnight(gs, actorId, targetTile, victim);
}

let armyState: GameState = {
  ...state,
  players: state.players.map((p) =>
    p.playerId === devPlayerId ? { ...p, devCards: { ...emptyDevCardCounts(), knight: 1 }, knightsPlayed: 2 } : p
  ),
};
const publicVpBefore = publicVictoryPoints(armyState, devPlayerId);
armyState = playKnightSafely(armyState, devPlayerId);
let armyPlayer = armyState.players.find((p) => p.playerId === devPlayerId)!;
if (armyPlayer.knightsPlayed !== 3) fail("playKnight should increment knightsPlayed");
if (armyPlayer.devCards.knight !== 0) fail("playKnight should consume the card");
if (armyState.largestArmy !== devPlayerId) fail("reaching 3 knights should claim Largest Army");
if (publicVictoryPoints(armyState, devPlayerId) !== publicVpBefore + 2) fail("Largest Army should be worth +2 public VP");
console.log("playKnight: knightsPlayed + Largest Army award (+2 VP) correct. OK");

// Overtake: a challenger reaches strictly more knights.
const challengerId = otherIds[0];
let overtakeState: GameState = {
  ...armyState,
  currentPlayerIndex: armyState.turnOrder.indexOf(challengerId),
  turnSubphase: "postRoll",
  devCardPlayedThisTurn: false,
  players: armyState.players.map((p) =>
    p.playerId === challengerId ? { ...p, devCards: { ...emptyDevCardCounts(), knight: 1 }, knightsPlayed: 3 } : p
  ),
};
overtakeState = playKnightSafely(overtakeState, challengerId);
if (overtakeState.largestArmy !== challengerId) fail("a strictly higher knight count should take over Largest Army");
console.log("Largest Army correctly transferred to a strictly higher count. OK");

// Tie should NOT transfer it away from the current holder.
let tieState: GameState = {
  ...overtakeState,
  currentPlayerIndex: overtakeState.turnOrder.indexOf(devPlayerId),
  turnSubphase: "postRoll",
  devCardPlayedThisTurn: false,
  players: overtakeState.players.map((p) =>
    p.playerId === devPlayerId ? { ...p, devCards: { ...emptyDevCardCounts(), knight: 1 }, knightsPlayed: 3 } : p
  ),
};
tieState = playKnightSafely(tieState, devPlayerId);
const devPlayerAfterTie = tieState.players.find((p) => p.playerId === devPlayerId)!;
if (devPlayerAfterTie.knightsPlayed !== 4) fail("expected devPlayerId to reach 4 knights for the tie test");
if (tieState.largestArmy !== challengerId) fail("a tie should NOT transfer Largest Army away from the current holder");
console.log("Largest Army correctly stayed with the current holder on a tie. OK");

// --- Longest Road: computed directly against hand-built boards, so the
// algorithm (chain length, breaking on an opponent's building, overtake)
// is tested precisely rather than hoping the real random board happens to
// produce the right shape. ---
console.log("\nTesting Longest Road (length, break, overtake).");

function testEdge(id: string, a: string, b: string, playerId?: string) {
  return { id, endpoints: [a, b] as [string, string], adjacentTileIds: [], road: playerId ? { playerId } : null };
}
function testVertex(id: string, playerId?: string) {
  return {
    id,
    coord: { x: 0, y: 0 },
    adjacentTileIds: [],
    adjacentVertexIds: [],
    building: playerId ? { playerId, type: "settlement" as const } : null,
  };
}

const pA = devPlayerId;
const pB = otherIds[0];

const roadBoard1: Board = {
  tiles: [],
  ports: [],
  robberTileId: "none",
  vertices: {
    V1: testVertex("V1"),
    V2: testVertex("V2"),
    V3: testVertex("V3"),
    V4: testVertex("V4"),
    V5: testVertex("V5"),
    V6: testVertex("V6"),
  },
  edges: {
    E1: testEdge("E1", "V1", "V2", pA),
    E2: testEdge("E2", "V2", "V3", pA),
    E3: testEdge("E3", "V3", "V4", pA),
    E4: testEdge("E4", "V4", "V5", pA),
    E5: testEdge("E5", "V5", "V6", pA),
  },
};
const lenPA = longestRoadLength(roadBoard1, pA);
if (lenPA !== 5) fail(`expected a straight 5-edge chain to measure as length 5, got ${lenPA}`);

let lrState: GameState = { ...state, board: roadBoard1, longestRoad: null };
const publicVpBeforeLR = publicVictoryPoints(lrState, pA);
lrState = recomputeLongestRoad(lrState);
if (lrState.longestRoad !== pA) fail("a player with a 5-edge chain should be awarded Longest Road");
if (publicVictoryPoints(lrState, pA) !== publicVpBeforeLR + 2) fail("Longest Road should be worth +2 public VP");
console.log("recomputeLongestRoad: 5-edge chain correctly awarded (+2 VP). OK");

// Break it: an opponent's settlement lands on V3, the middle vertex.
const roadBoard2: Board = { ...roadBoard1, vertices: { ...roadBoard1.vertices, V3: testVertex("V3", pB) } };
const lenAfterBreak = longestRoadLength(roadBoard2, pA);
if (lenAfterBreak >= 5) fail(`expected the chain to break below 5 with an opponent's town at V3, got ${lenAfterBreak}`);
let lrState2: GameState = { ...state, board: roadBoard2, longestRoad: pA };
lrState2 = recomputeLongestRoad(lrState2);
if (lrState2.longestRoad !== null) fail("Longest Road should be lost outright once the chain breaks below the minimum");
console.log("An opponent's building mid-chain correctly breaks and loses Longest Road. OK");

// Overtake: a separate, longer (unbroken) chain for pB.
const roadBoard3: Board = {
  ...roadBoard1,
  vertices: {
    ...roadBoard1.vertices,
    W1: testVertex("W1"),
    W2: testVertex("W2"),
    W3: testVertex("W3"),
    W4: testVertex("W4"),
    W5: testVertex("W5"),
    W6: testVertex("W6"),
    W7: testVertex("W7"),
  },
  edges: {
    ...roadBoard1.edges,
    F1: testEdge("F1", "W1", "W2", pB),
    F2: testEdge("F2", "W2", "W3", pB),
    F3: testEdge("F3", "W3", "W4", pB),
    F4: testEdge("F4", "W4", "W5", pB),
    F5: testEdge("F5", "W5", "W6", pB),
    F6: testEdge("F6", "W6", "W7", pB),
  },
};
let lrState3: GameState = { ...state, board: roadBoard3, longestRoad: pA };
lrState3 = recomputeLongestRoad(lrState3);
if (lrState3.longestRoad !== pB) fail("a strictly longer chain (6 > 5) should take over Longest Road");
console.log("recomputeLongestRoad correctly transferred Longest Road to a strictly longer chain. OK");

// --- playRoadBuilding mechanics (free placement, no cost) against the real board ---
console.log("\nTesting playRoadBuilding (free roads, no cost).");
let rbState: GameState = {
  ...state,
  players: state.players.map((p) =>
    p.playerId === devPlayerId ? { ...p, devCards: { ...emptyDevCardCounts(), roadBuilding: 1 } } : p
  ),
};
const legalEdgesForRB = Object.keys(rbState.board.edges).filter((eid) => canPlaceRoad(rbState.board, devPlayerId, eid));
if (legalEdgesForRB.length === 0) fail("expected at least one legal road spot for the playRoadBuilding test");
const rbPick = legalEdgesForRB.slice(0, 1);
const roadsBeforeRB = rbState.players.find((p) => p.playerId === devPlayerId)!.roadsLeft;
const resourcesBeforeRB = { ...rbState.players.find((p) => p.playerId === devPlayerId)!.resources };
rbState = playRoadBuilding(rbState, devPlayerId, rbPick);
const rbPlayer = rbState.players.find((p) => p.playerId === devPlayerId)!;
if (rbPlayer.roadsLeft !== roadsBeforeRB - 1) fail("playRoadBuilding should decrement roadsLeft by the number of roads placed");
if (JSON.stringify(rbPlayer.resources) !== JSON.stringify(resourcesBeforeRB)) fail("playRoadBuilding must not cost any resources");
if (rbPlayer.devCards.roadBuilding !== 0) fail("playRoadBuilding should consume the card");
if (!rbState.board.edges[rbPick[0]].road) fail("the picked edge should now have a road");
console.log("playRoadBuilding: free placement, no resource cost, card consumed. OK");

// --- Phase 8: Trading (bank/port ratios + player-to-player propose/respond/confirm/cancel) ---
console.log("\nTesting trading (bank/port + player-to-player).");

const tradePlayerId = state.turnOrder[state.currentPlayerIndex]; // still builderId/devPlayerId, current turn
const tradeOthers = state.turnOrder.filter((id) => id !== tradePlayerId);
const [respA, respB] = tradeOthers;

// --- getBestRatio: 4:1 default, 3:1 with a generic port, 2:1 with a
// matching-resource port, and matching-resource must win over a
// simultaneously-held generic port. Hand-built ports/vertices (like the
// Longest Road tests above) rather than depending on the real random
// board happening to give the trade player a port. ---
const portTestBoard: Board = {
  ...state.board,
  vertices: {
    ...state.board.vertices,
    PV1: testVertex("PV1", tradePlayerId),
    PV2: testVertex("PV2"),
    PV3: testVertex("PV3", tradePlayerId),
    PV4: testVertex("PV4"),
  },
  ports: [
    { vertices: ["PV1", "PV2"] as [string, string], ratio: 3, resource: "any" },
    { vertices: ["PV3", "PV4"] as [string, string], ratio: 2, resource: "wood" },
  ],
};

const noPortState: GameState = { ...state, board: { ...state.board, ports: [] } };
if (getBestRatio(noPortState, tradePlayerId, "wood") !== 4) fail("getBestRatio should default to 4:1 with no ports owned");

const genericOnlyState: GameState = { ...state, board: { ...portTestBoard, ports: [portTestBoard.ports[0]] } };
if (getBestRatio(genericOnlyState, tradePlayerId, "wood") !== 3) fail("getBestRatio should return 3:1 with a generic port owned");

const bothPortsState: GameState = { ...state, board: portTestBoard };
if (getBestRatio(bothPortsState, tradePlayerId, "wood") !== 2) {
  fail("getBestRatio should prefer a matching-resource 2:1 port over a generic 3:1 one");
}
if (getBestRatio(bothPortsState, tradePlayerId, "ore") !== 3) {
  fail("getBestRatio should fall back to the generic port's 3:1 rate for a non-matching resource");
}
console.log("getBestRatio: 4:1 default, 3:1 generic, 2:1 matching-resource (and it wins over generic). OK");

// --- bankTrade --- (ports stripped from the board for these: the real
// board's port placement is random, and by this point in the script the
// trade player has built several settlements at BFS-found spots that could
// coincidentally land on a port vertex — these tests are specifically
// about the 4:1 no-port default, already covered separately above by
// getBestRatio's own port-owning cases).
let bankState: GameState = {
  ...state,
  board: { ...state.board, ports: [] },
  players: state.players.map((p) =>
    p.playerId === tradePlayerId ? { ...p, resources: { wood: 4, brick: 0, sheep: 0, wheat: 0, ore: 0 } } : p
  ),
};
bankState = bankTrade(bankState, tradePlayerId, "wood", 4, "brick");
const traderAfterBank = bankState.players.find((p) => p.playerId === tradePlayerId)!;
if (traderAfterBank.resources.wood !== 0 || traderAfterBank.resources.brick !== 1) {
  fail("bankTrade at 4:1 should deduct exactly 4 and credit exactly 1");
}
console.log("bankTrade: 4:1 default ratio deducts/credits correctly. OK");

try {
  bankTrade(bankState, tradePlayerId, "brick", 4, "wood"); // only has 1 brick
  fail("bankTrade should reject insufficient resources");
} catch {
  console.log("bankTrade correctly rejected insufficient resources. OK");
}

try {
  bankTrade(bankState, tradePlayerId, "wood", 3, "brick");
  fail("bankTrade should reject a giveAmount that doesn't match the player's actual ratio");
} catch {
  console.log("bankTrade correctly rejected a wrong giveAmount. OK");
}

try {
  bankTrade(bankState, tradePlayerId, "wood", 4, "wood");
  fail("bankTrade should reject trading a resource for itself");
} catch {
  console.log("bankTrade correctly rejected give === receive. OK");
}

try {
  bankTrade(bankState, respA, "wood", 4, "brick");
  fail("bankTrade should reject a player acting out of turn");
} catch {
  console.log("bankTrade correctly rejected an out-of-turn player. OK");
}

try {
  bankTrade({ ...bankState, turnSubphase: "moveRobber" }, tradePlayerId, "wood", 4, "brick");
  fail("bankTrade should be rejected while the robber is unresolved");
} catch {
  console.log("bankTrade correctly rejected while robber-unresolved. OK");
}

// --- proposeTrade / respondTrade / confirmTrade / cancelTrade ---
let tradeFlowState: GameState = {
  ...state,
  players: state.players.map((p) => {
    if (p.playerId === tradePlayerId) return { ...p, resources: { wood: 3, brick: 0, sheep: 0, wheat: 0, ore: 0 } };
    if (p.playerId === respA || p.playerId === respB) return { ...p, resources: { wood: 0, brick: 0, sheep: 0, wheat: 2, ore: 0 } };
    return p;
  }),
};

try {
  proposeTrade(tradeFlowState, tradePlayerId, {}, { wheat: 1 });
  fail("proposeTrade should reject an empty offering");
} catch {
  console.log("proposeTrade correctly rejected an empty offering. OK");
}
try {
  proposeTrade(tradeFlowState, tradePlayerId, { wood: 1 }, {});
  fail("proposeTrade should reject an empty request");
} catch {
  console.log("proposeTrade correctly rejected an empty request. OK");
}
try {
  proposeTrade(tradeFlowState, tradePlayerId, { wood: 10 }, { wheat: 1 });
  fail("proposeTrade should reject offering more than the proposer holds");
} catch {
  console.log("proposeTrade correctly rejected an unaffordable offer. OK");
}

tradeFlowState = proposeTrade(tradeFlowState, tradePlayerId, { wood: 1 }, { wheat: 1 }); // open to everyone
const openTrade = tradeFlowState.pendingTrades[tradeFlowState.pendingTrades.length - 1];
if (!openTrade) fail("proposeTrade should add a pending trade");
if (openTrade.targetPlayerId !== null) fail("an untargeted proposeTrade call should produce an open (targetPlayerId: null) trade");

try {
  respondTrade(tradeFlowState, tradePlayerId, openTrade.id, "accepted");
  fail("respondTrade should reject the proposer responding to their own trade");
} catch {
  console.log("respondTrade correctly rejected the proposer responding to their own trade. OK");
}
try {
  respondTrade(tradeFlowState, respA, "not-a-real-trade-id", "accepted");
  fail("respondTrade should reject an unknown trade id");
} catch {
  console.log("respondTrade correctly rejected an unknown trade id. OK");
}

tradeFlowState = respondTrade(tradeFlowState, respA, openTrade.id, "accepted");
tradeFlowState = respondTrade(tradeFlowState, respB, openTrade.id, "accepted");
const respondedTrade = tradeFlowState.pendingTrades.find((t) => t.id === openTrade.id)!;
if (respondedTrade.respondedBy[respA] !== "accepted" || respondedTrade.respondedBy[respB] !== "accepted") {
  fail("respondTrade should record both acceptances on the same open trade");
}
console.log("respondTrade: multiple players can accept the same open trade. OK");

try {
  confirmTrade(tradeFlowState, respA, openTrade.id, respB);
  fail("confirmTrade should reject anyone but the proposer");
} catch {
  console.log("confirmTrade correctly rejected a non-proposer. OK");
}
try {
  confirmTrade(tradeFlowState, tradePlayerId, openTrade.id, "not-a-real-player");
  fail("confirmTrade should reject confirming with a player who hasn't accepted");
} catch {
  console.log("confirmTrade correctly rejected confirming with a non-accepter. OK");
}

const proposerBeforeConfirm = tradeFlowState.players.find((p) => p.playerId === tradePlayerId)!;
const respAbeforeConfirm = tradeFlowState.players.find((p) => p.playerId === respA)!;
const respBbeforeConfirm = tradeFlowState.players.find((p) => p.playerId === respB)!;
tradeFlowState = confirmTrade(tradeFlowState, tradePlayerId, openTrade.id, respA);

const proposerAfterConfirm = tradeFlowState.players.find((p) => p.playerId === tradePlayerId)!;
const respAafterConfirm = tradeFlowState.players.find((p) => p.playerId === respA)!;
const respBafterConfirm = tradeFlowState.players.find((p) => p.playerId === respB)!;

if (proposerAfterConfirm.resources.wood !== proposerBeforeConfirm.resources.wood - 1) fail("confirmTrade should deduct exactly what the proposer offered");
if (proposerAfterConfirm.resources.wheat !== proposerBeforeConfirm.resources.wheat + 1) fail("confirmTrade should credit the proposer with exactly what they requested");
if (respAafterConfirm.resources.wheat !== respAbeforeConfirm.resources.wheat - 1) fail("confirmTrade should deduct exactly what the confirmed counterparty gave up");
if (respAafterConfirm.resources.wood !== respAbeforeConfirm.resources.wood + 1) fail("confirmTrade should credit the confirmed counterparty with exactly what the proposer offered");
if (respBafterConfirm.resources.wheat !== respBbeforeConfirm.resources.wheat) fail("confirmTrade should leave the non-chosen accepter's hand untouched");
if (tradeFlowState.pendingTrades.some((t) => t.id === openTrade.id)) fail("confirmTrade should remove the trade from pendingTrades once finalized");
console.log("confirmTrade: swapped resources only with the chosen accepter, left the other's acceptance moot, and cleared the trade. OK");

try {
  confirmTrade(tradeFlowState, tradePlayerId, openTrade.id, respA);
  fail("confirmTrade should reject a trade id that's already gone");
} catch {
  console.log("confirmTrade correctly rejected an already-finalized/removed trade. OK");
}

// --- Targeted trades only accept a response from the named target ---
const targetedState = proposeTrade(tradeFlowState, tradePlayerId, { wood: 1 }, { wheat: 1 }, respA);
const targetedTrade = targetedState.pendingTrades[targetedState.pendingTrades.length - 1];
try {
  respondTrade(targetedState, respB, targetedTrade.id, "accepted");
  fail("respondTrade should reject a response from someone a targeted trade wasn't offered to");
} catch {
  console.log("respondTrade correctly rejected a response from a non-targeted player. OK");
}

// --- cancelTrade ---
try {
  cancelTrade(targetedState, respA, targetedTrade.id);
  fail("cancelTrade should reject anyone but the proposer");
} catch {
  console.log("cancelTrade correctly rejected a non-proposer. OK");
}
const cancelledState = cancelTrade(targetedState, tradePlayerId, targetedTrade.id);
if (cancelledState.pendingTrades.some((t) => t.id === targetedTrade.id)) fail("cancelTrade should remove the open trade");
console.log("cancelTrade: proposer can withdraw an open offer. OK");

// --- confirmTrade re-validates hands that changed since the offer went out ---
let staleState = proposeTrade(tradeFlowState, tradePlayerId, { wood: 1 }, { wheat: 1 });
const staleTrade = staleState.pendingTrades[staleState.pendingTrades.length - 1];
staleState = respondTrade(staleState, respB, staleTrade.id, "accepted");
staleState = {
  ...staleState,
  players: staleState.players.map((p) => (p.playerId === respB ? { ...p, resources: { ...p.resources, wheat: 0 } } : p)),
};
try {
  confirmTrade(staleState, tradePlayerId, staleTrade.id, respB);
  fail("confirmTrade should re-validate the counterparty's hand and reject a now-stale trade");
} catch {
  console.log("confirmTrade correctly re-validated the counterparty's hand and rejected a stale trade. OK");
}

// --- advanceTurn clears any trades left pending ---
const pendingAtTurnEnd: GameState = {
  ...tradeFlowState,
  turnSubphase: "postRoll",
  pendingTrades: [{ id: "leftover", proposerId: tradePlayerId, offering: { wood: 1 }, requesting: { wheat: 1 }, targetPlayerId: null, respondedBy: {} }],
};
const afterTurnEnd = advanceTurn(pendingAtTurnEnd, tradePlayerId);
if (afterTurnEnd.pendingTrades.length !== 0) fail("advanceTurn should clear any pendingTrades left over from the ending turn");
console.log("advanceTurn correctly clears leftover pendingTrades. OK");

// --- Hidden Victory Point dev card win ---
console.log("\nTesting a hidden Victory Point dev card win.");
let hiddenWinState: GameState = {
  ...state,
  devDeck: ["knight", "knight", "victoryPoint"], // pop() draws "victoryPoint" first
  players: state.players.map((p) =>
    p.playerId === devPlayerId
      ? { ...p, victoryPoints: 9, resources: { wood: 0, brick: 0, sheep: 1, wheat: 1, ore: 1 } }
      : p
  ),
};
if (checkWinCondition(hiddenWinState) !== null) fail("should not be won yet — 9 public VP, no hidden card drawn");
hiddenWinState = buyDevCard(hiddenWinState, devPlayerId);
if (hiddenWinState.phase !== "ended") fail("a hidden Victory Point card pushing total VP to 10 should end the game immediately");
if (hiddenWinState.winnerId !== devPlayerId) fail(`expected winnerId ${devPlayerId}, got ${hiddenWinState.winnerId}`);
if (publicVictoryPoints(hiddenWinState, devPlayerId) !== 9) fail("publicVictoryPoints should not reveal the hidden Victory Point card");
if (totalVictoryPoints(hiddenWinState, devPlayerId) < 10) fail("totalVictoryPoints should include the hidden Victory Point card");
console.log("A hidden Victory Point card correctly triggers an immediate win, and stays hidden from publicVictoryPoints. OK");

try {
  buyDevCard(hiddenWinState, devPlayerId);
  fail("post-game actions should be rejected once the game has ended");
} catch (e) {
  if (!(e instanceof Error) || !e.message.includes("already ended")) fail(`expected an "already ended" rejection, got: ${e}`);
  console.log('Post-game buyDevCard correctly rejected with "already ended". OK');
}

// --- Win condition ---
// Directly boost the builder to one settlement short of winning (bypassing
// the long grind of getting there for real) so the test stays fast and
// still exercises the actual applyWinCheck/checkWinCondition path. Also
// clears any Largest Army/Longest Road bonus so this test's own math (9
// base + this one settlement = 10) stays the deterministic thing under
// test, not whatever the earlier Phase 7 tests happened to leave behind.
state = {
  ...state,
  largestArmy: null,
  longestRoad: null,
  players: state.players.map((p) =>
    p.playerId === builderId
      ? { ...p, victoryPoints: 9, resources: { wood: 10, brick: 10, sheep: 10, wheat: 10, ore: 10 } }
      : p
  ),
};
if (checkWinCondition(state) !== null) fail("checkWinCondition should be null before anyone hits 10 VP");

const winFound = findSettlementPath(state, builderId);
if (!winFound) fail("expected a legal settlement path for the win-condition test");
for (const edgeId of winFound!.edgesToBuild) {
  // Building enough connected roads to reach the settlement spot can, in
  // principle, hand the builder Longest Road first (its own +2 VP source
  // now that Phase 7 exists) and end the game right there — a legitimate
  // early win via buildRoad's own win check, not a bug, so don't try to
  // keep building past it.
  if (state.phase === "ended") break;
  state = buildRoad(state, builderId, edgeId);
}
if (state.phase !== "ended") {
  state = buildSettlement(state, builderId, winFound!.vertex);
}

if (state.phase !== "ended") fail(`expected phase "ended" after crossing 10 VP, got "${state.phase}"`);
if (state.winnerId !== builderId) fail(`expected winnerId ${builderId}, got ${state.winnerId}`);
const finalBuilder = state.players.find((p) => p.playerId === builderId)!;
const finalBuilderVP = totalVictoryPoints(state, builderId);
if (finalBuilderVP < 10) fail("winner should have at least 10 total VP");
console.log(`Win condition: ${finalBuilder.nickname} won at ${finalBuilderVP} VP. Phase is "ended". OK`);

try {
  advanceTurn(state, builderId);
  fail("advanceTurn should reject any action once the game has ended");
} catch (e) {
  if (!(e instanceof Error) || !e.message.includes("already ended")) {
    fail(`expected an "already ended" rejection, got: ${e}`);
  }
  console.log('Post-game actions correctly rejected with "already ended". OK');
}

console.log("\nDEMO OK");
