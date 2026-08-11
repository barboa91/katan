// GameState shape + the factory that starts a fresh game. Turn order is
// randomized here (a simplification of the real rule, where players roll
// dice to determine seating) — noted as a deliberate MVP shortcut, not an
// oversight.

import { Board, DevCardType, Resource } from "./types";
import { createBoard } from "./boardGen";
import { boardSizeForPlayerCount } from "./boardTemplates";
import { createDevDeck, emptyDevCardCounts } from "./devCards";
import { shuffle } from "./random";

export type PlayerState = {
  playerId: string;
  nickname: string;
  color: string;
  resources: Record<Resource, number>;
  /** "Building VP" only (1/settlement, 2/city) — Largest Army, Longest
   * Road, and Victory Point dev cards are bonus sources layered on top by
   * rules.ts's publicVictoryPoints/totalVictoryPoints, not folded in here,
   * so overtaking a bonus never requires hunting down and undoing a
   * mutation somewhere else. */
  victoryPoints: number;
  settlementsLeft: number;
  citiesLeft: number;
  roadsLeft: number;
  /** Playable dev cards — bought on an earlier turn. */
  devCards: Record<DevCardType, number>;
  /** Bought this turn, not yet playable (official rule: a dev card can't
   * be played the same turn it's bought — except Victory Point cards,
   * which aren't "played" at all and always count toward the win check
   * regardless of which bucket they're in). Merged into devCards at the
   * start of this player's next turn (see rules.ts's advanceTurn). */
  newDevCards: Record<DevCardType, number>;
  knightsPlayed: number;
};

export type GamePhase = "setup" | "main" | "ended";
export type SetupSubphase = "placeSettlement" | "placeRoad";
/** "discarding" and "moveRobber" only appear after a 7 is rolled (or a
 * Knight dev card is played, later): discarding blocks on every over-limit
 * player individually, moveRobber blocks on the current turn player only.
 * Building is disallowed in both (see rules.ts's assertRobberResolved). */
export type TurnSubphase = "preRoll" | "discarding" | "moveRobber" | "postRoll";

/** Setup placement walks every player once (in turn order), then again in
 * reverse — the standard Catan "snake" order — so `order` is just
 * `[...turnOrder, ...reversed(turnOrder)]` computed once at game start. */
export type SetupState = {
  order: string[];
  index: number;
  subphase: SetupSubphase;
  pendingSettlementVertexId: string | null;
};

export type DiceRoll = { die1: number; die2: number; total: number };

/** A player-to-player trade proposal (see tradeRules.ts). `targetPlayerId:
 * null` means open to the whole table (shout an offer to everyone), same
 * as the physical game — otherwise it's a direct offer to one player.
 * `respondedBy` accumulates as other players accept/reject; the proposer
 * then picks which accepter to actually finalize with via confirmTrade,
 * exactly like passing cards across the table when more than one person
 * says yes. Doesn't move any resources until confirmTrade runs. */
export type TradeOffer = {
  id: string;
  proposerId: string;
  offering: Partial<Record<Resource, number>>;
  requesting: Partial<Record<Resource, number>>;
  targetPlayerId: string | null;
  respondedBy: Record<string, "accepted" | "rejected">;
};

export type GameState = {
  board: Board;
  players: PlayerState[];
  turnOrder: string[];
  currentPlayerIndex: number;
  phase: GamePhase;
  setup: SetupState | null;
  turnSubphase: TurnSubphase;
  lastRoll: DiceRoll | null;
  /** playerId -> cards still owed, only populated while turnSubphase is
   * "discarding". Entries are removed as each player discards; the
   * subphase advances to "moveRobber" once this is empty. */
  discardsOwed: Record<string, number>;
  /** Shuffled once at game start; buyDevCard draws from the end. */
  devDeck: DevCardType[];
  /** Official rule: at most one dev card played per turn (buying is
   * unlimited; playing isn't). Reset to false whenever advanceTurn moves
   * to a new current player. */
  devCardPlayedThisTurn: boolean;
  /** Holder of the +2 VP Largest Army bonus (>=3 knights played, must be
   * strictly ahead of the previous holder to take it) — see bonusVP.ts. */
  largestArmy: string | null;
  /** Holder of the +2 VP Longest Road bonus (>=5 continuous road edges,
   * broken by an opponent's building along the chain) — see bonusVP.ts. */
  longestRoad: string | null;
  /** Set once phase becomes "ended" (see rules.ts's checkWinCondition). */
  winnerId: string | null;
  /** Open player-to-player trade proposals, turn-scoped — advanceTurn
   * clears whatever's left here, same as the physical game where an
   * outstanding offer only makes sense during the proposer's own turn. */
  pendingTrades: TradeOffer[];
  /** 5-6 player games only (see boardTemplates.ts's usesSpecialBuildingPhase
   * — 4-player games never set this). `null` outside of a Special Building
   * Phase. While non-null, the ordered queue of players still owed a
   * build-only mini-turn after the active player (turnOrder[currentPlayerIndex])
   * ended their real turn — specialBuilding[0] is whoever may currently
   * build/buy a dev card (see rules.ts's assertBuildOrBuyTurn). Note
   * currentPlayerIndex deliberately does NOT move while this is set — the
   * player who triggered the phase is still "current" by index, but
   * assertMainPhaseTurn blocks them (and everyone else) from every
   * non-build action until the queue drains via passSpecialBuildingTurn. */
  specialBuilding: string[] | null;
  /** Lightweight human-readable event feed, for the UI — not authoritative state. */
  log: string[];
};

const PLAYER_COLORS = ["#c0392b", "#2d6cb5", "#e08e0b", "#2f7a3d", "#8146b0", "#8a5a2b"];

/** The zero-resources starting hand — also the canonical shape for any UI
 * that needs an empty resource selection (discard picker, trade proposer). */
export function emptyResources(): Record<Resource, number> {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

export function createGameState(players: { playerId: string; nickname: string }[]): GameState {
  const turnOrder = shuffle(players.map((p) => p.playerId));
  const board = createBoard(players.length);
  const devDeck = createDevDeck(boardSizeForPlayerCount(players.length));

  const playersState: PlayerState[] = turnOrder.map((playerId, i) => {
    const meta = players.find((p) => p.playerId === playerId)!;
    return {
      playerId,
      nickname: meta.nickname,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      resources: emptyResources(),
      victoryPoints: 0,
      settlementsLeft: 5,
      citiesLeft: 4,
      roadsLeft: 15,
      devCards: emptyDevCardCounts(),
      newDevCards: emptyDevCardCounts(),
      knightsPlayed: 0,
    };
  });

  return {
    board,
    players: playersState,
    turnOrder,
    currentPlayerIndex: 0,
    phase: "setup",
    setup: {
      order: [...turnOrder, ...[...turnOrder].reverse()],
      index: 0,
      subphase: "placeSettlement",
      pendingSettlementVertexId: null,
    },
    turnSubphase: "preRoll",
    lastRoll: null,
    discardsOwed: {},
    devDeck,
    devCardPlayedThisTurn: false,
    largestArmy: null,
    longestRoad: null,
    winnerId: null,
    pendingTrades: [],
    specialBuilding: null,
    log: [],
  };
}
