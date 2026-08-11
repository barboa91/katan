// Pure hex-grid math: axial <-> pixel conversion and neighbor/distance
// lookups for pointy-top hexagons. No React/Node dependencies — safe to
// unit test and to share between the board generator and the renderer.
//
// Pointy-top orientation matches the existing Tile.tsx clip-path hexagon
// (a point at the top and bottom, flat vertical edges left/right).

import { Axial, Point } from "./types";

/** The six axial neighbor directions, index-matched to hex corner sides. */
export const AXIAL_DIRECTIONS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function axialNeighbor(coord: Axial, direction: number): Axial {
  const d = AXIAL_DIRECTIONS[((direction % 6) + 6) % 6];
  return { q: coord.q + d.q, r: coord.r + d.r };
}

export function axialToKey(coord: Axial): string {
  return `${coord.q},${coord.r}`;
}

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

/** Board vertex/edge coordinates are stored at hexSize=1 (see boardGen.ts);
 * this scales one up to whatever pixel size the renderer is using. */
export function scalePoint(p: Point, factor: number): Point {
  return { x: p.x * factor, y: p.y * factor };
}
