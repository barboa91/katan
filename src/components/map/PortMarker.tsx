// A small non-interactive badge marking a port's ratio/resource, drawn just
// outside the board's edge at the midpoint of the two vertices it sits
// between (GameMap computes that offset position — this only draws the dot).

import { Point, PortResource } from "@/lib/game/types";
import { RESOURCE_ICONS } from "@/lib/constants";

// "any" isn't a real Resource (it's a generic 3:1 port), so it's layered
// on top of the shared RESOURCE_ICONS map rather than living in it.
const PORT_ICONS: Record<PortResource, string> = { ...RESOURCE_ICONS, any: "⚓" };

const PortMarker = ({
  center,
  ratio,
  resource,
  owned,
}: {
  center: Point;
  ratio: 2 | 3;
  resource: PortResource;
  /** True when the local player has a settlement/city on either of this
   * port's vertices — highlighted so its rate is easy to spot at a glance. */
  owned: boolean;
}) => {
  return (
    <div
      title={`${ratio}:1 ${resource === "any" ? "any resource" : resource}`}
      className="absolute flex flex-col items-center justify-center rounded-full text-[10px] font-semibold leading-none"
      style={{
        left: center.x - 14,
        top: center.y - 14,
        width: 28,
        height: 28,
        backgroundColor: owned ? "#fef3c7" : "rgba(255,255,255,0.85)",
        boxShadow: owned ? "0 0 0 2px #d97706" : "0 0 0 1px rgba(0,0,0,0.2)",
      }}
    >
      <span>{PORT_ICONS[resource]}</span>
      <span className="text-black/60">{ratio}:1</span>
    </div>
  );
};
export default PortMarker;
