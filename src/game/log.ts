import type { GameState, Msg } from './types.js';

/** Adds a line to one player's private log (what they have learned). */
export function appendLog(state: GameState, playerId: string, m: Msg): void {
  const p = state.players.find((pl) => pl.id === playerId);
  if (p) p.log.push({ night: state.night, msg: m });
}
