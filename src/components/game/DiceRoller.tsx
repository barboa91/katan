import { DiceRoll } from "@/lib/game/state";

const DiceRoller = ({
  lastRoll,
  canRoll,
  canEndTurn,
  onRoll,
  onEndTurn,
}: {
  lastRoll: DiceRoll | null;
  canRoll: boolean;
  canEndTurn: boolean;
  onRoll: () => void;
  onEndTurn: () => void;
}) => {
  return (
    <div className="flex items-center gap-4">
      {lastRoll && (
        <span className="font-mono text-lg">
          🎲 {lastRoll.die1} + {lastRoll.die2} = <strong>{lastRoll.total}</strong>
        </span>
      )}
      <button
        onClick={onRoll}
        disabled={!canRoll}
        className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Roll dice
      </button>
      <button
        onClick={onEndTurn}
        disabled={!canEndTurn}
        className="rounded-md bg-gray-600 px-4 py-2 font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        End turn
      </button>
    </div>
  );
};
export default DiceRoller;
