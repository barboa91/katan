// Shared Socket.IO event/payload contract, imported by both the socket
// server (server/index.ts) and the Next.js client (SocketContext). Keeping
// this in one place means the client and server can't silently drift on
// event names or payload shapes — a typo becomes a type error instead of a
// silent runtime no-op.
//
// Gameplay actions intentionally don't take a playerId in their payload:
// the server resolves "who is acting" from the authenticated socket
// connection itself (see server/index.ts's socketIdentity map), not from
// anything the client claims. A client can only ever act as the player its
// own socket is attached to.

import { GameState } from "./game/state";
import { Resource } from "./game/types";

export type PlayDevCardPayload =
  | { type: "knight"; tileId: string; victimPlayerId?: string }
  | { type: "roadBuilding"; edgeIds: string[] }
  | { type: "yearOfPlenty"; resources: [Resource, Resource] }
  | { type: "monopoly"; resource: Resource };

export type RoomStatus = "lobby" | "playing" | "finished";

export type PlayerMeta = {
  playerId: string;
  nickname: string;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
};

export type RoomSnapshot = {
  code: string;
  status: RoomStatus;
  maxPlayers: number;
  players: PlayerMeta[];
};

export type RoomCreateResult =
  | { ok: true; roomCode: string; playerId: string; room: RoomSnapshot }
  | { ok: false; error: string };

export type RoomJoinResult =
  | { ok: true; playerId: string; room: RoomSnapshot }
  | { ok: false; error: string };

export interface ClientToServerEvents {
  "room:create": (payload: { nickname: string }, ack: (res: RoomCreateResult) => void) => void;
  "room:join": (
    payload: { roomCode: string; nickname: string },
    ack: (res: RoomJoinResult) => void
  ) => void;
  "room:rejoin": (
    payload: { roomCode: string; playerId: string },
    ack: (res: RoomJoinResult) => void
  ) => void;
  "room:ready": (payload: { ready: boolean }) => void;
  "room:start": () => void;
  "game:rollDice": () => void;
  /** targetId is a vertexId for "settlement"/"city", an edgeId for "road". */
  "game:build": (payload: { type: "settlement" | "road" | "city"; targetId: string }) => void;
  "game:endTurn": () => void;
  /** Only sent by a player who currently owes a discard (turnSubphase
   * "discarding"); resources must sum to exactly what's owed. */
  "game:discard": (payload: { resources: Partial<Record<Resource, number>> }) => void;
  /** Only sent by the current turn player while turnSubphase is
   * "moveRobber"; victimPlayerId is required iff the target tile has an
   * eligible neighbor to steal from. */
  "game:moveRobber": (payload: { tileId: string; victimPlayerId?: string }) => void;
  "game:buyDevCard": () => void;
  "game:playDevCard": (payload: PlayDevCardPayload) => void;
  /** giveAmount must match the sender's actual best ratio for `give` (see
   * tradeRules.ts's getBestRatio) — the server re-derives and enforces it
   * regardless of what's sent here. */
  "game:bankTrade": (payload: { give: Resource; giveAmount: number; receive: Resource }) => void;
  "game:proposeTrade": (payload: {
    offering: Partial<Record<Resource, number>>;
    requesting: Partial<Record<Resource, number>>;
    targetPlayerId?: string | null;
  }) => void;
  "game:respondTrade": (payload: { tradeId: string; response: "accepted" | "rejected" }) => void;
  "game:confirmTrade": (payload: { tradeId: string; counterpartyId: string }) => void;
  "game:cancelTrade": (payload: { tradeId: string }) => void;
}

export interface ServerToClientEvents {
  "room:playersUpdated": (room: RoomSnapshot) => void;
  "room:started": (room: RoomSnapshot) => void;
  "room:error": (payload: { message: string }) => void;
  /** Full-state broadcast, sent on every successful mutation and once on
   * room:rejoin so late joiners/refreshes catch up regardless of timing. */
  "game:state": (state: GameState) => void;
  "game:actionError": (payload: { message: string }) => void;
}
