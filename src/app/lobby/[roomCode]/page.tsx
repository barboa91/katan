"use client";

// Lobby screen: shows who's in the room, lets everyone ready up, and lets
// the host start the game once everyone is ready. Always (re)joins via
// room:rejoin on mount — that covers both "just navigated here from the
// home page" and "refreshed this page directly" with one code path, since
// the server treats rejoin as "attach this socket to an existing player".

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSocket } from "@/context/SocketContext";
import { RoomSnapshot } from "@/lib/socketEvents";
import { PLAYER_STORAGE_KEY } from "@/lib/constants";
import PlayerList from "@/components/lobby/PlayerList";
import RoomCodeDisplay from "@/components/lobby/RoomCodeDisplay";
import ReadyToggle from "@/components/lobby/ReadyToggle";

export default function LobbyPage() {
  const params = useParams<{ roomCode: string }>();
  const roomCode = params.roomCode.toUpperCase();
  const router = useRouter();
  const { socket, connected } = useSocket();

  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Covers landing on /lobby/[code] directly (e.g. a refresh) after the
      // game already started elsewhere — jump straight to the game screen
      // instead of rendering a lobby for a room that's no longer in lobby.
      if (res.room.status === "playing") {
        router.push(`/game/${res.room.code}`);
        return;
      }
      setRoom(res.room);
    });

    const onPlayersUpdated = (snapshot: RoomSnapshot) => setRoom(snapshot);
    const onStarted = (snapshot: RoomSnapshot) => router.push(`/game/${snapshot.code}`);
    const onError = (payload: { message: string }) => setError(payload.message);

    socket.on("room:playersUpdated", onPlayersUpdated);
    socket.on("room:started", onStarted);
    socket.on("room:error", onError);
    return () => {
      socket.off("room:playersUpdated", onPlayersUpdated);
      socket.off("room:started", onStarted);
      socket.off("room:error", onError);
    };
  }, [connected, roomCode, router, socket]);

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

  if (!room || !playerId) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-black/50">Joining room…</p>
      </main>
    );
  }

  const self = room.players.find((p) => p.playerId === playerId);
  const isHost = self?.isHost ?? false;
  const allReady = room.players.length >= 2 && room.players.every((p) => p.ready);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-10">
      <RoomCodeDisplay code={room.code} />

      <PlayerList players={room.players} maxPlayers={room.maxPlayers} selfId={playerId} />

      <ReadyToggle
        ready={self?.ready ?? false}
        disabled={!connected}
        onToggle={(next) => socket.emit("room:ready", { ready: next })}
      />

      {isHost && (
        <button
          onClick={() => socket.emit("room:start")}
          disabled={!allReady}
          className="rounded-md bg-emerald-600 px-6 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start game
        </button>
      )}
      {isHost && !allReady && <p className="text-xs text-black/40">Need 2+ players, all ready, to start.</p>}
    </main>
  );
}
