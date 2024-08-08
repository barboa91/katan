import react from "react";
import { TileData } from "../new-types";
import { GameMapTiles } from "../new-types";
import Tile from "./Tile";

const GameMap = ({ tiles }: { tiles: GameMapTiles }) => {
  return (
    <div className="theMap">
      {tiles.map((tile, key) => (
        <Tile tile={tile} key={tile.number} />
      ))}
      {console.log(tiles)}
    </div>
  );
};
export default GameMap;
