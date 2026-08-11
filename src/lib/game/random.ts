// Shared Fisher-Yates shuffle — every part of the game that needs to
// randomize a collection (board resource/number tiles, port types, turn
// order, the dev card deck) uses this one implementation. No Node/browser
// dependency, matching the rest of src/lib/game/*.
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
