import { CHARACTERS, charsOfTeam, type CharacterId, type Team } from './characters.js';
import { stableFloat } from './rng.js';
import type { Alignment, GameState, PlayerState } from './types.js';

/**
 * Which question is being asked of a player. Misregistration is decided per
 * question kind, the way a storyteller decides "does the Recluse look like the
 * Demon to the Fortune Teller tonight?" separately from "does the Recluse look
 * like a Minion to the Investigator?".
 */
export type RegKind = 'demon' | 'minion' | 'outsider' | 'townsfolk' | 'evil' | 'good';

/** Identifies the asking of a question, so repeat asks are stable. */
export interface RegCtx {
  /** Who is asking (a player id, or a synthetic id like 'chef-pairs'). */
  asker: string;
  /** Night number the question is asked on. */
  night: number;
  /** Distinguishes multiple asks by the same asker on the same night. */
  slot?: string | number;
}

function roll(s: GameState, target: PlayerState, kind: RegKind, ctx: RegCtx): number {
  return stableFloat(
    s.secret,
    'reg',
    ctx.night,
    ctx.asker,
    ctx.slot ?? '',
    target.id,
    kind,
  );
}

/**
 * The character a player's *token* effectively is for other players' abilities.
 * Only the Drunk differs, and only when the room opted into the softer rule.
 */
export function tokenCharacter(s: GameState, p: PlayerState): CharacterId {
  if (p.character === 'drunk' && s.options.drunkShowsAsFake && p.perceived) {
    return p.perceived;
  }
  return p.character!;
}

export function tokenTeam(s: GameState, p: PlayerState): Team {
  return CHARACTERS[tokenCharacter(s, p)].team;
}

/**
 * Does `target` register as `kind` to this observer, right now?
 *
 * Handles the Recluse (might look evil / Minion / Demon) and the Spy (might
 * look good / Townsfolk / Outsider). Both work even while dead.
 */
export function registersAs(
  s: GameState,
  target: PlayerState,
  kind: RegKind,
  ctx: RegCtx,
): boolean {
  const c = tokenCharacter(s, target);
  const team = CHARACTERS[c].team;
  const truly = matchesKind(team, kind);

  if (c === 'recluse') {
    // The Recluse only ever misregisters *upwards* into evil.
    const wantsEvil =
      kind === 'evil' || kind === 'minion' || kind === 'demon';
    const wantsGood = kind === 'good' || kind === 'outsider' || kind === 'townsfolk';
    const misregister = roll(s, target, kind, ctx) < s.options.recluseMisregisterChance;
    if (wantsEvil) return misregister;
    if (wantsGood) return truly && !misregister;
    return truly;
  }

  if (c === 'spy') {
    // The Spy only ever misregisters *downwards* into good.
    const wantsGood = kind === 'good' || kind === 'outsider' || kind === 'townsfolk';
    const wantsEvil = kind === 'evil' || kind === 'minion' || kind === 'demon';
    const misregister = roll(s, target, kind, ctx) < s.options.spyMisregisterChance;
    if (wantsGood) return misregister;
    if (wantsEvil) return truly && !misregister;
    return truly;
  }

  return truly;
}

function matchesKind(team: Team, kind: RegKind): boolean {
  switch (kind) {
    case 'demon':
      return team === 'demon';
    case 'minion':
      return team === 'minion';
    case 'outsider':
      return team === 'outsider';
    case 'townsfolk':
      return team === 'townsfolk';
    case 'evil':
      return team === 'minion' || team === 'demon';
    case 'good':
      return team === 'townsfolk' || team === 'outsider';
  }
}

/**
 * The character an observer sees when an ability names a character
 * (Undertaker, Ravenkeeper, Washerwoman, Librarian, Investigator).
 *
 * A misregistering Recluse/Spy is shown a plausible character of the team they
 * are pretending to be, preferring one that is genuinely in play.
 */
export function apparentCharacter(
  s: GameState,
  target: PlayerState,
  ctx: RegCtx,
): CharacterId {
  const c = tokenCharacter(s, target);

  if (c === 'recluse') {
    if (registersAs(s, target, 'demon', { ...ctx, slot: `${ctx.slot ?? ''}:as` })) {
      return preferInPlay(s, charsOfTeam('demon'), target, ctx, 'demon');
    }
    if (registersAs(s, target, 'minion', { ...ctx, slot: `${ctx.slot ?? ''}:as` })) {
      return preferInPlay(s, charsOfTeam('minion'), target, ctx, 'minion');
    }
    return 'recluse';
  }

  if (c === 'spy') {
    if (registersAs(s, target, 'townsfolk', { ...ctx, slot: `${ctx.slot ?? ''}:as` })) {
      return preferInPlay(s, charsOfTeam('townsfolk'), target, ctx, 'townsfolk');
    }
    if (registersAs(s, target, 'outsider', { ...ctx, slot: `${ctx.slot ?? ''}:as` })) {
      return preferInPlay(s, charsOfTeam('outsider'), target, ctx, 'outsider');
    }
    return 'spy';
  }

  return c;
}

function preferInPlay(
  s: GameState,
  pool: CharacterId[],
  target: PlayerState,
  ctx: RegCtx,
  kind: string,
): CharacterId {
  const banned = new Set(s.options.banned);
  const usable = pool.filter((c) => !banned.has(c) && c !== target.character);
  if (usable.length === 0) return pool[0];
  const inPlay = charactersInPlay(s);
  const preferred = usable.filter((c) => inPlay.has(c));
  const candidates = preferred.length > 0 ? preferred : usable;
  const idx = Math.floor(
    stableFloat(s.secret, 'apparent', ctx.night, ctx.asker, target.id, kind) *
      candidates.length,
  );
  return candidates[Math.min(idx, candidates.length - 1)];
}

export function charactersInPlay(s: GameState): Set<CharacterId> {
  const set = new Set<CharacterId>();
  for (const p of s.players) if (p.character) set.add(p.character);
  return set;
}

/** True alignment, ignoring any misregistration. */
export function trueAlignment(p: PlayerState): Alignment {
  return p.alignment;
}

/**
 * Is this player's ability functioning? Drunk and poisoned players get false
 * information and their actions have no effect.
 */
export function abilityWorks(p: PlayerState): boolean {
  return !p.poisoned && p.character !== 'drunk';
}

/** Ability functioning *and* the player is alive. */
export function abilityWorksAlive(p: PlayerState): boolean {
  return p.alive && abilityWorks(p);
}
