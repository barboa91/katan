// Blocking modal shown to a player who owes a discard after a 7 is rolled
// (game.discardsOwed[playerId] !== undefined). Only covers the current
// player's own hand — other over-limit players get their own copy of this
// on their own screen, driven by the same broadcast GameState.

import { useState } from "react";
import { Resource } from "@/lib/game/types";

const RESOURCE_ICONS: Record<Resource, string> = {
  wood: "🪵",
  brick: "🧱",
  sheep: "🐑",
  wheat: "🌾",
  ore: "⛰️",
};

const DiscardModal = ({
  owed,
  resources,
  onSubmit,
}: {
  owed: number;
  resources: Record<Resource, number>;
  onSubmit: (selection: Partial<Record<Resource, number>>) => void;
}) => {
  const [selection, setSelection] = useState<Record<Resource, number>>({
    wood: 0,
    brick: 0,
    sheep: 0,
    wheat: 0,
    ore: 0,
  });

  const selected = Object.values(selection).reduce((sum, n) => sum + n, 0);

  function adjust(resource: Resource, delta: number) {
    setSelection((prev) => {
      const next = prev[resource] + delta;
      if (next < 0 || next > resources[resource]) return prev;
      if (delta > 0 && selected >= owed) return prev;
      return { ...prev, [resource]: next };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex w-72 flex-col gap-3 rounded-lg bg-white p-5 shadow-lg">
        <h2 className="font-semibold">Discard {owed} card{owed === 1 ? "" : "s"}</h2>
        <p className="text-xs text-black/50">A 7 was rolled and your hand is over the 7-card limit.</p>
        <div className="flex flex-col gap-2">
          {(Object.keys(RESOURCE_ICONS) as Resource[]).map((r) => (
            <div key={r} className="flex items-center justify-between text-sm">
              <span>
                {RESOURCE_ICONS[r]} {r} <span className="text-black/40">({resources[r]})</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => adjust(r, -1)}
                  disabled={selection[r] <= 0}
                  className="h-6 w-6 rounded border border-black/20 disabled:opacity-30"
                >
                  −
                </button>
                <span className="w-4 text-center">{selection[r]}</span>
                <button
                  onClick={() => adjust(r, 1)}
                  disabled={selection[r] >= resources[r] || selected >= owed}
                  className="h-6 w-6 rounded border border-black/20 disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => onSubmit(selection)}
          disabled={selected !== owed}
          className="mt-2 rounded-md bg-red-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Discard {selected}/{owed}
        </button>
      </div>
    </div>
  );
};
export default DiscardModal;
