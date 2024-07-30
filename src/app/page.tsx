import Image from "next/image";

import Tile from "../components/map/Tile";
import { GameMapTiles, TileData } from "@/components/new-types";
import GameMap from "../components/map/GameMap";

export default function Home() {
  const theMap: GameMapTiles = [{ resource: "wood", number: 3 }];
  return (
    <main>
      <div>Katan</div>
      <GameMap props={theMap} />
    </main>
  );
}
