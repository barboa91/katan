import { GameState } from "@/lib/game/state";

const TurnBanner = ({ game, playerId }: { game: GameState; playerId: string }) => {
  if (game.phase === "setup" && game.setup) {
    const activeId = game.setup.order[game.setup.index];
    const active = game.players.find((p) => p.playerId === activeId);
    const isMe = activeId === playerId;
    const roundLabel = game.setup.index >= game.turnOrder.length ? "round 2" : "round 1";
    const action = game.setup.subphase === "placeSettlement" ? "place a settlement" : "place a road";
    return (
      <p className="text-lg font-medium">
        Setup ({roundLabel}): {isMe ? "your turn" : `${active?.nickname ?? "?"}'s turn`} — {action}
      </p>
    );
  }

  const activeId = game.turnOrder[game.currentPlayerIndex];
  const active = game.players.find((p) => p.playerId === activeId);
  const isMe = activeId === playerId;

  // 5-6 player games only (see state.ts's GameState.specialBuilding) — the
  // active player above has already ended their real turn, and everyone
  // else takes a build-only mini-turn in order before the next real turn
  // begins. Checked ahead of turnSubphase since specialBuilding freezes
  // turnSubphase at "postRoll" throughout, so this needs to take priority.
  if (game.specialBuilding) {
    const actingId = game.specialBuilding[0];
    const acting = game.players.find((p) => p.playerId === actingId);
    const isMyBuildTurn = actingId === playerId;
    return (
      <p className="text-lg font-medium text-indigo-700">
        Special Building Phase — {isMyBuildTurn ? "your turn to build or buy, then pass" : `waiting on ${acting?.nickname ?? "?"}`}
      </p>
    );
  }

  if (game.turnSubphase === "discarding") {
    const owedCount = Object.keys(game.discardsOwed).length;
    return (
      <p className="text-lg font-medium text-red-700">
        A 7 was rolled — waiting on {owedCount} player{owedCount === 1 ? "" : "s"} to discard
      </p>
    );
  }

  const action =
    game.turnSubphase === "preRoll"
      ? "roll the dice"
      : game.turnSubphase === "moveRobber"
        ? "move the robber"
        : "build or end turn";

  return (
    <p className="text-lg font-medium">
      {isMe ? "Your turn" : `${active?.nickname ?? "?"}'s turn`} — {action}
    </p>
  );
};
export default TurnBanner;
