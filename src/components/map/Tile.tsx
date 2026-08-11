// Renders a single hex tile as an absolutely-positioned, clip-path
// hexagon. Positioning comes entirely from `center` (pixel coordinates
// computed by GameMap from the tile's axial coord) — this component no
// longer guesses its own layout.

import React from "react";
import { HexTile, Point } from "@/lib/game/types";

const RESOURCE_COLORS: Record<string, string> = {
  wood: "#2f7a3d",
  ore: "#8a8f98",
  wheat: "#e0b83c",
  brick: "#b1502f",
  sheep: "#9ed15b",
};
const DESERT_COLOR = "#dcc48e";

function tileColor(tile: HexTile): string {
  if (tile.resource === null) return DESERT_COLOR;
  return RESOURCE_COLORS[tile.resource] ?? "#4a90d9";
}

const Tile = ({
  tile,
  center,
  size,
  hasRobber = false,
  interactive = false,
  onClick,
}: {
  tile: HexTile;
  center: Point;
  size: number;
  hasRobber?: boolean;
  /** True while the current player is choosing where to move the robber —
   * renders a highlighted, clickable ring around every legal target tile. */
  interactive?: boolean;
  onClick?: () => void;
}) => {
  // Pointy-top regular hexagon: width = sqrt(3)*size, height = 2*size.
  // Using this exact ratio (rather than a square box) is what makes the
  // clip-path polygon below render as a true hexagon instead of a
  // squashed one, and lets adjacent tiles tile edge-to-edge with no gaps.
  const width = Math.sqrt(3) * size;
  const height = 2 * size;

  return (
    <div
      className={`absolute flex items-center justify-center text-center text-xs font-medium text-black/80 ${interactive ? "cursor-pointer" : ""}`}
      onClick={interactive ? onClick : undefined}
      style={{
        width,
        height,
        left: center.x - width / 2,
        top: center.y - height / 2,
        backgroundColor: tileColor(tile),
        clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
        boxShadow: interactive
          ? "inset 0 0 0 3px #4338ca"
          : "inset 0 0 0 1px rgba(0,0,0,0.15)",
      }}
    >
      <div>
        <div className="capitalize">{tile.resource ?? "desert"}</div>
        {tile.number !== null && (
          <div
            className="mx-auto mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-white font-bold"
            style={{ color: tile.number === 6 || tile.number === 8 ? "#c0392b" : "#222" }}
          >
            {tile.number}
          </div>
        )}
        {hasRobber && (
          <div className="mx-auto mt-1 text-lg leading-none" title="The robber">
            🥷
          </div>
        )}
      </div>
    </div>
  );
};
export default Tile;
