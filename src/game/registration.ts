import { CHARACTERS, isEvilTeam } from './characters.js';
import { stableFloat, stablePick } from './rng.js';
import type { CharacterId, GameState, PlayerState } from './types.js';

/** True if this player's own ability actually functions right now (false for the Drunk, or a poisoned player). */
export function abilityWorks(state: GameState, p: PlayerState): boolean {
  if (p.character === 'drunk') return false;
  if (state.poisonedId === p.id && poisonerAlive(state)) return false;
  return true;
}

/** Poison lasts only while the Poisoner lives — it ends the moment they die (or stop being the Poisoner). */
function poisonerAlive(state: GameState): boolean {
  return state.players.some((q) => q.alive && q.character === 'poisoner');
}

export type RegisterKind = 'demon' | 'minion' | 'outsider' | 'townsfolk' | 'evil' | 'good';

/**
 * Whether `target` registers as `kind` to a given asker/question. This is the single place
 * Recluse (may misregister evil/minion/demon) and Spy (may misregister good/townsfolk/outsider)
 * are handled — every informational ability calls through here instead of special-casing them.
 * The roll is seeded per (night, asker, slot, target, kind) so repeat questions about the same
 * target on the same night are independently rolled, not cached as one verdict per player.
 */
export function registersAs(
  state: GameState,
  target: PlayerState,
  kind: RegisterKind,
  ctx: { asker: string; slot: string }
): boolean {
  const team = CHARACTERS[target.character].team;
  const trueEvil = isEvilTeam(team);
  const trueKind = kind === 'evil' ? trueEvil
    : kind === 'good' ? !trueEvil
    : team === kind;

  const roll = () => stableFloat(state.secret, 'reg', state.night, ctx.asker, ctx.slot, target.id, kind) < 0.5;

  if (target.character === 'recluse' && !trueEvil && (kind === 'evil' || kind === 'minion' || kind === 'demon')) {
    return roll();
  }
  if (target.character === 'spy' && trueEvil && (kind === 'good' || kind === 'townsfolk' || kind === 'outsider')) {
    return roll();
  }
  return trueKind;
}

/**
 * The specific character name shown to Washerwoman/Librarian/Investigator/Undertaker/Ravenkeeper
 * for a target, preferring an in-play character of the right team so a misregistering
 * Recluse/Spy produces a checkable (and painful) lie rather than a random impossible name.
 */
export function apparentCharacter(
  state: GameState,
  target: PlayerState,
  wantTeam: 'townsfolk' | 'outsider' | 'minion' | 'demon',
  ctx: { asker: string; slot: string }
): CharacterId {
  const team = CHARACTERS[target.character].team;
  if (team === wantTeam) return target.character;

  if (target.character === 'recluse' && (wantTeam === 'minion' || wantTeam === 'demon')) {
    if (registersAs(state, target, wantTeam === 'demon' ? 'demon' : 'minion', ctx)) {
      const inPlay = state.players.filter((p) => CHARACTERS[p.character].team === wantTeam).map((p) => p.character);
      if (inPlay.length) return stablePick(state.secret, inPlay, 'appear', ctx.slot, target.id);
      const all = Object.values(CHARACTERS).filter((c) => c.team === wantTeam).map((c) => c.id);
      return stablePick(state.secret, all, 'appear', ctx.slot, target.id);
    }
  }
  if (target.character === 'spy' && (wantTeam === 'townsfolk' || wantTeam === 'outsider')) {
    if (registersAs(state, target, wantTeam, ctx)) {
      const inPlay = state.players.filter((p) => CHARACTERS[p.character].team === wantTeam).map((p) => p.character);
      if (inPlay.length) return stablePick(state.secret, inPlay, 'appear', ctx.slot, target.id);
      const all = Object.values(CHARACTERS).filter((c) => c.team === wantTeam).map((c) => c.id);
      return stablePick(state.secret, all, 'appear', ctx.slot, target.id);
    }
  }
  return target.character;
}
