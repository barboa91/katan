"use client";

// Main game screen. Renders purely from server-pushed GameState broadcasts
// (see server/index.ts) — there is no client-side game logic here beyond
// figuring out whose turn it is and which board pieces should be
// clickable right now. Every click just emits an intent; the server
// decides whether it's legal.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSocket } from "@/context/SocketContext";
import { PLAYER_STORAGE_KEY } from "@/lib/constants";
import { GameState } from "@/lib/game/state";
import {
  canPlaceSettlement,
  canBuildSettlement,
  canPlaceRoad,
  canPlaceCity,
  publicVictoryPoints,
  totalVictoryPoints,
} from "@/lib/game/rules";
import { RoomSnapshot } from "@/lib/socketEvents";
import GameMap from "@/components/map/GameMap";
import PlayerPanel from "@/components/game/PlayerPanel";
import DiceRoller from "@/components/game/DiceRoller";
import TurnBanner from "@/components/game/TurnBanner";
import BuildMenu, { BuildMode } from "@/components/game/BuildMenu";
import EndGameScreen from "@/components/game/EndGameScreen";
import DiscardModal from "@/components/game/DiscardModal";
import DevCardPanel from "@/components/game/DevCardPanel";
import BankTradePanel from "@/components/game/BankTradePanel";
import TradePanel from "@/components/game/TradePanel";

