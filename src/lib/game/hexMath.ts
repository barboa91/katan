// Pure hex-grid math: axial <-> pixel conversion and neighbor/distance
// lookups for pointy-top hexagons. No React/Node dependencies — safe to
// unit test and to share between the board generator and the renderer.
//
// Pointy-top orientation matches the existing Tile.tsx clip-path hexagon
// (a point at the top and bottom, flat vertical edges left/right).

import { Axial, Point } from "./types";

/** Cube-coordinate distance between two axial hexes. */
export function axialDistance(a: Axial, b: Axial): number {
  const aq = a.q, ar = a.r, as = -a.q - a.r;
  const bq = b.q, br = b.r, bs = -b.q - b.r;
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
}

/** Pixel center of a hex, for pointy-top orientation, at the given size (center-to-corner radius). */
export function axialToPixel(coord: Axial, size: number): Point {
  return {
    x: size * Math.sqrt(3) * (coord.q + coord.r / 2),
    y: size * 1.5 * coord.r,
  };
}

/**
 * Pixel position of corner `i` (0-5) of a pointy-top hex centered at `center`.
 * Corner order goes clockwise starting from the upper-right corner, which
 * also means edge i connects corner i to corner (i+1)%6.
 */
export function hexCorner(center: Point, size: number, i: number): Point {
  const angleDeg = 60 * i - 30;
  const angleRad = (Math.PI / 180) * angleDeg;
  return {
    x: center.x + size * Math.cos(angleRad),
    y: center.y + size * Math.sin(angleRad),
  };
}

export function hexCorners(center: Point, size: number): Point[] {
  return [0, 1, 2, 3, 4, 5].map((i) => hexCorner(center, size, i));
}

/** Bounding box of a pointy-top hex at the given size — the shared source
 * for the `sqrt(3)*size` width / `2*size` height ratio that both Tile.tsx
 * and GameMap.tsx need (that exact ratio is what makes the clip-path
 * polygon render as a true hexagon and tile edge-to-edge with no gaps). */
export function hexDimensions(size: number): { width: number; height: number } {
  return { width: Math.sqrt(3) * size, height: 2 * size };
}

/** Board vertex/edge coordinates are stored at hexSize=1 (see boardGen.ts);
 * this scales one up to whatever pixel size the renderer is using. */
export function scalePoint(p: Point, factor: number): Point {
  return { x: p.x * factor, y: p.y * factor };
}
