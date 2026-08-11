import { GameState } from "@/lib/game/state";

const EndGameScreen = ({
  game,
  playerId,
  onBackToHome,
}: {
  game: GameState;
  playerId: string;
  onBackToHome: () => void;
}) => {
  const winner = game.players.find((p) => p.playerId === game.winnerId);
  const standings = [...game.players].sort((a, b) => b.victoryPoints - a.victoryPoints);
  const youWon = game.winnerId === playerId;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-10">
      <h1 className="text-3xl font-bold" style={{ color: winner?.color }}>
        {youWon ? "You win! 🎉" : `${winner?.nickname ?? "Someone"} wins!`}
      </h1>

      <ol className="flex w-full max-w-sm flex-col gap-2">
        {standings.map((p, i) => (
          <li
            key={p.playerId}
            className="flex items-center justify-between rounded-md border px-4 py-2"
            style={{ borderColor: p.color, borderWidth: p.playerId === game.winnerId ? 3 : 1 }}
          >
            <span>
              {i + 1}. {p.nickname}
              {p.playerId === playerId && <span className="text-black/40"> (you)</span>}
            </span>
            <span className="font-semibold">{p.victoryPoints} VP</span>
          </li>
        ))}
      </ol>

      <button
        onClick={onBackToHome}
        className="rounded-md bg-blue-600 px-6 py-2 font-medium text-white transition hover:bg-blue-700"
      >
        Back to home
      </button>
    </main>
  );
};
export default EndGameScreen;
