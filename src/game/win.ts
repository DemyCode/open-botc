import { CHARACTERS } from './characters.js';
import { record } from './history.js';
import { isExecution } from './constants.js';
import { msg } from './messages.js';
import type { GameState, Msg } from './types.js';

/** Sets the game's winner exactly once — later calls (e.g. a second condition firing the same
 * tick) are no-ops so the first true result always stands. */
export function setWinner(state: GameState, alignment: 'good' | 'evil', message: Msg): void {
  if (state.winner) return;
  record(state, 'win', { winner: alignment, message });
  state.winner = alignment;
  state.phase = 'ended';
  state.publicLog.push(message);
}

/** The win conditions that can become true at any moment, not just after a day action —
 * a night kill can just as easily leave no living Demon (a failed star-pass) or drop the alive
 * count to 2, and both must end the game immediately, the instant they happen. */
export function evaluateWin(state: GameState): void {
  if (state.winner) return;
  // The Mastermind's extra day is being played: only that day's execution decides (see engine.endDay).
  if (state.data.finalDay !== undefined) return;
  const alive = state.players.filter((p) => p.alive);
  // A Zombuul who "registers as dead" is still a Demon — and still counts as an alive player for
  // the "only 2 left" win condition (the town only *thinks* they are dead).
  const trulyAlive = state.players.filter((p) => p.alive || p.flags.hiddenAlive);
  const hiddenDemon = state.players.some((p) => p.flags.hiddenAlive && CHARACTERS[p.character].team === 'demon');
  const demonAlive = alive.some((p) => CHARACTERS[p.character].team === 'demon') || hiddenDemon;
  if (!demonAlive) {
    // "Good can't win if you both live" (the Evil Twin): the game goes on even with no Demon.
    if (alive.some((p) => CHARACTERS[p.character].hooks?.blocksGoodWin?.(state, p))) return;
    const byExecution = isExecution(state.data.demonDeathCause ?? '');
    const delayed = byExecution && alive.some((p) => CHARACTERS[p.character].hooks?.delaysGoodWin?.(state, p));
    if (delayed) {
      state.data.finalDay = state.day; // "play for 1 more day": the Demon's death is not announced
      record(state, 'finalDay', { day: state.day });
      return;
    }
    setWinner(state, 'good', msg('goodWinsDemonDead'));
    return;
  }
  if (trulyAlive.length <= 2) {
    setWinner(state, 'evil', msg('evilWinsTwoLeft'));
  }
}
