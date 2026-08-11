// In-memory room/lobby lifecycle: create, join, rejoin, ready-up, start.
// Room membership/status lives here; once a room starts, the authoritative
// GameState (src/lib/game/state.ts) is created and held on the room too —
// this module owns *when* a game exists, src/lib/game/* owns what happens
// inside one. Everything is held in the `rooms` Map for the lifetime of
// the Node process; nothing survives a restart (accepted MVP tradeoff).

import { randomUUID } from "crypto";
import { PlayerMeta, RoomSnapshot, RoomStatus } from "../src/lib/socketEvents";
import { createGameState, GameState } from "../src/lib/game/state";

// Excludes visually-ambiguous characters (0/O, 1/I) so room codes are easy
// to read aloud and type back in.
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 4;
export const MAX_PLAYERS = 6;

type Player = PlayerMeta & { socketId: string | null };

type Room = {
  code: string;
  status: RoomStatus;
  hostPlayerId: string;
  players: Map<string, Player>; // keyed by playerId
  gameState: GameState | null;
};

type Failure = { error: string };

const rooms = new Map<string, Room>();

function generateRoomCode(): string {
  let code: string;
  do {
    code = Array.from(
      { length: ROOM_CODE_LENGTH },
      () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

export function toSnapshot(room: Room): RoomSnapshot {
  return {
    code: room.code,
    status: room.status,
    maxPlayers: MAX_PLAYERS,
    players: Array.from(room.players.values()).map(({ socketId, ...meta }) => meta),
  };
}

export function getRoom(roomCode: string): Room | undefined {
  return rooms.get(roomCode.toUpperCase());
}

export function createRoom(nickname: string, socketId: string): { room: Room; playerId: string } {
  const code = generateRoomCode();
  const playerId = randomUUID();
  const player: Player = { playerId, nickname, isHost: true, ready: false, connected: true, socketId };
  const room: Room = {
    code,
    status: "lobby",
    hostPlayerId: playerId,
    players: new Map([[playerId, player]]),
    gameState: null,
  };
  rooms.set(code, room);
  return { room, playerId };
}

export function joinRoom(
  roomCode: string,
  nickname: string,
  socketId: string
): { room: Room; playerId: string } | Failure {
  const room = getRoom(roomCode);
  if (!room) return { error: "Room not found" };
  if (room.status !== "lobby") return { error: "That game has already started" };
  if (room.players.size >= MAX_PLAYERS) return { error: `Room is full (max ${MAX_PLAYERS} players)` };
  const nameTaken = Array.from(room.players.values()).some(
    (p) => p.nickname.toLowerCase() === nickname.toLowerCase()
  );
  if (nameTaken) return { error: "That nickname is already taken in this room" };

  const playerId = randomUUID();
  const player: Player = { playerId, nickname, isHost: false, ready: false, connected: true, socketId };
  room.players.set(playerId, player);
  return { room, playerId };
}

export function rejoinRoom(
  roomCode: string,
  playerId: string,
  socketId: string
): { room: Room; playerId: string } | Failure {
  const room = getRoom(roomCode);
  if (!room) return { error: "Room not found" };
  const player = room.players.get(playerId);
  if (!player) return { error: "You're not a player in this room" };
  player.socketId = socketId;
  player.connected = true;
  return { room, playerId };
}

export function setReady(roomCode: string, playerId: string, ready: boolean): Room | null {
  const room = getRoom(roomCode);
  const player = room?.players.get(playerId);
  if (!room || !player) return null;
  player.ready = ready;
  return room;
}

export function startRoom(roomCode: string, requesterPlayerId: string): { room: Room } | Failure {
  const room = getRoom(roomCode);
  if (!room) return { error: "Room not found" };
  if (room.hostPlayerId !== requesterPlayerId) return { error: "Only the host can start the game" };
  if (room.players.size < 2) return { error: "Need at least 2 players to start" };
  const allReady = Array.from(room.players.values()).every((p) => p.ready);
  if (!allReady) return { error: "All players must be ready" };
  room.status = "playing";
  room.gameState = createGameState(
    Array.from(room.players.values()).map((p) => ({ playerId: p.playerId, nickname: p.nickname }))
  );
  return { room };
}

/** Marks whichever player owns this socket as disconnected. Doesn't remove
 * them — losing a seat mid-lobby/game would break turn order and room
 * membership, so they stay listed with connected:false instead. */
export function markDisconnected(socketId: string): Room | null {
  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      if (player.socketId === socketId) {
        player.connected = false;
        player.socketId = null;
        return room;
      }
    }
  }
  return null;
}
