"use client";

// Landing page: create a room or join one by code. Replaces the Phase 1
// board-demo page now that there's a real lobby to send players into —
// the board only renders again once a game actually starts (Phase 3+).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/context/SocketContext";
import { PLAYER_STORAGE_KEY } from "@/lib/constants";

export default function Home() {
  const router = useRouter();
  const { socket, connected } = useSocket();
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function rememberAndGo(roomCode: string, playerId: string) {
    sessionStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify({ roomCode, playerId }));
    router.push(`/lobby/${roomCode}`);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim()) return setError("Enter a nickname first");
    setError(null);
    setPending(true);
    socket.emit("room:create", { nickname: nickname.trim() }, (res) => {
      setPending(false);
      if (!res.ok) return setError(res.error);
      rememberAndGo(res.roomCode, res.playerId);
    });
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim()) return setError("Enter a nickname first");
    if (!joinCode.trim()) return setError("Enter a room code");
    setError(null);
    setPending(true);
    socket.emit("room:join", { roomCode: joinCode.trim().toUpperCase(), nickname: nickname.trim() }, (res) => {
      setPending(false);
      if (!res.ok) return setError(res.error);
      rememberAndGo(res.room.code, res.playerId);
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-10">
      <h1 className="text-3xl font-bold">Katan</h1>
      {!connected && <p className="text-sm text-amber-600">Connecting to server…</p>}

      <input
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        placeholder="Your nickname"
        maxLength={20}
        className="w-64 rounded-md border border-black/20 bg-white px-4 py-2 text-black"
      />

      <div className="flex w-64 flex-col gap-3">
        <button
          onClick={handleCreate}
          disabled={pending || !connected}
          className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Create room
        </button>

        <div className="flex items-center gap-2 text-xs text-black/40">
          <div className="h-px flex-1 bg-black/10" />
          or
          <div className="h-px flex-1 bg-black/10" />
        </div>

        <form onSubmit={handleJoin} className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={4}
            className="w-0 flex-1 rounded-md border border-black/20 bg-white px-4 py-2 font-mono uppercase tracking-widest text-black"
          />
          <button
            type="submit"
            disabled={pending || !connected}
            className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Join
          </button>
        </form>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
