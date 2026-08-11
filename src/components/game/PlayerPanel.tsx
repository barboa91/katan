import { PlayerState } from "@/lib/game/state";
import { Resource } from "@/lib/game/types";
import { WIN_VICTORY_POINTS } from "@/lib/game/rules";
import { RESOURCE_ICONS } from "@/lib/constants";

const PlayerPanel = ({
  player,
  vp,
  isSelf,
  isCurrent,
  connected = true,
  hasLargestArmy = false,
  hasLongestRoad = false,
}: {
  player: PlayerState;
  /** Computed by the caller: publicVictoryPoints for opponents (hides
   * unrevealed Victory Point dev cards, same as the real game), or
   * totalVictoryPoints for the player's own panel (includes their own
   * hidden cards — they obviously know their own hand). */
  vp: number;
  isSelf: boolean;
  isCurrent: boolean;
  /** Live connection status from room:playersUpdated, not part of GameState
   * itself (that's server-side room bookkeeping, not game rules). Defaults
   * to true so callers that don't track it don't have to think about it. */
  connected?: boolean;
  hasLargestArmy?: boolean;
  hasLongestRoad?: boolean;
}) => {
  const totalCards = Object.values(player.resources).reduce((sum, n) => sum + n, 0);
  const totalDevCards =
    Object.values(player.devCards).reduce((sum, n) => sum + n, 0) +
    Object.values(player.newDevCards).reduce((sum, n) => sum + n, 0);

  return (
    <div
      className="flex min-w-[10rem] flex-col gap-1 rounded-md border px-4 py-2 transition"
      style={{ borderColor: player.color, borderWidth: isCurrent ? 3 : 1 }}
    >
      <div className="flex items-center gap-1 font-semibold" style={{ color: player.color }}>
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-gray-300"}`}
          title={connected ? "Connected" : "Disconnected — waiting to reconnect"}
        />
        <span>{player.nickname}</span>
        {isSelf && <span className="text-xs text-black/40">(you)</span>}
        {isCurrent && <span title="Current turn">⏳</span>}
        {hasLargestArmy && <span title="Largest Army (+2 VP)">🛡️</span>}
        {hasLongestRoad && <span title="Longest Road (+2 VP)">🛣️</span>}
      </div>
      <div className="text-xs text-black/50">
        VP {vp}/{WIN_VICTORY_POINTS} · 🏠{player.settlementsLeft} 🏛{player.citiesLeft} 🛤{player.roadsLeft}
        {totalDevCards > 0 && <> · 🃏{totalDevCards}</>}
      </div>
      {isSelf ? (
        <div className="flex gap-2 text-sm">
          {(Object.keys(RESOURCE_ICONS) as Resource[]).map((r) => (
            <span key={r} title={r}>
              {RESOURCE_ICONS[r]} {player.resources[r]}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-xs text-black/50">{totalCards} card{totalCards === 1 ? "" : "s"}</div>
      )}
    </div>
  );
};
export default PlayerPanel;