export default function GamePage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = params.roomCode.toUpperCase();
  const router = useRouter();
  const { socket, connected } = useSocket();

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  // Fatal: you don't belong in this room at all — replaces the whole page.
  const [error, setError] = useState<string | null>(null);
  // Transient: your last action was rejected (e.g. an illegal spot) — the
  // board and everyone else's game keep going, this is just a note to you.
  const [actionError, setActionError] = useState<string | null>(null);
  // Main-phase only: which piece type the player is currently placing.
  const [buildMode, setBuildMode] = useState<BuildMode | null>(null);
  // Set once the current player (moving the robber, or playing a Knight)
  // has clicked a target tile with an eligible victim; cleared on submit or
  // on picking a different tile.
  const [pendingRobberTile, setPendingRobberTile] = useState<string | null>(null);
  // True while choosing a tile for a Knight card play — distinct from the
  // post-7 needsToMoveRobber flow (this one's user-initiated via
  // DevCardPanel's "Play" button, not forced by turnSubphase), but shares
  // the same tile-click + victim-picker UI below.
  const [knightMode, setKnightMode] = useState(false);
  // Road Building dev card: accumulates up to 2 clicked edges before
  // submitting as a single game:playDevCard action.
  const [roadBuildingMode, setRoadBuildingMode] = useState(false);
  const [roadBuildingEdges, setRoadBuildingEdges] = useState<string[]>([]);
  // Live per-player connection status — this is room bookkeeping, not part
  // of GameState (game rules don't care who's connected), so it's tracked
  // separately from room:playersUpdated broadcasts (already sent on every
  // connect/disconnect, including mid-game — see server/index.ts).
  const [connectionStatus, setConnectionStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!connected) return;

    const stored = sessionStorage.getItem(PLAYER_STORAGE_KEY);
    const parsed: { roomCode: string; playerId: string } | null = stored ? JSON.parse(stored) : null;
    if (!parsed || parsed.roomCode !== roomCode) {
      setError("No player session found for this room — join it from the home page.");
      return;
    }

    setPlayerId(parsed.playerId);
    socket.emit("room:rejoin", { roomCode, playerId: parsed.playerId }, (res) => {
      if (!res.ok) return setError(res.error);
      // The board snapshot itself arrives via the game:state listener below
      // (server emits it right after a successful rejoin ack) — this ack
      // only seeds who's currently connected.
      const status: Record<string, boolean> = {};
      for (const p of res.room.players) status[p.playerId] = p.connected;
      setConnectionStatus(status);
    });

    const onState = (state: GameState) => setGame(state);
    const onActionError = (payload: { message: string }) => setActionError(payload.message);
    const onPlayersUpdated = (snapshot: RoomSnapshot) => {
      const status: Record<string, boolean> = {};
      for (const p of snapshot.players) status[p.playerId] = p.connected;
      setConnectionStatus(status);
    };
    socket.on("game:state", onState);
    socket.on("game:actionError", onActionError);
    socket.on("room:playersUpdated", onPlayersUpdated);
    return () => {
      socket.off("game:state", onState);
      socket.off("game:actionError", onActionError);
      socket.off("room:playersUpdated", onPlayersUpdated);
    };
  }, [connected, roomCode, socket]);

  // Auto-dismiss the action-error toast rather than leaving a stale
  // rejection message on screen indefinitely.
  useEffect(() => {
    if (!actionError) return;
    const timeout = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(timeout);
  }, [actionError]);

  // Deselect the build tool when a new turn starts, so an old selection
  // doesn't silently carry over next time it's this player's turn again.
  // currentPlayerIndex alone isn't enough during a 5-6 player Special
  // Building Phase — it deliberately doesn't move while the SBP queue
  // drains (see state.ts's specialBuilding comment), so also reset
  // whenever the head of that queue changes to a different player.
  const specialBuildingActorId = game?.specialBuilding?.[0];
  useEffect(() => {
    setBuildMode(null);
    setKnightMode(false);
    setRoadBuildingMode(false);
    setRoadBuildingEdges([]);
  }, [game?.currentPlayerIndex, specialBuildingActorId]);

  // Clear any in-progress robber targeting once it's resolved (subphase
  // moves on to "postRoll") — otherwise a stale victim picker could hang
  // around from a previous 7 roll.
  useEffect(() => {
    if (game?.turnSubphase !== "moveRobber") setPendingRobberTile(null);
  }, [game?.turnSubphase]);

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-10">
        <p className="text-red-600">{error}</p>
        <button onClick={() => router.push("/")} className="text-blue-600 underline">
          Back to home
        </button>
      </main>
    );
  }

  if (!game || !playerId) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-black/50">Loading game…</p>
      </main>
    );
  }

  if (game.phase === "ended") {
    return <EndGameScreen game={game} playerId={playerId} onBackToHome={() => router.push("/")} />;
  }

  const playerColor = (id: string) => game.players.find((p) => p.playerId === id)?.color ?? "#333";
  const self = game.players.find((p) => p.playerId === playerId);
  // Vertices where the local player has a building that also sits on a
  // port — GameMap only uses this to highlight owned ports on the map.
  const ownPortVertexIds = new Set(
    game.board.ports
      .flatMap((port) => port.vertices)
      .filter((vid) => game.board.vertices[vid]?.building?.playerId === playerId)
  );

  const isSetup = game.phase === "setup" && game.setup;
  // While a 5-6 player Special Building Phase is draining, nobody is
  // having a "normal turn" — not even the resting active player who
  // triggered it (see state.ts's specialBuilding comment) — so isMyTurn
  // is forced false for everyone until it clears. isMySpecialBuildTurn
  // covers the separate build-only mini-turn instead.
  const isMyTurn = isSetup
    ? game.setup!.order[game.setup!.index] === playerId
    : !game.specialBuilding && game.turnOrder[game.currentPlayerIndex] === playerId;
  const isMySpecialBuildTurn = game.phase === "main" && game.specialBuilding !== null && game.specialBuilding[0] === playerId;
  const setupSubphase = isSetup ? game.setup!.subphase : null;

  // Building (and therefore the vertex/edge overlays) is disallowed while
  // a 7's fallout is unresolved — see rules.ts's assertRobberResolved.
  const buildAllowed = game.phase !== "main" || (game.turnSubphase !== "discarding" && game.turnSubphase !== "moveRobber");
  const owedDiscard = game.discardsOwed[playerId];
  const needsToMoveRobber = isMyTurn && game.phase === "main" && game.turnSubphase === "moveRobber";

  // What a vertex click should do right now, if anything: setup placement
  // and main-phase settlement/city building share the vertex overlay, so
  // this picks the right server event type and the right legality check
  // (canPlaceSettlement/canBuildSettlement/canPlaceCity mirror exactly
  // what the server itself validates — this is a UX filter, not the
  // source of truth; the server re-checks everything regardless).
  const canBuildNow = isMyTurn || isMySpecialBuildTurn;
  const vertexAction: "settlement" | "city" | null =
    isMyTurn && setupSubphase === "placeSettlement"
      ? "settlement"
      : canBuildNow && buildAllowed && game.phase === "main" && buildMode === "settlement"
        ? "settlement"
        : canBuildNow && buildAllowed && game.phase === "main" && buildMode === "city"
          ? "city"
          : null;

  const legalVertexIds =
    vertexAction === "settlement" && isSetup
      ? new Set(Object.keys(game.board.vertices).filter((vid) => canPlaceSettlement(game.board, vid)))
      : vertexAction === "settlement"
        ? new Set(Object.keys(game.board.vertices).filter((vid) => canBuildSettlement(game.board, playerId, vid)))
        : vertexAction === "city"
          ? new Set(Object.keys(game.board.vertices).filter((vid) => canPlaceCity(game.board, playerId, vid)))
          : undefined;

  // Road Building's second pick needs to know what's legal *after* the
  // first pick — simulated locally against a temp board rather than
  // waiting on a server round-trip between the two clicks.
  function roadBuildingLegalEdges(): Set<string> {
    let board = game!.board;
    for (const eid of roadBuildingEdges) {
      const edge = board.edges[eid];
      board = { ...board, edges: { ...board.edges, [eid]: { ...edge, road: { playerId: playerId! } } } };
    }
    return new Set(Object.keys(board.edges).filter((eid) => canPlaceRoad(board, playerId!, eid)));
  }

  const edgeActive =
    (isMyTurn && setupSubphase === "placeRoad") ||
    (canBuildNow && buildAllowed && game.phase === "main" && buildMode === "road") ||
    (isMyTurn && roadBuildingMode);

  const legalEdgeIds =
    isMyTurn && setupSubphase === "placeRoad" && game.setup?.pendingSettlementVertexId
      ? new Set(
          Object.values(game.board.edges)
            .filter((e) => !e.road && e.endpoints.includes(game.setup!.pendingSettlementVertexId!))
            .map((e) => e.id)
        )
      : canBuildNow && buildAllowed && game.phase === "main" && buildMode === "road"
        ? new Set(Object.keys(game.board.edges).filter((eid) => canPlaceRoad(game.board, playerId, eid)))
        : isMyTurn && roadBuildingMode
          ? roadBuildingLegalEdges()
          : undefined;

  function handleVertexClick(vertexId: string) {
    if (!vertexAction) return;
    socket.emit("game:build", { type: vertexAction, targetId: vertexId });
    if (game!.phase === "main") setBuildMode(null);
  }

  function submitRoadBuilding(edgeIds: string[]) {
    socket.emit("game:playDevCard", { type: "roadBuilding", edgeIds });
    setRoadBuildingMode(false);
    setRoadBuildingEdges([]);
  }

  function handleEdgeClick(edgeId: string) {
    if (roadBuildingMode) {
      const next = [...roadBuildingEdges, edgeId];
      if (next.length === 2) submitRoadBuilding(next);
      else setRoadBuildingEdges(next);
      return;
    }
    if (!edgeActive) return;
    socket.emit("game:build", { type: "road", targetId: edgeId });
    if (game!.phase === "main") setBuildMode(null);
  }

  // Non-self players adjacent to `tileId` with at least one card — mirrors
  // rules.ts's stealCandidates so the picker only ever offers legal victims.
  function stealCandidatesFor(tileId: string): string[] {
    const ids = new Set<string>();
    for (const vertex of Object.values(game!.board.vertices)) {
      if (!vertex.building || vertex.building.playerId === playerId) continue;
      if (!vertex.adjacentTileIds.includes(tileId)) continue;
      const victim = game!.players.find((p) => p.playerId === vertex.building!.playerId);
      const total = victim ? Object.values(victim.resources).reduce((sum, n) => sum + n, 0) : 0;
      if (total > 0) ids.add(vertex.building.playerId);
    }
    return [...ids];
  }

  function handleTileClick(tileId: string) {
    if (!needsToMoveRobber && !knightMode) return;
    const candidates = stealCandidatesFor(tileId);
    if (candidates.length === 0) {
      if (needsToMoveRobber) socket.emit("game:moveRobber", { tileId });
      else socket.emit("game:playDevCard", { type: "knight", tileId });
      setKnightMode(false);
    } else {
      setPendingRobberTile(tileId);
    }
  }

  function handleChooseVictim(victimPlayerId: string) {
    if (!pendingRobberTile) return;
    if (needsToMoveRobber) {
      socket.emit("game:moveRobber", { tileId: pendingRobberTile, victimPlayerId });
    } else {
      socket.emit("game:playDevCard", { type: "knight", tileId: pendingRobberTile, victimPlayerId });
      setKnightMode(false);
    }
    setPendingRobberTile(null);
  }

  return (
    <main className="flex flex-col items-center gap-6 p-6">
      <TurnBanner game={game} playerId={playerId} />
      {actionError && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{actionError}</p>}

      {owedDiscard !== undefined && self && (
        <DiscardModal
          owed={owedDiscard}
          resources={self.resources}
          onSubmit={(resources) => socket.emit("game:discard", { resources })}
        />
      )}

      {(needsToMoveRobber || knightMode) && (
        <div className="w-full max-w-md rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm">
          {pendingRobberTile ? (
            <div className="flex flex-col gap-2">
              <span>Steal from:</span>
              <div className="flex flex-wrap gap-2">
                {stealCandidatesFor(pendingRobberTile).map((pid) => {
                  const p = game.players.find((pp) => pp.playerId === pid)!;
                  return (
                    <button
                      key={pid}
                      onClick={() => handleChooseVictim(pid)}
                      className="rounded-md border px-3 py-1 font-medium"
                      style={{ borderColor: p.color, color: p.color }}
                    >
                      {p.nickname}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span>
                {needsToMoveRobber ? "🥷 Click a tile on the board to move the robber." : "⚔️ Playing Knight — click a tile to move the robber."}
              </span>
              {knightMode && (
                <button onClick={() => setKnightMode(false)} className="text-xs underline">
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {roadBuildingMode && (
        <div className="flex w-full max-w-md items-center justify-between rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm">
          <span>
            🛤️ Road Building — click {2 - roadBuildingEdges.length} more road spot{2 - roadBuildingEdges.length === 1 ? "" : "s"}.
          </span>
          <div className="flex gap-2">
            {roadBuildingEdges.length > 0 && (
              <button onClick={() => submitRoadBuilding(roadBuildingEdges)} className="text-xs underline">
                Place {roadBuildingEdges.length} now
              </button>
            )}
            <button
              onClick={() => {
                setRoadBuildingMode(false);
                setRoadBuildingEdges([]);
              }}
              className="text-xs underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <GameMap
        board={game.board}
        playerColor={playerColor}
        hexSize={38}
        interactiveVertices={vertexAction !== null}
        interactiveEdges={edgeActive}
        legalVertexIds={legalVertexIds}
        legalEdgeIds={legalEdgeIds}
        onVertexClick={handleVertexClick}
        onEdgeClick={handleEdgeClick}
        interactiveTiles={needsToMoveRobber || knightMode}
        onTileClick={handleTileClick}
        ownPortVertexIds={ownPortVertexIds}
      />

      <div className="flex flex-wrap justify-center gap-3">
        {game.players.map((p) => (
          <PlayerPanel
            key={p.playerId}
            player={p}
            vp={p.playerId === playerId ? totalVictoryPoints(game, p.playerId) : publicVictoryPoints(game, p.playerId)}
            isSelf={p.playerId === playerId}
            isCurrent={
              game.phase === "main" &&
              (game.specialBuilding ? game.specialBuilding[0] === p.playerId : game.turnOrder[game.currentPlayerIndex] === p.playerId)
            }
            connected={connectionStatus[p.playerId] ?? true}
            hasLargestArmy={game.largestArmy === p.playerId}
            hasLongestRoad={game.longestRoad === p.playerId}
          />
        ))}
      </div>

      {game.phase === "main" && (isMyTurn || isMySpecialBuildTurn) && self && buildAllowed && (
        <div className="flex flex-col items-center gap-3">
          {isMyTurn && (
            <DiceRoller
              lastRoll={game.lastRoll}
              canRoll={game.turnSubphase === "preRoll"}
              canEndTurn={game.turnSubphase === "postRoll"}
              onRoll={() => socket.emit("game:rollDice")}
              onEndTurn={() => socket.emit("game:endTurn")}
            />
          )}
          <BuildMenu player={self} mode={buildMode} onSelect={setBuildMode} />
          <DevCardPanel
            player={self}
            devDeckCount={game.devDeck.length}
            canPlay={isMyTurn && !game.devCardPlayedThisTurn && !knightMode && !roadBuildingMode}
            onBuy={() => socket.emit("game:buyDevCard")}
            onStartKnight={() => setKnightMode(true)}
            onStartRoadBuilding={() => setRoadBuildingMode(true)}
            onPlayYearOfPlenty={(resources) => socket.emit("game:playDevCard", { type: "yearOfPlenty", resources })}
            onPlayMonopoly={(resource) => socket.emit("game:playDevCard", { type: "monopoly", resource })}
          />
          {isMyTurn && (
            <BankTradePanel
              game={game}
              playerId={playerId}
              onTrade={(give, giveAmount, receive) => socket.emit("game:bankTrade", { give, giveAmount, receive })}
            />
          )}
          {isMySpecialBuildTurn && (
            <button
              onClick={() => socket.emit("game:passSpecialBuilding")}
              className="rounded-md border border-indigo-600 px-4 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
            >
              Pass — end Special Building turn
            </button>
          )}
        </div>
      )}

      {game.phase === "main" && buildAllowed && !game.specialBuilding && self && (
        <TradePanel
          game={game}
          playerId={playerId}
          isMyTurn={isMyTurn}
          onPropose={(offering, requesting, targetPlayerId) =>
            socket.emit("game:proposeTrade", { offering, requesting, targetPlayerId })
          }
          onRespond={(tradeId, response) => socket.emit("game:respondTrade", { tradeId, response })}
          onConfirm={(tradeId, counterpartyId) => socket.emit("game:confirmTrade", { tradeId, counterpartyId })}
          onCancel={(tradeId) => socket.emit("game:cancelTrade", { tradeId })}
        />
      )}

      {game.log.length > 0 && (
        <ul className="w-full max-w-md text-xs text-black/50">
          {game.log.slice(-5).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
