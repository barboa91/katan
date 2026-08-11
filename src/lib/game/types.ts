// Core domain types for the Catan board model.
//
// Coordinates use the axial hex system (q, r). Vertices and edges are
// deduplicated across sharing tiles via canonical string IDs computed from
// rounded pixel-space corner positions (see boardGen.ts) — this lets three
// tiles that meet at a point all reference the exact same Vertex object,
// which is what makes settlement distance rules and road connectivity
// possible later.

export type Axial = { q: number; r: number };

export type Point = { x: number; y: number };

export type Resource = "wood" | "brick" | "sheep" | "wheat" | "ore";

export type DevCardType = "knight" | "roadBuilding" | "yearOfPlenty" | "monopoly" | "victoryPoint";

/** A hex tile. `resource` is null and `number` is null only for the desert. */
export type HexTile = {
  id: string;
  coord: Axial;
  resource: Resource | null;
  number: number | null;
};

export type VertexId = string;
export type EdgeId = string;

export type Vertex = {
  id: VertexId;
  /** Pixel-space position at hexSize=1, used for rendering and corner math. */
  coord: Point;
  adjacentTileIds: string[];
  adjacentVertexIds: VertexId[];
  building: { playerId: string; type: "settlement" | "city" } | null;
};

export type Edge = {
  id: EdgeId;
  endpoints: [VertexId, VertexId];
  adjacentTileIds: string[];
  road: { playerId: string } | null;
};

export type PortResource = Resource | "any";

export type Port = {
  vertices: [VertexId, VertexId];
  ratio: 2 | 3;
  resource: PortResource;
};

export type Board = {
  tiles: HexTile[];
  vertices: Record<VertexId, Vertex>;
  edges: Record<EdgeId, Edge>;
  ports: Port[];
  /** The tile the robber currently sits on. Production on this tile is
   * blocked (see rules.ts's distributeResources) until it's moved. */
  robberTileId: string;
};

export type BoardSize = "standard" | "expansion";
