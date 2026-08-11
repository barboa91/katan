// A clickable/occupied road spot, drawn as a rotated bar between the two
// screen-space endpoints of a board edge.

import { Point } from "@/lib/game/types";

const EdgeSpot = ({
  a,
  b,
  color,
  interactive,
  onClick,
}: {
  a: Point;
  b: Point;
  color: string | null;
  interactive?: boolean;
  onClick?: () => void;
}) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const thickness = color ? 7 : 9;

  return (
    <button
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      title={interactive ? "Place road here" : undefined}
      className={interactive ? "absolute cursor-pointer hover:brightness-90" : "absolute"}
      style={{
        left: midX - length / 2,
        top: midY - thickness / 2,
        width: length,
        height: thickness,
        transform: `rotate(${angleDeg}deg)`,
        transformOrigin: "center",
        borderRadius: 3,
        backgroundColor: color ?? (interactive ? "rgba(0,0,0,0.12)" : "transparent"),
        pointerEvents: interactive || color ? "auto" : "none",
      }}
    />
  );
};
export default EdgeSpot;
