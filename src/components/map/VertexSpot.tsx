// A clickable/occupied settlement-or-city corner spot, absolutely
// positioned at a pre-computed screen coordinate (GameMap does the
// axial -> pixel projection; this component only draws a dot).

import { Point } from "@/lib/game/types";

type Building = { playerId: string; type: "settlement" | "city" } | null;

const VertexSpot = ({
  center,
  building,
  color,
  interactive,
  onClick,
}: {
  center: Point;
  building: Building;
  color: string | null;
  interactive?: boolean;
  onClick?: () => void;
}) => {
  const size = building ? (building.type === "city" ? 18 : 13) : 12;

  return (
    <button
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      title={interactive ? "Place settlement here" : undefined}
      className={`absolute rounded-full border ${
        building ? "border-black/50" : "border-transparent"
      } ${interactive ? "cursor-pointer border-black/30 hover:scale-125 hover:bg-black/25" : ""}`}
      style={{
        left: center.x - size / 2,
        top: center.y - size / 2,
        width: size,
        height: size,
        backgroundColor: color ?? (interactive ? "rgba(0,0,0,0.15)" : "transparent"),
        pointerEvents: interactive || building ? "auto" : "none",
      }}
    />
  );
};
export default VertexSpot;
