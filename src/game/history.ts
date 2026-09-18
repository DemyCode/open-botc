import type { GameState, HistoryEvent } from './types.js';

/**
 * Appends one thing that happened to the game's history. The history is the "replay" shown to
 * everyone once the game is over: it holds the secrets (who really did what, what was false
 * and why) so it is NEVER sent to a phone before the game has ended (see view.ts).
 *
 * Players are referred to by id and characters by id, so the app can show them in any language.
 */
export function record(state: GameState, type: string, vars: Record<string, unknown> = {}): void {
  const phase: HistoryEvent['phase'] = state.phase === 'night' ? 'night' : state.phase === 'day' ? 'day' : 'setup';
  state.history.push({ seq: state.history.length, phase, night: state.night, day: state.day, type, vars });
}
