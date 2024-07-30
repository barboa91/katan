// new-types.d.10:21:01
//
export type Resource = "wood" | "brick" | "sheep" | "wheat" | "ore";

export type TileData = {
  resource: Resource;
  number: number;
};
export type GameMapTiles = TileData[];
