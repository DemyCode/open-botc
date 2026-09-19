// Everything that ends a player's life goes through here, so every character's hooks (protection,
// reactions, replacements) fire the same way whatever killed the player.
import { CHARACTERS } from './characters.js';
import { record } from './history.js';
import { abilityLostReason, abilityWorks } from './registration.js';
import { evaluateWin } from './win.js';
import type { GameState, Msg, PlayerState } from './types.js';

export type DeathCause = string; // 'demon' | 'execution' | 'virgin' | 'slayer' | 'mayorBounce' | 'starPass' | ...

export const isExecution = (cause: DeathCause): boolean => cause === 'execution' || cause === 'virgin';

/** The hooks of a character (never undefined). */
export function hooksOf(charId: string) {
  return CHARACTERS[charId]?.hooks ?? {};
}

/** Every player, with the hooks of their TRUE character. */
function owners(state: GameState): { p: PlayerState; hooks: ReturnType<typeof hooksOf> }[] {
  return state.players.map((p) => ({ p, hooks: hooksOf(p.character) }));
}

/** Which character's ability stops `victim` dying now (a character id), or null. Only living owners protect. */
export function protectionFor(state: GameState, victim: PlayerState, cause: DeathCause): string | null {
  for (const { p, hooks } of owners(state)) {
    if (!p.alive) continue;
    const by = hooks.protects?.(state, p, victim, cause);
    if (by) return by;
  }
  return null;
}

/** If an ability turns this Demon kill onto someone else (the Mayor), who. */
export function redirectFor(state: GameState, victim: PlayerState, killer: PlayerState): { by: string; to: PlayerState } | null {
  for (const { p, hooks } of owners(state)) {
    if (p.id !== victim.id) continue;
    const to = hooks.redirectsKill?.(state, p, victim, killer);
    if (to) return { by: p.character, to };
  }
  return null;
}

/** Records a death in the replay. */
export function recordDeath(state: GameState, p: PlayerState, cause: DeathCause): void {
  record(state, 'death', { player: p.id, cause });
}

const isDemonChar = (p: PlayerState): boolean => CHARACTERS[p.character]?.team === 'demon';

/**
 * Marks `target` dead and lets every character react. Does NOT check protection (callers do, since
 * they narrate why it was blocked) and does NOT evaluate the win (callers do, once everything that
 * tonight/today's action changes has been applied).
 */
export function markDead(state: GameState, target: PlayerState, cause: DeathCause): void {
  target.alive = false;
  noteDeath(state, target, cause);
  recordDeath(state, target, cause);
  hooksOf(target.character).onDeath?.(state, target, cause);
  for (const { p, hooks } of owners(state)) {
    if (p.alive && p.id !== target.id) hooks.onAnyDeath?.(state, p, target, cause);
  }
  hooksOf(target.character).afterDeath?.(state, target, cause);
}

/** What the table (and later abilities) can tell about a death: tonight's, or today's. */
function noteDeath(state: GameState, target: PlayerState, cause: DeathCause): void {
  if (state.phase === 'night') {
    target.diedTonight = true;
    state.deathsTonight.push(target.id);
  } else if (state.phase === 'day') {
    (state.data.diedToday ??= []).push(target.id);
  }
  if (isDemonChar(target)) state.data.demonDeathCause = cause;
  // Per-player cause, for abilities that care how someone died (the Sage: killed by the Demon).
  ((state.data.deathCause ??= {}) as Record<string, string>)[target.id] = cause;
}

export interface KillResult {
  died: boolean;
  /** What stopped it (a character id, or 'alreadyDead'). */
  by?: string;
  /** The victim now counts as dead although they live on (the Zombuul's first death). */
  appearsDead?: boolean;
}

/**
 * An ability or the village tries to kill `target`: protections get their say (`bypass`: the
 * Assassin's kill ignores them). A player who "registers as dead" but lives (the Zombuul) really
 * dies when killed again.
 */
export function tryKill(state: GameState, target: PlayerState, cause: DeathCause, opts: { bypass?: boolean; beforeDeath?: () => void } = {}): KillResult {
  if (!target.alive) {
    if (target.flags.hiddenAlive) {
      target.flags.hiddenAlive = false;
      recordDeath(state, target, cause);
      if (isDemonChar(target)) state.data.demonDeathCause = cause;
      return { died: true };
    }
    return { died: false, by: 'alreadyDead' };
  }
  if (!opts.bypass) {
    const by = protectionFor(state, target, cause);
    if (by) return { died: false, by };
    for (const { p, hooks } of owners(state)) {
      if (!p.alive) continue;
      const r = hooks.lastResort?.(state, p, target, cause);
      if (!r) continue;
      if (typeof r === 'string') return { died: false, by: r };
      opts.beforeDeath?.();
      target.alive = false;
      target.flags.hiddenAlive = true;
      noteDeath(state, target, cause);
      recordDeath(state, target, cause);
      return { died: false, by: r.by, appearsDead: true };
    }
  }
  opts.beforeDeath?.();
  markDead(state, target, cause);
  return { died: true };
}

