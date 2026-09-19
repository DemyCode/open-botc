// Lasting drunkenness / poison beyond the Poisoner's own (see registration.ts for how they matter).
import { record } from './history.js';
import type { GameState, PlayerState } from './types.js';

/** Makes `target` drunk. `untilNight`: it wears off when the night after that one begins ("until dusk"). */
export function addDrunk(
  state: GameState, target: PlayerState, source: PlayerState | null, sourceChar: string, untilNight: number | null,
  opts: { needsSourceWorking?: boolean; needsSourceAlive?: boolean; needsTargetChar?: string } = {},
): void {
  state.effects.push({ kind: 'drunk', target: target.id, source: source?.id ?? null, sourceChar, untilNight, ...opts });
  record(state, 'effect', { kind: 'drunk', target: target.id, source: source?.id ?? null, sourceChar });
}

export function addPoison(
  state: GameState, target: PlayerState, source: PlayerState | null, sourceChar: string, untilNight: number | null,
  opts: { needsSourceAlive?: boolean } = {},
): void {
  state.effects.push({ kind: 'poisoned', target: target.id, source: source?.id ?? null, sourceChar, untilNight, ...opts });
  record(state, 'effect', { kind: 'poisoned', target: target.id, source: source?.id ?? null, sourceChar });
}

/** Removes every effect of one kind of source on a target (or all of a source's effects). */
export function removeEffects(state: GameState, match: { target?: string; source?: string; sourceChar?: string }): void {
  state.effects = state.effects.filter((e) =>
    !((match.target === undefined || e.target === match.target) &&
      (match.source === undefined || e.source === match.source) &&
      (match.sourceChar === undefined || e.sourceChar === match.sourceChar)));
}
