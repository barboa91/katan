import { PlayerMeta } from "@/lib/socketEvents";

const PlayerList = ({ players, maxPlayers, selfId }: { players: PlayerMeta[]; maxPlayers: number; selfId: string | null }) => {
  const emptySeats = Math.max(0, maxPlayers - players.length);

  return (
    <ul className="flex w-full max-w-sm flex-col gap-2">
      {players.map((p) => (
        <li
          key={p.playerId}
          className="flex items-center justify-between rounded-md border border-black/10 px-4 py-2"
        >
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${p.connected ? "bg-green-500" : "bg-gray-300"}`}
              title={p.connected ? "Connected" : "Disconnected"}
            />
            <span className={p.playerId === selfId ? "font-semibold" : undefined}>
              {p.nickname}
              {p.playerId === selfId && " (you)"}
            </span>
            {p.isHost && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                Host
              </span>
            )}
          </span>
          <span className={`text-sm font-medium ${p.ready ? "text-green-600" : "text-black/40"}`}>
            {p.ready ? "Ready" : "Not ready"}
          </span>
        </li>
      ))}
      {Array.from({ length: emptySeats }).map((_, i) => (
        <li
          key={`empty-${i}`}
          className="rounded-md border border-dashed border-black/10 px-4 py-2 text-black/30"
        >
          Open seat
        </li>
      ))}
    </ul>
  );
};
export default PlayerList;
