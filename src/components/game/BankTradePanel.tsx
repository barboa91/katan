// Bank/port trading: give N of one resource (N = the player's best current
// ratio for it — 4:1 bank default, 3:1 with a generic port, 2:1 with a
// matching-resource port) for 1 of another. getBestRatio mirrors exactly
// what the server re-derives and enforces (see tradeRules.ts) — this is a
// UX preview, not the source of truth.

import { useState } from "react";
import { GameState } from "@/lib/game/state";
import { Resource } from "@/lib/game/types";
import { getBestRatio } from "@/lib/game/tradeRules";

const RESOURCE_ICONS: Record<Resource, string> = {
  wood: "🪵",
  brick: "🧱",
  sheep: "🐑",
  wheat: "🌾",
  ore: "⛰️",
};
const RESOURCES = Object.keys(RESOURCE_ICONS) as Resource[];

const BankTradePanel = ({
  game,
  playerId,
  onTrade,
}: {
  game: GameState;
  playerId: string;
  onTrade: (give: Resource, giveAmount: number, receive: Resource) => void;
}) => {
  const [give, setGive] = useState<Resource | null>(null);
  const [receive, setReceive] = useState<Resource | null>(null);
  const player = game.players.find((p) => p.playerId === playerId)!;

  const ratio = give ? getBestRatio(game, playerId, give) : null;
  const canTrade = give !== null && receive !== null && give !== receive && ratio !== null && player.resources[give] >= ratio;

  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-black/20 px-3 py-2 text-sm">
      <span className="text-xs font-medium text-black/50">Bank / port trade</span>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs text-black/40">Give</span>
          <div className="flex gap-1">
            {RESOURCES.map((r) => (
              <button
                key={r}
                onClick={() => setGive(give === r ? null : r)}
                title={`${getBestRatio(game, playerId, r)}:1 — you have ${player.resources[r]}`}
                className={`flex h-8 w-8 items-center justify-center rounded border text-base ${
                  give === r ? "border-indigo-600 bg-indigo-50" : "border-black/20 hover:bg-black/5"
                }`}
              >
                {RESOURCE_ICONS[r]}
              </button>
            ))}
          </div>
        </div>
        <span className="text-black/40">
          {ratio ? `${ratio}:1 →` : "→"}
        </span>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs text-black/40">Receive</span>
          <div className="flex gap-1">
            {RESOURCES.map((r) => (
              <button
                key={r}
                disabled={r === give}
                onClick={() => setReceive(receive === r ? null : r)}
                className={`flex h-8 w-8 items-center justify-center rounded border text-base disabled:cursor-not-allowed disabled:opacity-30 ${
                  receive === r ? "border-indigo-600 bg-indigo-50" : "border-black/20 hover:bg-black/5"
                }`}
              >
                {RESOURCE_ICONS[r]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={() => {
          if (!canTrade || !give || !receive || !ratio) return;
          onTrade(give, ratio, receive);
          setGive(null);
          setReceive(null);
        }}
        disabled={!canTrade}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Trade with bank
      </button>
    </div>
  );
};
export default BankTradePanel;