/**
 * A kill by an ability that is not the Demon's attack (Godfather, Gossip, Moonchild, Assassin...):
 * told in the replay like an attack, with every way it can fail. `bypass`: nothing can stop it.
 */
export function abilityKill(state: GameState, actor: PlayerState, target: PlayerState, cause: DeathCause, opts: { bypass?: boolean } = {}): KillResult {
  if (state.winner) return { died: false };
  if (!target.alive && !target.flags.hiddenAlive) {
    record(state, 'attack', { actor: actor.id, target: target.id, outcome: 'alreadyDead', cause });
    return { died: false, by: 'alreadyDead' };
  }
  let told = false;
  const result = tryKill(state, target, cause, {
    ...opts,
    beforeDeath: () => { told = true; record(state, 'attack', { actor: actor.id, target: target.id, outcome: 'killed', cause }); },
  });
  if (!told) record(state, 'attack', { actor: actor.id, target: target.id, outcome: 'blocked', by: result.by ?? '', cause });
  evaluateWin(state);
  return result;
}

/** Tells a chosen player's own ability that `chooser` just chose them at night (the Goon). */
export function notifyChosen(state: GameState, chooser: PlayerState, chosenId: string, step: string): void {
  const chosen = state.players.find((p) => p.id === chosenId);
  if (chosen) hooksOf(chosen.character).onChosen?.(state, chosen, chooser, step);
}

export function msg(key: string, vars?: Record<string, string | number | string[]>): Msg {
  return vars ? { key, vars } : { key };
}

/**
 * A Demon's attack on `targetId`, with every way it can fail or be turned aside: an already dead
 * target, a Demon whose ability doesn't work, a protection (Soldier, Monk...), a redirect (Mayor),
 * and — for the Imp — killing themself. Every outcome goes in the replay.
 */
export function demonAttack(state: GameState, demon: PlayerState, targetId: string, opts: { starPass?: boolean } = {}): void {
  if (state.winner) return;
  const target = state.players.find((p) => p.id === targetId);
  if (!target) return;
  if (!target.alive && !target.flags.hiddenAlive) {
    record(state, 'attack', { actor: demon.id, target: target.id, outcome: 'alreadyDead' });
    return;
  }
  if (!abilityWorks(state, demon)) {
    // a poisoned Demon's kill (or star-pass) simply doesn't happen
    record(state, 'attack', { actor: demon.id, target: target.id, outcome: 'ineffective', lost: abilityLostReason(state, demon) });
    return;
  }
  const by = protectionFor(state, target, 'demon');
  if (by) {
    record(state, 'attack', { actor: demon.id, target: target.id, outcome: 'blocked', by });
    return;
  }
  if (target.id === demon.id && opts.starPass) {
    record(state, 'attack', { actor: demon.id, target: target.id, outcome: 'starPass' });
    markDead(state, target, 'starPass');
    evaluateWin(state);
    return;
  }
  const redirect = redirectFor(state, target, demon);
  if (redirect) {
    const victim = redirect.to;
    record(state, 'attack', { actor: demon.id, target: target.id, outcome: redirect.by === 'mayor' ? 'mayorBounce' : 'redirected', victim: victim.id });
    markDead(state, victim, victim.id === target.id ? 'demon' : redirect.by === 'mayor' ? 'mayorBounce' : 'redirected');
    evaluateWin(state);
    return;
  }
  let told = false;
  const result = tryKill(state, target, 'demon', {
    // The attack is told before the death it causes.
    beforeDeath: () => { told = true; record(state, 'attack', { actor: demon.id, target: target.id, outcome: 'killed' }); },
  });
  if (!told) record(state, 'attack', { actor: demon.id, target: target.id, outcome: 'blocked', by: result.by ?? '' });
  evaluateWin(state);
}

/**
 * The village executes someone. Executing a dead player still counts as today's one execution, but
 * "a dead player cannot die again": nothing that triggers on a death happens a second time. An
 * execution can also fail to kill (the Devil's Advocate, the Fool...): then it still counts.
 */
export function executePlayer(state: GameState, targetId: string, cause: DeathCause = 'execution'): void {
  const p = state.players.find((pl) => pl.id === targetId);
  if (!p) return;
  state.lastExecutedId = targetId;
  state.data.executionSurvived = false;
  state.publicLog.push(msg('wasExecuted', { name: p.name }));
  record(state, 'execution', { player: p.id, wasDead: !p.alive, cause });
  if (!p.alive && !p.flags.hiddenAlive) return;
  const r = tryKill(state, p, cause);
  if (!r.died && !r.appearsDead) {
    state.data.executionSurvived = true;
    record(state, 'survived', { player: p.id, cause, by: r.by ?? '' });
  }
  evaluateWin(state);
}
