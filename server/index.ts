// Socket.IO transport layer. Thin on purpose: every gameplay handler just
// resolves "who is this socket", calls into the game rules engine, and
// broadcasts the result. All 13 game:* handlers share the identical
// identity/room lookup + try/catch shape — factored into the gameAction()
// helper below rather than repeated per handler, so registering a new
// action is a one-line call and there's only one place that could forget
// the identity check or the catch.

import { createServer } from "http";
import { Server, Socket } from "socket.io";
import * as roomManager from "./roomManager";
import { ClientToServerEvents, ServerToClientEvents } from "../src/lib/socketEvents";
import {
  applyDiceRoll,
  advanceTurn,
  discard,
  moveRobber,
  passSpecialBuildingTurn,
} from "../src/lib/game/rules";
import { buyDevCard, playKnight, playRoadBuilding, playYearOfPlenty, playMonopoly } from "../src/lib/game/devCardRules";
import { bankTrade, proposeTrade, respondTrade, confirmTrade, cancelTrade } from "../src/lib/game/tradeRules";
import { applyBuildAction } from "../src/lib/game/setup";
import { GameState } from "../src/lib/game/state";

const PORT = process.env.SOCKET_PORT ? Number(process.env.SOCKET_PORT) : 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// Which room/player each live socket represents. Gameplay/room-action
// handlers (room:ready, room:start, and game:* events) look the player up
// here rather than trusting a client-supplied playerId — a client can only
// ever act as whichever player its own socket is bound to.
const socketIdentity = new Map<string, { roomCode: string; playerId: string }>();

function broadcastRoom(roomCode: string, event: "room:playersUpdated" | "room:started") {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  io.to(room.code).emit(event, roomManager.toSnapshot(room));
}

function broadcastGameState(roomCode: string, state: GameState) {
  io.to(roomCode).emit("game:state", state);
}

// The client only ever renders the last few lines (see page.tsx), but the
// full log is otherwise appended to forever and resent in full on every
// broadcast — capping it here (the single point every mutation passes
// through) keeps a long game's state pushes from growing without bound
// while still leaving plenty of history for a mid-game rejoin to catch up on.
const LOG_CAP = 100;

/** Wraps a src/lib/game/* mutator into a ready-to-register socket.io
 * listener: looks up the calling socket's room/identity, calls `fn` with
 * the current GameState and the resolved playerId, stores + broadcasts the
 * result on success, or emits game:actionError with whatever plain Error
 * `fn` threw. `fn` never needs to know about sockets/rooms at all. */
