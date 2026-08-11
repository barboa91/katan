import { Resource } from "./game/types";

// sessionStorage key for the {roomCode, playerId} the client remembers so
// it can re-attach to its room (see SocketContext / lobby page) after a
// client-side navigation or a page reload.
export const PLAYER_STORAGE_KEY = "katan:player";

// The single source of truth for resource emoji — every component that
// displays a resource (hand, cost, port, trade offer) imports this instead
// of re-declaring its own copy.
export const RESOURCE_ICONS: Record<Resource, string> = {
  wood: "🪵",
  brick: "🧱",
  sheep: "🐑",
  wheat: "🌾",
  ore: "⛰️",
};

/** Renders a resource-count map as "🪵2 🧱1" (icon+amount per entry,
 * zero/undefined entries skipped), or `fallback` if nothing's left after
 * filtering — the shared formatter behind cost labels and trade summaries. */
export function formatResourceList(resources: Partial<Record<Resource, number>>, fallback = ""): string {
  const label = Object.entries(resources)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([r, n]) => `${RESOURCE_ICONS[r as Resource]}${n}`)
    .join(" ");
  return label || fallback;
}
