// This is the tile component that is used to build the katan map
//
// It is a hexagon div compnenent that reads in tile data and renders the tile
//

import React from "react";
import { TileData } from "../new-types";

let tileColor = function ({ tile }: { tile: TileData }): string {
  switch (tile.resource) {
    case "wood":
      return "green";
    case "ore":
      return "black";
    case "wheat":
      return "yellow";
    case "brick":
      return "red";
    case "sheep":
      return "white";
    default:
      return "blue";
  }
};

const Tile = ({ tile }: { tile: TileData }) => {
  return (
    <div
      style={{
        width: "100px",
        height: "100px",
        backgroundColor: tileColor({ tile }),
        margin: "auto",
        clipPath:
          "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
      }}
    >
      <div style={{ width: "50%", margin: "auto", paddingTop: "30%" }}>
        {tile.resource} {tile.number}
      </div>
    </div>
  );
};
export default Tile;
