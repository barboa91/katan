// Builds a full playable board: shuffles resource/number tiles onto the
// template shape, then derives a deduplicated vertex/edge graph so that
// tiles which share a corner or side reference the exact same Vertex/Edge
// object. That graph is what later phases use for settlement distance
// rules and road connectivity — it doesn't get used for anything visual
// yet, but building it now avoids reworking the board model later.

import { Board, BoardSize, Edge, EdgeId, HexTile, Port, PortResource, Resource, Vertex, VertexId } from "./types";
import { axialDistance, axialToPixel, hexCorners } from "./hexMath";
import { BOARD_TEMPLATES, PORT_COUNTS, boardSizeForPlayerCount } from "./boardTemplates";
import { shuffle } from "./random";

/** Corner coordinates are rounded to this many decimal places before being
 * used as a dedupe key, to absorb floating-point noise from trig functions
 * so that the "same" corner computed via different tiles produces an
 * identical key. */
const CORNER_PRECISION = 1e4;

function vertexKey(x: number, y: number): VertexId {
  return `${Math.round(x * CORNER_PRECISION)}_${Math.round(y * CORNER_PRECISION)}`;
}

function edgeKey(a: VertexId, b: VertexId): EdgeId {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function hasAdjacentSixOrEight(tiles: HexTile[]): boolean {
  const hot = tiles.filter((t) => t.number === 6 || t.number === 8);
  for (let i = 0; i < hot.length; i++) {
    for (let j = i + 1; j < hot.length; j++) {
      if (axialDistance(hot[i].coord, hot[j].coord) === 1) return true;
    }
  }
  return false;
}

function placeTiles(template: (typeof BOARD_TEMPLATES)[BoardSize]): HexTile[] {
  const resources = shuffle(template.resources);
  const base = template.coords.map((coord, i) => ({ coord, resource: resources[i] }));

  let numbers: number[] = [];
  let tiles: HexTile[] = [];
  const MAX_ATTEMPTS = 200;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    numbers = shuffle(template.numbers);
    let numberCursor = 0;
    tiles = base.map(({ coord, resource }, i) => ({
      id: `${coord.q},${coord.r}`,
      coord,
      resource,
      number: resource === null ? null : numbers[numberCursor++],
    }));
    if (!hasAdjacentSixOrEight(tiles)) break;
  }
  return tiles;
}

/** Builds the deduplicated vertex/edge graph shared across adjacent tiles. */
function buildGraph(tiles: HexTile[], hexSize: number) {
  const vertices: Record<VertexId, Vertex> = {};
  const edges: Record<EdgeId, Edge> = {};

  for (const tile of tiles) {
    const center = axialToPixel(tile.coord, hexSize);
    const corners = hexCorners(center, hexSize);
    const cornerIds = corners.map((c) => vertexKey(c.x, c.y));

    cornerIds.forEach((vid, i) => {
      if (!vertices[vid]) {
        vertices[vid] = {
          id: vid,
          coord: corners[i],
          adjacentTileIds: [],
          adjacentVertexIds: [],
          building: null,
        };
      }
      if (!vertices[vid].adjacentTileIds.includes(tile.id)) {
        vertices[vid].adjacentTileIds.push(tile.id);
      }
    });

    for (let i = 0; i < 6; i++) {
      const a = cornerIds[i];
      const b = cornerIds[(i + 1) % 6];
      const eid = edgeKey(a, b);
      if (!edges[eid]) {
        edges[eid] = { id: eid, endpoints: [a, b], adjacentTileIds: [], road: null };
      }
      if (!edges[eid].adjacentTileIds.includes(tile.id)) {
        edges[eid].adjacentTileIds.push(tile.id);
      }
      if (!vertices[a].adjacentVertexIds.includes(b)) vertices[a].adjacentVertexIds.push(b);
      if (!vertices[b].adjacentVertexIds.includes(a)) vertices[b].adjacentVertexIds.push(a);
    }
  }

  return { vertices, edges };
}

/**
 * Walks the board's outer coastline into a single ordered cycle of edges.
 * A "coastal" edge touches only one tile (an inland edge always touches
 * two); every coastal vertex touches exactly two coastal edges, so a
 * greedy walk — at each vertex, take whichever coastal edge isn't the one
 * just arrived on — always closes back on itself with no dead ends, for
 * any of this file's generated board shapes.
 */
function orderedCoastline(edges: Record<EdgeId, Edge>): Edge[] {
  const coastal = Object.values(edges).filter((e) => e.adjacentTileIds.length === 1);
  if (coastal.length === 0) return [];

  const byVertex = new Map<VertexId, Edge[]>();
  for (const e of coastal) {
    for (const v of e.endpoints) {
      if (!byVertex.has(v)) byVertex.set(v, []);
      byVertex.get(v)!.push(e);
    }
  }

  const ordered: Edge[] = [];
  const visited = new Set<EdgeId>();
  let currentEdge = coastal[0];
  let currentVertex = currentEdge.endpoints[1];
  ordered.push(currentEdge);
  visited.add(currentEdge.id);

  while (ordered.length < coastal.length) {
    const next = (byVertex.get(currentVertex) ?? []).find((e) => !visited.has(e.id));
    if (!next) break; // shouldn't happen for a well-formed coastline; bail rather than loop forever
    ordered.push(next);
    visited.add(next.id);
    currentVertex = next.endpoints.find((v) => v !== currentVertex)!;
  }
  return ordered;
}

/**
 * Assigns the official port counts (see boardTemplates.PORT_COUNTS) to
 * evenly-spaced spots around the coastline, in a random rotation — the
 * same "correct counts, shuffled placement" approach the rest of this file
 * uses for resources/numbers, since the exact rulebook diagram positions
 * aren't being reproduced (see boardTemplates.ts's PORT_COUNTS comment).
 */
function generatePorts(edges: Record<EdgeId, Edge>, size: BoardSize): Port[] {
  const coastline = orderedCoastline(edges);
  if (coastline.length === 0) return [];

  const counts = PORT_COUNTS[size];
  const types: PortResource[] = shuffle([
    ...Array(counts.generic).fill("any" as const),
    ...(Object.entries(counts.resources) as [Resource, number][]).flatMap(([resource, n]) => Array(n).fill(resource)),
  ]);

  const spacing = coastline.length / types.length;
  return types.map((resource, i) => {
    const edge = coastline[Math.floor(i * spacing)];
    return { vertices: edge.endpoints, ratio: resource === "any" ? 3 : 2, resource };
  });
}

/**
 * Creates a full board for the given player count. `hexSize` is the
 * center-to-corner radius used for the vertex/edge pixel coordinates
 * (rendering scales this independently, so 1 is fine as a stable default).
 *
 * The robber starts on a desert tile (the standard board has exactly one;
 * the 5-6 player expansion has two — either is a legal starting spot, so
 * `find` picking the first is fine).
 */
export function createBoard(playerCount: number, hexSize = 1): Board {
  const size = boardSizeForPlayerCount(playerCount);
  const template = BOARD_TEMPLATES[size];
  const tiles = placeTiles(template);
  const { vertices, edges } = buildGraph(tiles, hexSize);
  const desert = tiles.find((t) => t.resource === null);
  if (!desert) throw new Error("Board template has no desert tile to start the robber on");
  const ports = generatePorts(edges, size);
  return { tiles, vertices, edges, ports, robberTileId: desert.id };
}
