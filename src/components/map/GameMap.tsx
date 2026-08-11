// Projects tiles, vertices, and edges from board-space (axial coords for
// tiles, hexSize=1 pixel coords for vertices/edges — see boardGen.ts) into
// screen space, and renders the whole board as a relatively-positioned
// container of absolutely-positioned pieces. Bounding box is computed from
// tile corners, so the board is tightly centered regardless of shape.

"use client";

import React, { useEffect, useRef, useState } from "react";
import { Board } from "@/lib/game/types";
import { axialToPixel, scalePoint } from "@/lib/game/hexMath";
import Tile from "./Tile";
import VertexSpot from "./VertexSpot";
import EdgeSpot from "./EdgeSpot";
import PortMarker from "./PortMarker";

type PlayerColorLookup = (playerId: string) => string;

const GameMap = ({
  board,
  playerColor,
  hexSize = 45,
  interactiveVertices = false,
  interactiveEdges = false,
  legalVertexIds,
  legalEdgeIds,
  onVertexClick,
  onEdgeClick,
  interactiveTiles = false,
  onTileClick,
  ownPortVertexIds,
}: {
  board: Board;
  playerColor: PlayerColorLookup;
  hexSize?: number;
  interactiveVertices?: boolean;
  interactiveEdges?: boolean;
  /** Restricts which unoccupied vertices/edges actually render as
   * clickable, on top of the phase-level interactiveVertices/Edges gate.
   * Undefined means "every unoccupied one" (only correct for phases with
   * no extra placement constraint — setup phase always passes these). */
  legalVertexIds?: Set<string>;
  legalEdgeIds?: Set<string>;
  onVertexClick?: (vertexId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
  /** True while the current player is picking where to move the robber —
   * every tile except the one it's currently on becomes clickable. */
  interactiveTiles?: boolean;
  onTileClick?: (tileId: string) => void;
  /** Vertex IDs the local player has a building on that also sit on a port
   * — used only to highlight owned ports on the map. Undefined highlights
   * nothing (fine for spectator/lobby-preview renders with no local player). */
  ownPortVertexIds?: Set<string>;
}) => {
  const width = Math.sqrt(3) * hexSize;
  const height = 2 * hexSize;

  const tilePositions = board.tiles.map((tile) => ({ tile, center: axialToPixel(tile.coord, hexSize) }));

  const minX = Math.min(...tilePositions.map((p) => p.center.x)) - width / 2;
  const maxX = Math.max(...tilePositions.map((p) => p.center.x)) + width / 2;
  const minY = Math.min(...tilePositions.map((p) => p.center.y)) - height / 2;
  const maxY = Math.max(...tilePositions.map((p) => p.center.y)) + height / 2;

  const toScreen = (p: { x: number; y: number }) => {
    const scaled = scalePoint(p, hexSize);
    return { x: scaled.x - minX, y: scaled.y - minY };
  };

  const naturalWidth = maxX - minX;
  const naturalHeight = maxY - minY;

  // Shrink-to-fit: the board is laid out at its natural pixel size, then
  // scaled down via CSS transform if that's wider than the available
  // space (phones, narrow windows). The outer wrapper is sized to the
  // *scaled* footprint so page layout doesn't reserve the unscaled space —
  // clicks still land correctly since the browser accounts for the
  // transform. Never scales up past 1 (no point enlarging on wide screens).
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function updateScale() {
      const available = wrapperRef.current?.parentElement?.clientWidth ?? window.innerWidth;
      setScale(Math.min(1, (available - 8) / naturalWidth));
    }
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [naturalWidth]);

  return (
    <div ref={wrapperRef} style={{ width: naturalWidth * scale, height: naturalHeight * scale }}>
      <div
        className="relative"
        style={{ width: naturalWidth, height: naturalHeight, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {tilePositions.map(({ tile, center }) => (
          <Tile
            key={tile.id}
            tile={tile}
            size={hexSize}
            center={{ x: center.x - minX, y: center.y - minY }}
            hasRobber={tile.id === board.robberTileId}
            interactive={interactiveTiles && tile.id !== board.robberTileId}
            onClick={() => onTileClick?.(tile.id)}
          />
        ))}

        {Object.values(board.edges).map((edge) => {
          const a = board.vertices[edge.endpoints[0]]?.coord;
          const b = board.vertices[edge.endpoints[1]]?.coord;
          if (!a || !b) return null;
          return (
            <EdgeSpot
              key={edge.id}
              a={toScreen(a)}
              b={toScreen(b)}
              color={edge.road ? playerColor(edge.road.playerId) : null}
              interactive={interactiveEdges && !edge.road && (!legalEdgeIds || legalEdgeIds.has(edge.id))}
              onClick={() => onEdgeClick?.(edge.id)}
            />
          );
        })}

        {Object.values(board.vertices).map((vertex) => (
          <VertexSpot
            key={vertex.id}
            center={toScreen(vertex.coord)}
            building={vertex.building}
            color={vertex.building ? playerColor(vertex.building.playerId) : null}
            interactive={
              interactiveVertices && !vertex.building && (!legalVertexIds || legalVertexIds.has(vertex.id))
            }
            onClick={() => onVertexClick?.(vertex.id)}
          />
        ))}

        {board.ports.map((port, i) => {
          const a = board.vertices[port.vertices[0]]?.coord;
          const b = board.vertices[port.vertices[1]]?.coord;
          if (!a || !b) return null;
          // Midpoint of the port's two vertices, nudged further away from
          // the board center so the badge sits just outside the coastline
          // instead of overlapping the vertex/edge pieces right on it.
          const mid = toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          const boardCenter = { x: naturalWidth / 2, y: naturalHeight / 2 };
          const dx = mid.x - boardCenter.x;
          const dy = mid.y - boardCenter.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const offset = { x: mid.x + (dx / dist) * 22, y: mid.y + (dy / dist) * 22 };
          return (
            <PortMarker
              key={i}
              center={offset}
              ratio={port.ratio}
              resource={port.resource}
              owned={port.vertices.some((vid) => ownPortVertexIds?.has(vid))}
            />
          );
        })}
      </div>
    </div>
  );
};
export default GameMap;
