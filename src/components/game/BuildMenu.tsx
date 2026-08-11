import { PlayerState } from "@/lib/game/state";
import { BUILD_COSTS } from "@/lib/game/costs";
import { Resource } from "@/lib/game/types";

export type BuildMode = "road" | "settlement" | "city";

const RESOURCE_ICONS: Record<Resource, string> = {
  wood: "🪵",
  brick: "🧱",
  sheep: "🐑",
  wheat: "🌾",
  ore: "⛰️",
};

function affordable(resources: Record<Resource, number>, cost: Partial<Record<Resource, number>>): boolean {
  return Object.entries(cost).every(([resource, amount]) => resources[resource as Resource] >= (amount ?? 0));
}

function costLabel(cost: Partial<Record<Resource, number>>): string {
  return Object.entries(cost)
    .map(([resource, amount]) => `${RESOURCE_ICONS[resource as Resource]}${amount}`)
    .join(" ");
}

const OPTIONS: { mode: BuildMode; label: string; piecesKey: "roadsLeft" | "settlementsLeft" | "citiesLeft" }[] = [
  { mode: "road", label: "Road", piecesKey: "roadsLeft" },
  { mode: "settlement", label: "Settlement", piecesKey: "settlementsLeft" },
  { mode: "city", label: "City", piecesKey: "citiesLeft" },
];

const BuildMenu = ({
  player,
  mode,
  onSelect,
}: {
  player: PlayerState;
  mode: BuildMode | null;
  onSelect: (mode: BuildMode | null) => void;
}) => {
  return (
    <div className="flex gap-3">
      {OPTIONS.map((opt) => {
        const piecesLeft = player[opt.piecesKey];
        const canAfford = affordable(player.resources, BUILD_COSTS[opt.mode]);
        const disabled = !canAfford || piecesLeft <= 0;
        const selected = mode === opt.mode;
        return (
          <button
            key={opt.mode}
            disabled={disabled}
            onClick={() => onSelect(selected ? null : opt.mode)}
            title={disabled ? (piecesLeft <= 0 ? "None left" : "Not enough resources") : undefined}
            className={`flex flex-col items-center rounded-md border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
              selected ? "border-indigo-600 bg-indigo-50" : "border-black/20 hover:bg-black/5"
            }`}
          >
            <span className="font-medium">{opt.label}</span>
            <span className="text-xs text-black/50">{costLabel(BUILD_COSTS[opt.mode])}</span>
            <span className="text-xs text-black/40">{piecesLeft} left</span>
          </button>
        );
      })}
    </div>
  );
};
export default BuildMenu;
