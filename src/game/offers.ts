// What a player may do right now, decided once: the engine refuses anything with a reason, and the view
// offers exactly what has none — so the client never has to know a rule to show or hide a control.
import type { GameState, PlayerState } from './types.js';

/** Why `nominatorId` may not nominate `nomineeId` (or anyone, if omitted) right now — null if they may. */
export function nominationRefusal(state: GameState, nominator: PlayerState, nominee?: PlayerState): string | null {
  if (state.phase !== 'day') return 'Not day phase';
  if (state.currentNomination) return 'A nomination is already in progress';
  // Dead players can be nominated (rarely wise, but legal) — only the living may nominate.
  if (!nominator.alive) return 'Dead players cannot nominate';
  if (state.usedNominatorIds.includes(nominator.id)) return 'Already nominated today';
  if (nominee && state.usedNomineeIds.includes(nominee.id)) return 'Already nominated today';
  return null;
}

/** Why `self` may not fire the Slayer shot right now — null if they may (whoever they truly are: anyone may bluff it). */
export function slayerShotRefusal(state: GameState, self: PlayerState): string | null {
  if (state.phase !== 'day') return 'Slayer can only be used during the day';
  if (!state.scriptChars.includes('slayer')) return 'The Slayer is not in this script';
  if (!self.alive) return 'Dead players cannot use the Slayer shot';
  if (self.slayerUsed) return 'Slayer shot already used';
  return null;
}
