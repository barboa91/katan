import Image from "next/image";

import Tile from "../components/map/Tile";
import { TileData } from "@/components/new-types";
import GameMap from "@/components/map/GameMap";
import { GameMapTiles } from "@/components/new-types";

export default function Home() {
  const normalGameMap: GameMapTiles = [
    { resource: "wood", number: 0 },
    { resource: "wood", number: 0 },
    { resource: "wood", number: 0 },
    { resource: "wood", number: 0 },
    { resource: "ore", number: 0 },
    { resource: "ore", number: 0 },
    { resource: "ore", number: 0 },
    { resource: "sheep", number: 0 },
    { resource: "sheep", number: 0 },
    { resource: "sheep", number: 0 },
    { resource: "sheep", number: 0 },
    { resource: "brick", number: 0 },
    { resource: "brick", number: 0 },
    { resource: "brick", number: 0 },
    { resource: "wheat", number: 0 },
    { resource: "wheat", number: 0 },
    { resource: "wheat", number: 0 },
    { resource: "wheat", number: 0 },
  ];

  return (
    <main>
      <GameMap tiles={normalGameMap} />
    </main>
  );
}