function gameAction<Args extends unknown[]>(
  socket: AppSocket,
  fn: (state: GameState, playerId: string, ...args: Args) => GameState
) {
  return (...args: Args) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = fn(room.gameState, identity.playerId, ...args);
      const capped = next.log.length > LOG_CAP ? { ...next, log: next.log.slice(-LOG_CAP) } : next;
      room.gameState = capped;
      broadcastGameState(room.code, capped);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  };
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ nickname }, ack) => {
    if (!nickname?.trim()) return ack({ ok: false, error: "Nickname is required" });
    const { room, playerId } = roomManager.createRoom(nickname.trim(), socket.id);
    socket.join(room.code);
    socketIdentity.set(socket.id, { roomCode: room.code, playerId });
    ack({ ok: true, roomCode: room.code, playerId, room: roomManager.toSnapshot(room) });
  });

  socket.on("room:join", ({ roomCode, nickname }, ack) => {
    if (!nickname?.trim()) return ack({ ok: false, error: "Nickname is required" });
    const result = roomManager.joinRoom(roomCode, nickname.trim(), socket.id);
    if ("error" in result) return ack({ ok: false, error: result.error });
    socket.join(result.room.code);
    socketIdentity.set(socket.id, { roomCode: result.room.code, playerId: result.playerId });
    ack({ ok: true, playerId: result.playerId, room: roomManager.toSnapshot(result.room) });
    broadcastRoom(result.room.code, "room:playersUpdated");
  });

  socket.on("room:rejoin", ({ roomCode, playerId }, ack) => {
    const result = roomManager.rejoinRoom(roomCode, playerId, socket.id);
    if ("error" in result) return ack({ ok: false, error: result.error });
    socket.join(result.room.code);
    socketIdentity.set(socket.id, { roomCode: result.room.code, playerId });
    ack({ ok: true, playerId, room: roomManager.toSnapshot(result.room) });
    broadcastRoom(result.room.code, "room:playersUpdated");
    // A rejoin can happen well after game start (page refresh mid-game), by
    // which point earlier game:state broadcasts have already been missed —
    // catch this socket up explicitly rather than waiting for the next move.
    if (result.room.gameState) socket.emit("game:state", result.room.gameState);
  });

  socket.on("room:ready", ({ ready }) => {
    const identity = socketIdentity.get(socket.id);
    if (!identity) return;
    roomManager.setReady(identity.roomCode, identity.playerId, ready);
    broadcastRoom(identity.roomCode, "room:playersUpdated");
  });

  socket.on("room:start", () => {
    const identity = socketIdentity.get(socket.id);
    if (!identity) return;
    const result = roomManager.startRoom(identity.roomCode, identity.playerId);
    if ("error" in result) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    broadcastRoom(identity.roomCode, "room:started");
    if (result.room.gameState) broadcastGameState(identity.roomCode, result.room.gameState);
  });

  socket.on(
    "game:rollDice",
    gameAction(socket, (state, playerId) => applyDiceRoll(state, playerId).state)
  );

  socket.on(
    "game:build",
    gameAction(socket, (state, playerId, { type, targetId }) => applyBuildAction(state, playerId, type, targetId))
  );

  socket.on(
    "game:discard",
    gameAction(socket, (state, playerId, { resources }) => discard(state, playerId, resources))
  );

  socket.on(
    "game:moveRobber",
    gameAction(socket, (state, playerId, { tileId, victimPlayerId }) => moveRobber(state, playerId, tileId, victimPlayerId))
  );

  socket.on(
    "game:buyDevCard",
    gameAction(socket, (state, playerId) => buyDevCard(state, playerId))
  );

  socket.on(
    "game:playDevCard",
    gameAction(socket, (state, playerId, payload) => {
      switch (payload.type) {
        case "knight":
          return playKnight(state, playerId, payload.tileId, payload.victimPlayerId);
        case "roadBuilding":
          return playRoadBuilding(state, playerId, payload.edgeIds);
        case "yearOfPlenty":
          return playYearOfPlenty(state, playerId, payload.resources);
        case "monopoly":
          return playMonopoly(state, playerId, payload.resource);
      }
    })
  );

  socket.on(
    "game:bankTrade",
    gameAction(socket, (state, playerId, { give, giveAmount, receive }) => bankTrade(state, playerId, give, giveAmount, receive))
  );

  socket.on(
    "game:proposeTrade",
    gameAction(socket, (state, playerId, { offering, requesting, targetPlayerId }) =>
      proposeTrade(state, playerId, offering, requesting, targetPlayerId ?? null)
    )
  );

  socket.on(
    "game:respondTrade",
    gameAction(socket, (state, playerId, { tradeId, response }) => respondTrade(state, playerId, tradeId, response))
  );

  socket.on(
    "game:confirmTrade",
    gameAction(socket, (state, playerId, { tradeId, counterpartyId }) => confirmTrade(state, playerId, tradeId, counterpartyId))
  );

  socket.on(
    "game:cancelTrade",
    gameAction(socket, (state, playerId, { tradeId }) => cancelTrade(state, playerId, tradeId))
  );

  socket.on(
    "game:endTurn",
    gameAction(socket, (state, playerId) => advanceTurn(state, playerId))
  );

  socket.on(
    "game:passSpecialBuilding",
    gameAction(socket, (state, playerId) => passSpecialBuildingTurn(state, playerId))
  );

  socket.on("disconnect", () => {
    const identity = socketIdentity.get(socket.id);
    socketIdentity.delete(socket.id);
    if (!identity) return;
    roomManager.markDisconnected(socket.id);
    broadcastRoom(identity.roomCode, "room:playersUpdated");
  });
});

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server listening on :${PORT} (client origin: ${CLIENT_ORIGIN})`);
});
