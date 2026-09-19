import { CHARACTERS, isEvilTeam } from './characters.js';
import { hooksOf } from './deaths.js';
import { stableFloat, stablePick } from './rng.js';
import type { CharacterId, GameState, PlayerState } from './types.js';

/** True if this player's own ability actually functions right now (false if drunk or poisoned, or if it never does). */
export function abilityWorks(state: GameState, p: PlayerState): boolean {
  return abilityLostReason(state, p) === null;
}

/** Poison lasts only while the Poisoner lives — it ends the moment they die (or stop being the Poisoner). */
function poisonerAlive(state: GameState): boolean {
  return state.players.some((q) => q.alive && q.character === 'poisoner');
}

/** Why a player's ability is not working right now, if it isn't (used to explain false information in the replay). */
export function abilityLostReason(state: GameState, p: PlayerState, depth = 0): 'drunk' | 'poisoned' | 'lunatic' | null {
  const noAbility = hooksOf(p.character).noAbility;
  if (noAbility) return noAbility;
  if (state.poisonedId === p.id && poisonerAlive(state)) return 'poisoned';
  for (const e of state.effects) {
    if (e.target !== p.id) continue;
    if (e.needsSourceAlive && !state.players.some((q) => q.id === e.source && q.alive)) continue;
    if (e.needsTargetChar && p.character !== e.needsTargetChar) continue;
    if (e.needsSourceWorking) {
      const src = state.players.find((q) => q.id === e.source);
      if (!src || depth > 3 || abilityLostReason(state, src, depth + 1) !== null) continue;
    }
    return e.kind;
  }
  return null;
}

/**
 * Records that `p`'s ability failed to work this day/night because ANOTHER ability made them drunk
 * or poisoned — what the Mathematician counts. A character with `noAbility` (the Drunk, the Lunatic)
 * is skipped: their ability never worked in the first place, so nothing "went abnormally".
 */
export function noteMalfunction(state: GameState, p: PlayerState): void {
  if (hooksOf(p.character).noAbility) return;
  const reason = abilityLostReason(state, p);
  if (reason !== 'drunk' && reason !== 'poisoned') return;
  ((state.data.malfunctions ??= {}) as Record<string, true>)[p.id] = true;
}

/** How many players' abilities worked abnormally since the last dawn (the Mathematician's number). */
export function malfunctionCount(state: GameState): number {
  return Object.keys((state.data.malfunctions as Record<string, true> | undefined) ?? {}).length;
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
  // Alignment, not team: a Goon may have turned evil.
  const trueEvil = target.alignment === 'evil';
  const trueKind = kind === 'evil' ? trueEvil
    : kind === 'good' ? !trueEvil
    : team === kind;

  const roll = () => stableFloat(state.secret, 'reg', state.night, ctx.asker, ctx.slot, target.id, kind) < 0.5;

  const mis = hooksOf(target.character).misregister;
  if (mis && (mis.from === 'evil') === trueEvil) {
    if (mis.kinds.includes(kind)) return roll();
    // Asked the other way round ("is this player EVIL?" — the Chef's and the Empath's question),
    // a Spy sometimes answers no (wiki: Spy ex. 2).
    if (mis.invertedKinds?.includes(kind)) return !roll();
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

  const mis = hooksOf(target.character).misregister;
  if (mis && (mis.from === 'evil') === isEvilTeam(team) && mis.kinds.includes(wantTeam) && registersAs(state, target, wantTeam, ctx)) {
    const inPlay = state.players.filter((p) => CHARACTERS[p.character].team === wantTeam).map((p) => p.character);
    if (inPlay.length) return stablePick(state.secret, inPlay, 'appear', ctx.slot, target.id);
    const all = Object.values(CHARACTERS).filter((c) => c.team === wantTeam).map((c) => c.id);
    return stablePick(state.secret, all, 'appear', ctx.slot, target.id);
  }
  return target.character;
}
