// Day abilities that are used out loud (the Moonchild's curse, the Gossip's statement, the Juggler's
// guesses...). Like the Slayer's shot, any player of the right kind may CLAIM one — a bluffer pressing the
// same button looks exactly like the real character — but only the real, working character has an effect.
import { hooksOf } from './deaths.js';
import { beginNight } from './night.js';
import { noteMalfunction } from './registration.js';
import type { GameState, PlayerState } from './types.js';
import { GameError } from './types.js';

export interface OfferedAction {
  /** The character whose ability this is. */
  character: string;
  /** The character the player tells the village they are when using it (usually `character`). */
  claimAs: string;
  /** It is the player's own (believed) character: using it is not a bluff. */
  mine: boolean;
  /** Everyone at the table sees it being used (false: a private visit to the Storyteller). */
  public: boolean;
  targets: number;
  /** Which players may be pointed at: anyone, or only the living. */
  targetsAlive: boolean;
  form: 'statement' | 'question' | 'guesses' | null;
}

const usedList = (p: PlayerState): string[] => ((p.flags.dayUsed as string[] | undefined) ?? []);
/** How a use is remembered: once per game, or once per day for the "each day" abilities. */
const usageKey = (state: GameState, id: string): string => (hooksOf(id).day?.perDay ? `${id}@${state.day}` : id);

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
    if (usedList(self).includes(usageKey(state, id))) continue;
    if (day.available && !day.available(state, self)) continue;
    const claimAs = day.claimAs ? day.claimAs(state, self) : id;
    out.push({
      character: id, claimAs, mine: self.perceived === claimAs || !!day.claimAs, public: !day.private,
      targets: day.targets, targetsAlive: !!day.targetsAlive, form: day.form ?? null,
    });
  }
  return out;
}

/** Uses (or bluffs) a day ability. One use per player per ability (per day for the "each day" ones). */
export function useDayAbility(state: GameState, playerId: string, charId: string, targets: string[], payload: Record<string, unknown>): void {
  const self = state.players.find((p) => p.id === playerId);
  if (!self) throw new GameError('Unknown player');
  const offer = offeredActions(state, self).find((o) => o.character === charId);
  if (!offer) throw new GameError('That ability is not available to you right now');
  if (targets.length !== offer.targets) throw new GameError('Invalid selection count');
  if (new Set(targets).size !== targets.length) throw new GameError('Cannot choose the same player twice');
  for (const id of targets) if (!state.players.some((p) => p.id === id)) throw new GameError('Invalid target');
  noteMalfunction(state, self);
  const outcome = hooksOf(charId).day!.use(state, self, targets, payload);
  // (Only once it worked: a refused statement can be corrected and sent again.)
  ((self.flags.dayUsed ??= []) as string[]).push(usageKey(state, charId));
  // "There is a maximum of one execution per day": an ability's execution sends everyone to sleep.
  if (outcome === 'endsDay' && state.phase === 'day' && !state.winner) beginNight(state);
}
