// Development card hand + buy/play controls. Knight and Road Building need
// board interaction (picking a tile / picking edges), so those two just
// notify the parent page to enter a targeting mode on GameMap — this panel
// only handles the two that are fully self-contained (Year of Plenty's
// resource picker, Monopoly's resource picker) plus the hand display.

import { useState } from "react";
import { PlayerState } from "@/lib/game/state";
import { DevCardType, Resource } from "@/lib/game/types";
import { DEV_CARD_COST } from "@/lib/game/devCards";

const CARD_LABELS: Record<DevCardType, string> = {
  knight: "Knight",
  roadBuilding: "Road Building",
  yearOfPlenty: "Year of Plenty",
  monopoly: "Monopoly",
  victoryPoint: "Victory Point",
};
const CARD_ICONS: Record<DevCardType, string> = {
  knight: "⚔️",
  roadBuilding: "🛤️",
  yearOfPlenty: "🌾",
  monopoly: "💰",
  victoryPoint: "⭐",
};
const RESOURCE_ICONS: Record<Resource, string> = {
  wood: "🪵",
  brick: "🧱",
  sheep: "🐑",
  wheat: "🌾",
  ore: "⛰️",
};

function affordable(resources: Record<Resource, number>): boolean {
  return Object.entries(DEV_CARD_COST).every(([r, amount]) => resources[r as Resource] >= (amount ?? 0));
}

const DevCardPanel = ({
  player,
  devDeckCount,
  canPlay,
  onBuy,
  onStartKnight,
  onStartRoadBuilding,
  onPlayYearOfPlenty,
  onPlayMonopoly,
}: {
  player: PlayerState;
  devDeckCount: number;
  /** Whether playing (not buying) a card is currently allowed — false
   * during setup/other-player's-turn/robber-unresolved/already-played-one. */
  canPlay: boolean;
  onBuy: () => void;
  onStartKnight: () => void;
  onStartRoadBuilding: () => void;
  onPlayYearOfPlenty: (resources: [Resource, Resource]) => void;
  onPlayMonopoly: (resource: Resource) => void;
}) => {
  const [picking, setPicking] = useState<"yearOfPlenty" | "monopoly" | null>(null);
  const [yopPicks, setYopPicks] = useState<Resource[]>([]);

  const types: DevCardType[] = ["knight", "roadBuilding", "yearOfPlenty", "monopoly", "victoryPoint"];

  function handlePlay(type: DevCardType) {
    if (type === "knight") return onStartKnight();
    if (type === "roadBuilding") return onStartRoadBuilding();
    if (type === "yearOfPlenty") {
      setYopPicks([]);
      setPicking("yearOfPlenty");
      return;
    }
    if (type === "monopoly") return setPicking("monopoly");
  }

  function pickResource(r: Resource) {
    if (picking === "monopoly") {
      onPlayMonopoly(r);
      setPicking(null);
      return;
    }
    if (picking === "yearOfPlenty") {
      const next = [...yopPicks, r];
      if (next.length === 2) {
        onPlayYearOfPlenty([next[0], next[1]]);
        setPicking(null);
        setYopPicks([]);
      } else {
        setYopPicks(next);
      }
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onBuy}
          disabled={!affordable(player.resources) || devDeckCount === 0}
          title={devDeckCount === 0 ? "Deck is empty" : "🌾 wheat, 🐑 sheep, ⛰️ ore"}
          className="rounded-md border border-black/20 px-3 py-1.5 text-sm font-medium transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Buy dev card ({devDeckCount} left)
        </button>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {types.map((type) => {
          const playable = player.devCards[type];
          const pending = player.newDevCards[type];
          if (playable === 0 && pending === 0) return null;
          const canPlayThis = type !== "victoryPoint" && canPlay && playable > 0;
          return (
            <div
              key={type}
              className="flex flex-col items-center gap-1 rounded-md border border-black/20 px-2 py-1 text-xs"
            >
              <span>
                {CARD_ICONS[type]} {CARD_LABELS[type]}
              </span>
              <span className="text-black/50">
                {playable} playable{pending > 0 && `, ${pending} pending`}
              </span>
              {type !== "victoryPoint" && (
                <button
                  onClick={() => handlePlay(type)}
                  disabled={!canPlayThis}
                  title={playable === 0 ? "None playable yet" : undefined}
                  className="rounded border border-indigo-600 px-2 py-0.5 text-indigo-600 disabled:cursor-not-allowed disabled:border-black/20 disabled:text-black/30"
                >
                  Play
                </button>
              )}
            </div>
          );
        })}
      </div>

      {picking && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm">
          <span>
            {picking === "monopoly"
              ? "Monopoly — pick a resource to take from everyone"
              : `Year of Plenty — pick 2 resources (${yopPicks.length}/2)`}
          </span>
          <div className="flex gap-2">
            {(Object.keys(RESOURCE_ICONS) as Resource[]).map((r) => (
              <button
                key={r}
                onClick={() => pickResource(r)}
                className="rounded border border-black/20 px-2 py-1 hover:bg-black/5"
              >
                {RESOURCE_ICONS[r]}
              </button>
            ))}
          </div>
          <button onClick={() => setPicking(null)} className="text-xs text-black/40 underline">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};
export default DevCardPanel;
