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

/** Which character's ability stops `victim` dying now (a character id), or null. */
export function protectionFor(state: GameState, victim: PlayerState, cause: DeathCause): string | null {
  for (const { p, hooks } of owners(state)) {
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

/**
 * Marks `target` dead and lets every character react. Does NOT check protection (callers do, since
 * they narrate why it was blocked) and does NOT evaluate the win (callers do, once everything that
 * tonight/today's action changes has been applied).
 */
export function markDead(state: GameState, target: PlayerState, cause: DeathCause): void {
  target.alive = false;
  if (state.phase === 'night') {
    target.diedTonight = true;
    state.deathsTonight.push(target.id);
  }
  recordDeath(state, target, cause);
  hooksOf(target.character).onDeath?.(state, target, cause);
  for (const { p, hooks } of owners(state)) {
    if (p.alive && p.id !== target.id) hooks.onAnyDeath?.(state, p, target, cause);
  }
  hooksOf(target.character).afterDeath?.(state, target, cause);
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
  const target = state.players.find((p) => p.id === targetId);
  if (!target) return;
  if (!target.alive) {
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
  record(state, 'attack', { actor: demon.id, target: target.id, outcome: 'killed' });
  markDead(state, target, 'demon');
  evaluateWin(state);
}

/**
 * The village executes someone. Executing a dead player still counts as today's one execution, but
 * "a dead player cannot die again": nothing that triggers on a death happens a second time.
 */
export function executePlayer(state: GameState, targetId: string, cause: 'execution' | 'virgin' = 'execution'): void {
  const p = state.players.find((pl) => pl.id === targetId);
  if (!p) return;
  state.lastExecutedId = targetId;
  state.publicLog.push(msg('wasExecuted', { name: p.name }));
  record(state, 'execution', { player: p.id, wasDead: !p.alive, cause });
  if (!p.alive) return;
  markDead(state, p, cause);
  evaluateWin(state);
}
