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

// In production (self-hosted, Docker/nginx) this connects same-origin —
// nginx proxies the /socket.io path to the socket container (see
// nginx/default.conf) — via socket.io-client's io() called with no URL at
// all (undefined). This deliberately does NOT use an empty-string
// NEXT_PUBLIC_SOCKET_URL as the "same origin" signal: confirmed by
// directly inspecting a built bundle that Next.js silently does NOT
// inline a NEXT_PUBLIC_* var set to "" the way it inlines a real value —
// it's left as a genuine (nonexistent) process.env property read in the
// browser, which evaluates to undefined, which then hits this same
// fallback anyway — so an explicit "" build arg quietly behaves exactly
// like never setting the var, defeating the whole point. NODE_ENV sidesteps
// that: Next.js always inlines it, and `next build` always forces it to
// "production" (Docker's builder stage runs `npm run build`, no
// exceptions) — so this only needs an explicit NEXT_PUBLIC_SOCKET_URL
// override for a genuinely non-same-origin setup; every other production
// build defaults to same-origin automatically, no build arg required.
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (process.env.NODE_ENV === "production" ? undefined : "http://localhost:4000");

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
