// Quick sanity check for the board generator's vertex/edge graph. Run with
// `npm run verify:board`. There's no test framework wired up yet (Phase 1
// scope), so this is a standalone script rather than a proper test suite —
// worth converting to real unit tests once a test runner is added.

import { createBoard } from "../src/lib/game/boardGen";
import { axialDistance } from "../src/lib/game/hexMath";
import { PORT_COUNTS, boardSizeForPlayerCount } from "../src/lib/game/boardTemplates";

function check(playerCount: number, expectedTiles: number) {
  const board = createBoard(playerCount);
  const vertexCount = Object.keys(board.vertices).length;
  const edgeCount = Object.keys(board.edges).length;
  const numberedTiles = board.tiles.filter((t) => t.number !== null);
  const desertTiles = board.tiles.filter((t) => t.resource === null);

  // --- Ports (Phase 8) ---
  const portConfig = PORT_COUNTS[boardSizeForPlayerCount(playerCount)];
  const expectedPortCount = portConfig.generic + Object.values(portConfig.resources).reduce((a, b) => a + b, 0);
  const genericPorts = board.ports.filter((p) => p.resource === "any");
  const resourcePortCounts: Record<string, number> = {};
  for (const p of board.ports) {
    if (p.resource !== "any") resourcePortCounts[p.resource] = (resourcePortCounts[p.resource] ?? 0) + 1;
  }
  const resourceCountsMatch = Object.entries(portConfig.resources).every(
    ([r, n]) => (resourcePortCounts[r] ?? 0) === n
  );
  // Every port must sit on a real coastal edge (the two vertices it names
  // are connected by an edge touching exactly one tile) — otherwise a
  // "port" could silently reference two vertices that aren't even adjacent.
  const edgeByEndpoints = new Set(
    Object.values(board.edges)
      .filter((e) => e.adjacentTileIds.length === 1)
      .map((e) => [e.endpoints[0], e.endpoints[1]].sort().join("|"))
  );
  const badPorts = board.ports.filter((p) => !edgeByEndpoints.has([p.vertices[0], p.vertices[1]].sort().join("|")));
  // No two ports should double up on the exact same coastal edge.
  const portEdgeKeys = board.ports.map((p) => [p.vertices[0], p.vertices[1]].sort().join("|"));
  const duplicatePortEdges = portEdgeKeys.length - new Set(portEdgeKeys).size;

  // Every vertex should touch 1-3 tiles (1-2 on the board edge, 3 inland).
  const badVertices = Object.values(board.vertices).filter(
    (v) => v.adjacentTileIds.length < 1 || v.adjacentTileIds.length > 3
  );
  // Every edge should touch 1-2 tiles.
  const badEdges = Object.values(board.edges).filter(
    (e) => e.adjacentTileIds.length < 1 || e.adjacentTileIds.length > 2
  );
  // Every vertex should have 2-3 neighboring vertices.
  const badVertexDegree = Object.values(board.vertices).filter(
    (v) => v.adjacentVertexIds.length < 2 || v.adjacentVertexIds.length > 3
  );

  const hotTiles = board.tiles.filter((t) => t.number === 6 || t.number === 8);
  let adjacentHot = 0;
  for (let i = 0; i < hotTiles.length; i++) {
    for (let j = i + 1; j < hotTiles.length; j++) {
      if (axialDistance(hotTiles[i].coord, hotTiles[j].coord) === 1) adjacentHot++;
    }
  }

  const ok = (b: boolean) => (b ? "OK" : "FAIL");
  console.log(`\n--- ${playerCount}p board ---`);
  console.log(`tiles: ${board.tiles.length} (expected ${expectedTiles}) ${ok(board.tiles.length === expectedTiles)}`);
  console.log(`desert tiles: ${desertTiles.length}`);
  console.log(`numbered tiles: ${numberedTiles.length}`);
  console.log(`vertices: ${vertexCount}, edges: ${edgeCount}`);
  console.log(`bad vertices: ${badVertices.length} ${ok(badVertices.length === 0)}`);
  console.log(`bad edges: ${badEdges.length} ${ok(badEdges.length === 0)}`);
  console.log(`bad vertex degree: ${badVertexDegree.length} ${ok(badVertexDegree.length === 0)}`);
  console.log(`adjacent 6/8 pairs: ${adjacentHot} ${ok(adjacentHot === 0)}`);
  console.log(
    `ports: ${board.ports.length} (expected ${expectedPortCount}) ${ok(board.ports.length === expectedPortCount)}`
  );
  console.log(`generic ports: ${genericPorts.length} (expected ${portConfig.generic}) ${ok(genericPorts.length === portConfig.generic)}`);
  console.log(`resource port counts match: ${ok(resourceCountsMatch)}`);
  console.log(`ports off the coastline: ${badPorts.length} ${ok(badPorts.length === 0)}`);
  console.log(`duplicate port edges: ${duplicatePortEdges} ${ok(duplicatePortEdges === 0)}`);
}

check(4, 19);
check(6, 30);
