import react from "react";
import { TileData } from "../new-types";
import { GameMapTiles } from "../new-types";

const GameMap = (props: GameMapTiles) => {
  return (
    <div className="somthing">
      {props.map((idx, cou) => (
        <div key={cou} />
      ))}
    </div>
  );
};
export default GameMap;
