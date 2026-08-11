"use client";

// A single Socket.IO connection, created once and shared via context. Next
// App Router navigations are client-side, so this connection persists
// across pages (home -> lobby) within the same browser tab/session — the
// lobby page only needs to actively re-establish it (via room:rejoin)
// after a real page reload, not on every route change.

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ClientToServerEvents, ServerToClientEvents } from "@/lib/socketEvents";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// In production (self-hosted, Phase 6) this should be same-origin with
// nginx proxying the /socket.io path, so NEXT_PUBLIC_SOCKET_URL should be
// left unset there. The explicit :4000 default only matters for local dev,
// where the Socket.IO server runs as a separate process/port.
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

const SocketContext = createContext<{ socket: AppSocket; connected: boolean } | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);

  if (!socketRef.current) {
    socketRef.current = io(SOCKET_URL);
  }

  useEffect(() => {
    const socket = socketRef.current!;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    setConnected(socket.connected);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within a SocketProvider");
  return ctx;
}
