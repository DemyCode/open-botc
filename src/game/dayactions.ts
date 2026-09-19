// Day abilities that are used out loud (the Moonchild's curse, the Gossip's statement, the Juggler's
// guesses...). Like the Slayer's shot, any player of the right kind may CLAIM one — a bluffer pressing the
// same button looks exactly like the real character — but only the real, working character has an effect.
import { hooksOf } from './deaths.js';
import type { GameState, PlayerState } from './types.js';
import { GameError } from './types.js';

export interface OfferedAction {
  /** The character whose ability this is. */
  character: string;
  targets: number;
  statement: boolean;
}

const usedList = (p: PlayerState): string[] => ((p.flags.dayUsed as string[] | undefined) ?? []);

/** The day abilities this player is offered right now (same rule for everyone, so an offer proves nothing). */
export function offeredActions(state: GameState, self: PlayerState): OfferedAction[] {
  if (state.phase !== 'day') return [];
  const out: OfferedAction[] = [];
  for (const id of state.scriptChars) {
    const day = hooksOf(id).day;
    if (!day) continue;
    if (day.private && self.perceived !== id) continue;
    if ((day.offeredTo === 'alive') !== self.alive) continue;
    if (day.onlyDay !== undefined && state.day !== day.onlyDay) continue;
    if (usedList(self).includes(id)) continue;
    if (day.available && !day.available(state, self)) continue;
    out.push({ character: id, targets: day.targets, statement: !!day.statement });
  }
  return out;
}

/** Uses (or bluffs) a day ability. One use per player per ability. */
export function useDayAbility(state: GameState, playerId: string, charId: string, targets: string[], payload: Record<string, unknown>): void {
  const self = state.players.find((p) => p.id === playerId);
  if (!self) throw new GameError('Unknown player');
  const offer = offeredActions(state, self).find((o) => o.character === charId);
  if (!offer) throw new GameError('That ability is not available to you right now');
  if (targets.length !== offer.targets) throw new GameError('Invalid selection count');
  if (new Set(targets).size !== targets.length) throw new GameError('Cannot choose the same player twice');
  for (const id of targets) if (!state.players.some((p) => p.id === id)) throw new GameError('Invalid target');
  (self.flags.dayUsed ??= []) as string[];
  (self.flags.dayUsed as string[]).push(charId);
  hooksOf(charId).day!.use(state, self, targets, payload);
}
