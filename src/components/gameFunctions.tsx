import {GameMapTiles} from './new-types';
export default function createGameTiles():GameMapTiles => {

  const normalGameMap: GameMapTiles = [];

  let tiles = [{wood: 4}, {ore: 3}, {sheep: 4}, {brick: 3}, {wheat: 4}];
  let tileNumbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

  //randomize the tiles numbers
  tileNumbers = tileNumbers.sort(() => Math.random() - 0.5);
  //

  for (let i = 0; i < tiles.length; i++) {
    let tile = tiles[i];
    let resource:String = Object.keys(tile)[0];
    let number = tileNumbers.pop();
    for (let j = 0; j < tile[resource]; j++) {
      normalGameMap.push({ resource: resource, number: number });
    }
  }
  return normalGameMap;
}
