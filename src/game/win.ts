import { CHARACTERS } from './characters.js';
import { record } from './history.js';
import type { GameState, Msg } from './types.js';

function msg(key: string): Msg {
  return { key };
}

/** Sets the game's winner exactly once — later calls (e.g. a second condition firing the same
 * tick) are no-ops so the first true result always stands. */
export function setWinner(state: GameState, alignment: 'good' | 'evil', message: Msg): void {
  if (state.winner) return;
  record(state, 'win', { winner: alignment, message });
  state.winner = alignment;
  state.phase = 'ended';
  state.publicLog.push(message);
}

/** The two win conditions that can become true at any moment, not just after a day action —
 * a night kill can just as easily leave no living Demon (a failed star-pass) or drop the alive
 * count to 2, and both must end the game immediately, the instant they happen. */
export function evaluateWin(state: GameState): void {
  if (state.winner) return;
  const alive = state.players.filter((p) => p.alive);
  const demonAlive = alive.some((p) => CHARACTERS[p.character].team === 'demon');
  if (!demonAlive) {
    setWinner(state, 'good', msg('goodWinsDemonDead'));
    return;
  }
  if (alive.length <= 2) {
    setWinner(state, 'evil', msg('evilWinsTwoLeft'));
  }
}
