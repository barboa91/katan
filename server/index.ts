// Socket.IO transport layer. Thin on purpose: every handler just resolves
// "who is this socket", calls into roomManager or the game rules engine,
// and broadcasts the result. Gameplay handlers (game:*) all follow the
// same try/catch shape: call a src/lib/game/* function that throws a
// plain Error on an illegal action, catch it, and emit game:actionError
// back to just that socket instead of touching room state.

import { createServer } from "http";
import { Server } from "socket.io";
import * as roomManager from "./roomManager";
import { ClientToServerEvents, ServerToClientEvents } from "../src/lib/socketEvents";
import {
  applyDiceRoll,
  advanceTurn,
  buildRoad,
  buildSettlement,
  buildCity,
  discard,
  moveRobber,
  passSpecialBuildingTurn,
} from "../src/lib/game/rules";
import { buyDevCard, playKnight, playRoadBuilding, playYearOfPlenty, playMonopoly } from "../src/lib/game/devCardRules";
import { bankTrade, proposeTrade, respondTrade, confirmTrade, cancelTrade } from "../src/lib/game/tradeRules";
import { placeSetupSettlement, placeSetupRoad } from "../src/lib/game/setup";
import { GameState } from "../src/lib/game/state";

const PORT = process.env.SOCKET_PORT ? Number(process.env.SOCKET_PORT) : 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:3000";

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

// Which room/player each live socket represents. Gameplay/room-action
// handlers (room:ready, room:start, and later game:* events) look the
// player up here rather than trusting a client-supplied playerId — a
// client can only ever act as whichever player its own socket is bound to.
const socketIdentity = new Map<string, { roomCode: string; playerId: string }>();

function broadcastRoom(roomCode: string, event: "room:playersUpdated" | "room:started") {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  io.to(room.code).emit(event, roomManager.toSnapshot(room));
}

function broadcastGameState(roomCode: string, state: GameState) {
  io.to(roomCode).emit("game:state", state);
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

  socket.on("game:rollDice", () => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const { state } = applyDiceRoll(room.gameState, identity.playerId);
      room.gameState = state;
      broadcastGameState(room.code, state);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:build", ({ type, targetId }) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      let next: GameState;
      if (room.gameState.phase === "setup") {
        if (type === "settlement") next = placeSetupSettlement(room.gameState, identity.playerId, targetId);
        else if (type === "road") next = placeSetupRoad(room.gameState, identity.playerId, targetId);
        else throw new Error("Cities can't be built during setup");
      } else {
        if (type === "road") next = buildRoad(room.gameState, identity.playerId, targetId);
        else if (type === "settlement") next = buildSettlement(room.gameState, identity.playerId, targetId);
        else next = buildCity(room.gameState, identity.playerId, targetId);
      }
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:discard", ({ resources }) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = discard(room.gameState, identity.playerId, resources);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:moveRobber", ({ tileId, victimPlayerId }) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = moveRobber(room.gameState, identity.playerId, tileId, victimPlayerId);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:buyDevCard", () => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = buyDevCard(room.gameState, identity.playerId);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:playDevCard", (payload) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      let next: GameState;
      switch (payload.type) {
        case "knight":
          next = playKnight(room.gameState, identity.playerId, payload.tileId, payload.victimPlayerId);
          break;
        case "roadBuilding":
          next = playRoadBuilding(room.gameState, identity.playerId, payload.edgeIds);
          break;
        case "yearOfPlenty":
          next = playYearOfPlenty(room.gameState, identity.playerId, payload.resources);
          break;
        case "monopoly":
          next = playMonopoly(room.gameState, identity.playerId, payload.resource);
          break;
      }
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:bankTrade", ({ give, giveAmount, receive }) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = bankTrade(room.gameState, identity.playerId, give, giveAmount, receive);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:proposeTrade", ({ offering, requesting, targetPlayerId }) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = proposeTrade(room.gameState, identity.playerId, offering, requesting, targetPlayerId ?? null);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:respondTrade", ({ tradeId, response }) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = respondTrade(room.gameState, identity.playerId, tradeId, response);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:confirmTrade", ({ tradeId, counterpartyId }) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = confirmTrade(room.gameState, identity.playerId, tradeId, counterpartyId);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:cancelTrade", ({ tradeId }) => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = cancelTrade(room.gameState, identity.playerId, tradeId);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:endTurn", () => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = advanceTurn(room.gameState, identity.playerId);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

  socket.on("game:passSpecialBuilding", () => {
    const identity = socketIdentity.get(socket.id);
    const room = identity && roomManager.getRoom(identity.roomCode);
    if (!identity || !room?.gameState) return;
    try {
      const next = passSpecialBuildingTurn(room.gameState, identity.playerId);
      room.gameState = next;
      broadcastGameState(room.code, next);
    } catch (err) {
      socket.emit("game:actionError", { message: (err as Error).message });
    }
  });

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
