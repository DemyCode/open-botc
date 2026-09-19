import { CHARACTERS } from './characters.js';
import { hooksOf } from './deaths.js';
import { msg } from './messages.js';
import { abilityLostReason, abilityWorks, apparentCharacter, registersAs, scriptCharacters, type RegisterKind } from './registration.js';
import { stableFloat, stablePick } from './rng.js';
import type { GameState, Msg, PlayerState, Team } from './types.js';

/**
 * True when this player's information is false for a reason other than being drunk/poisoned: a
 * living Vortox makes every Townsfolk ability yield false info. All information abilities consult
 * this alongside `abilityWorks`, so the Vortox needs no special-casing per character.
 */
export function infoIsFalse(state: GameState, self: PlayerState): boolean {
  if (CHARACTERS[self.character].team !== 'townsfolk') return false;
  // (A drunk or poisoned Vortox has no ability, so it falsifies nothing.)
  return state.players.some((p) => p.alive && hooksOf(p.character).falsifiesTownsfolkInfo && abilityWorks(state, p));
}

/**
 * Under a Vortox, information must be FALSE — not merely random like a drunk's, which may happen to
 * be right. Picks a wrong value among `candidates` (the plausible answers); `fallback` if every one is right.
 */
export function wrongAnswer<T>(state: GameState, self: PlayerState, truth: T, candidates: T[], fallback: T, slot: string): T {
  const wrong = candidates.filter((c) => c !== truth);
  return wrong.length ? stablePick(state.secret, wrong, slot, self.id, 'vortox') : fallback;
}

/** 0, 1, ..., n. */
export const upTo = (n: number): number[] => Array.from({ length: Math.max(0, n) + 1 }, (_, i) => i);

/** Whether an information ability should be treated as malfunctioning (drunk, poisoned, or a Vortox). */
export function infoUnreliable(state: GameState, self: PlayerState): boolean {
  return !abilityWorks(state, self) || infoIsFalse(state, self);
}

function others(state: GameState, self: PlayerState): PlayerState[] {
  return state.players.filter((p) => p.alive && p.id !== self.id);
}

function pickPair(state: GameState, pool: PlayerState[], slot: string, self: string, tag: string): [PlayerState, PlayerState] {
  const a = stablePick(state.secret, pool, slot, self, tag, 'a');
  const rest = pool.filter((p) => p.id !== a.id);
  const b = rest.length ? stablePick(state.secret, rest, slot, self, tag, 'b') : a;
  return stableFloat(state.secret, slot, self, tag, 'order') < 0.5 ? [a, b] : [b, a];
}

/** Shared shape behind Washerwoman/Librarian/Investigator: "A or B is the <character>." */
export function investigativeInfo(state: GameState, self: PlayerState, team: Exclude<Team, 'demon'>, slot: string): Msg {
  const pool = others(state, self);
  const ctx = { asker: self.id, slot };
  if (!infoUnreliable(state, self)) {
    // Who can be "the" Townsfolk/Outsider/Minion is decided by how each player REGISTERS, not just
    // by what they are: a Spy may register as a Townsfolk or Outsider, and a Recluse as a Minion
    // (wiki: Washerwoman ex. 3, Investigator ex. 3, Spy ex. 1, Recluse ex. 3).
    const candidates = pool.filter((p) => registersAs(state, p, team, ctx));
    if (!candidates.length) {
      const [a, b] = pickPair(state, pool, slot, self.id, 'none');
      return msg('noTeamInPlay', { a: a.name, b: b.name, team });
    }
    const real = stablePick(state.secret, candidates, slot, self.id, 'target');
    const decoyPool = pool.filter((p) => p.id !== real.id);
    const decoy = decoyPool.length ? stablePick(state.secret, decoyPool, slot, self.id, 'decoy') : real;
    const role = apparentCharacter(state, real, team, ctx);
    const pair = stableFloat(state.secret, slot, self.id, 'order') < 0.5 ? [real, decoy] : [decoy, real];
    return msg('investigativeInfo', { a: pair[0].name, b: pair[1].name, role });
  }
  const [a, b] = pickPair(state, pool, slot, self.id, 'fake');
  const roles = scriptCharacters(state, team);
  // Under a Vortox the pair must be wrong: neither player is the character named.
  const falseRoles = roles.filter((c) => c !== a.character && c !== b.character);
  const fake = stablePick(state.secret, infoIsFalse(state, self) && falseRoles.length ? falseRoles : roles, slot, self.id, 'fake-char');
  return msg('investigativeInfo', { a: a.name, b: b.name, role: fake });
}

/** The most pairs of evil neighbours the table could hold: the evil players sitting in one block (all of them in a circle if everyone is evil). */
function maxEvilPairs(state: GameState): number {
  const evil = state.players.filter((p) => p.alignment === 'evil').length;
  return evil >= state.players.length ? evil : Math.max(0, evil - 1);
}

export function chefInfo(state: GameState, self: PlayerState, slot: string): Msg {
  const seated = state.players.slice().sort((a, b) => a.seat - b.seat);
  let count = 0;
  for (let i = 0; i < seated.length; i++) {
    const p1 = seated[i];
    const p2 = seated[(i + 1) % seated.length];
    // Each pair is its own question: a Recluse between the Imp and the Poisoner may register as
    // evil next to the Imp but as good next to the Poisoner (wiki: Chef ex. 4).
    const ctx = { asker: self.id, slot: `${slot}-pair${i}` };
    if (registersAs(state, p1, 'evil', ctx) && registersAs(state, p2, 'evil', ctx)) count++;
  }
  if (infoIsFalse(state, self)) count = wrongAnswer(state, self, count, upTo(maxEvilPairs(state)), count + 1, slot);
  else if (infoUnreliable(state, self)) {
    count = Math.floor(stableFloat(state.secret, slot, self.id, 'fake') * (maxEvilPairs(state) + 1));
  }
  return msg('chefInfo', { count });
}

/** The nearest living player on each side of `self` (self excluded), optionally matching a predicate. */
export function nearestLiving(state: GameState, self: PlayerState, predicate?: (p: PlayerState) => boolean): PlayerState[] {
  const seated = state.players.slice().sort((a, b) => a.seat - b.seat);
  const idx = seated.findIndex((p) => p.id === self.id);
  const find = (step: number): PlayerState | undefined => {
    let i = idx;
    for (let n = 0; n < seated.length; n++) {
      i = (i + step + seated.length) % seated.length;
      if (seated[i].alive && seated[i].id !== self.id && (!predicate || predicate(seated[i]))) return seated[i];
    }
    return undefined;
  };
  return [find(-1), find(1)].filter((p): p is PlayerState => p !== undefined);
}

export function livingNeighbors(state: GameState, self: PlayerState): [PlayerState, PlayerState] {
  const me = state.players.find((p) => p.id === self.id)!;
  const [left, right] = nearestLiving(state, self);
  return [left ?? me, right ?? me]; // self is the fallback when nobody living sits on that side
}

export function empathInfo(state: GameState, self: PlayerState, slot: string): Msg {
  const ctx = { asker: self.id, slot };
  const [left, right] = livingNeighbors(state, self);
  let count = [left, right].filter((p) => registersAs(state, p, 'evil', ctx)).length;
  const neighbours = new Set([left.id, right.id].filter((id) => id !== self.id)).size;
  if (infoIsFalse(state, self)) count = wrongAnswer(state, self, count, upTo(neighbours), count + 1, slot);
  else if (infoUnreliable(state, self)) {
    count = Math.floor(stableFloat(state.secret, slot, self.id, 'fake') * (neighbours + 1));
  }
  return msg('empathInfo', { count });
}

export function fortuneTellerInfo(state: GameState, self: PlayerState, targetIds: string[], slot: string): Msg {
  const ctx = { asker: self.id, slot };
  const targets = state.players.filter((p) => targetIds.includes(p.id));
  const real = targets.some((t) => t.isRedHerring || registersAs(state, t, 'demon', ctx));
  const answer = infoIsFalse(state, self) ? !real : infoUnreliable(state, self) ? stableFloat(state.secret, slot, self.id, 'fake') < 0.5 : real;
  return msg(answer ? 'fortuneTellerYes' : 'fortuneTellerNo');
}

function apparentToObserver(state: GameState, target: PlayerState, ctx: { asker: string; slot: string }) {
  const mis = hooksOf(target.character).misregister;
  if (mis?.from === 'good' && registersAs(state, target, 'evil', ctx)) {
    return apparentCharacter(state, target, stableFloat(state.secret, ctx.slot, 'demon-or-minion', target.id) < 0.3 ? 'demon' : 'minion', ctx);
  }
  if (mis?.from === 'evil' && registersAs(state, target, 'good', ctx)) {
    return apparentCharacter(state, target, stableFloat(state.secret, ctx.slot, 'town-or-outsider', target.id) < 0.8 ? 'townsfolk' : 'outsider', ctx);
  }
  return target.character;
}

/** Only ever asked on a night after an execution: with none, the Undertaker is not woken at all. */
export function undertakerInfo(state: GameState, self: PlayerState, executed: PlayerState | null, slot: string): Msg {
  if (!executed) return msg('empty');
  return msg('undertakerInfo', { name: executed.name, role: characterSeen(state, self, executed, slot) });
}

export function ravenkeeperInfo(state: GameState, self: PlayerState, targetId: string, slot: string): Msg {
  const target = state.players.find((p) => p.id === targetId)!;
  return msg('ravenkeeperInfo', { name: target.name, role: characterSeen(state, self, target, slot) });
}

/** The character an Undertaker/Ravenkeeper is shown for `target`: how they register; any when drunk; never the true one under a Vortox. */
function characterSeen(state: GameState, self: PlayerState, target: PlayerState, slot: string): string {
  if (infoIsFalse(state, self)) return wrongAnswer(state, self, target.character, scriptCharacters(state), target.character, slot);
  if (infoUnreliable(state, self)) return stablePick(state.secret, scriptCharacters(state), slot, self.id, 'fake');
  return apparentToObserver(state, target, { asker: self.id, slot });
}

export function minionInfo(state: GameState, self: PlayerState): Msg {
  const demon = state.players.find((p) => CHARACTERS[p.character].team === 'demon');
  const fellow = state.players.filter((p) => CHARACTERS[p.character].team === 'minion' && p.id !== self.id);
  const demonName = demon ? demon.name : '';
  if (fellow.length === 0) return msg('minionInfoSolo', { demon: demonName });
  return msg('minionInfoGroup', { names: fellow.map((p) => p.name), demon: demonName });
}

export function demonInfo(state: GameState, self: PlayerState): Msg {
  if (self.character === 'lunatic') {
    // The Lunatic is shown made-up Minions (any players) and three good characters (even ones in play).
    const minionCount = state.players.filter((p) => CHARACTERS[p.character].team === 'minion').length;
    const pool = state.players.filter((p) => p.id !== self.id);
    const fakeMinions: PlayerState[] = [];
    for (let i = 0; i < minionCount && pool.length; i++) {
      const pick = stablePick(state.secret, pool, 'lunatic-minion', self.id, i);
      pool.splice(pool.indexOf(pick), 1);
      fakeMinions.push(pick);
    }
    const good = state.scriptChars.filter((c) => CHARACTERS[c].team === 'townsfolk' || CHARACTERS[c].team === 'outsider');
    const bluffs: string[] = [];
    for (let i = 0; i < 3 && good.length; i++) {
      const pick = stablePick(state.secret, good, 'lunatic-bluff', self.id, i);
      good.splice(good.indexOf(pick), 1);
      bluffs.push(pick);
    }
    return msg('demonInfo', { names: fakeMinions.map((p) => p.name), bluffs });
  }
  const minions = state.players.filter((p) => CHARACTERS[p.character].team === 'minion');
  const lunatic = state.players.find((p) => p.character === 'lunatic');
  return msg('demonInfo', { names: minions.map((p) => p.name), bluffs: state.bluffs, ...(lunatic ? { lunatic: lunatic.name } : {}) });
}

/**
 * The Storyteller's reminder tokens on a player, which the Spy sees along with the characters:
 * "you will not only see who everyone is, but the Storyteller reminder tokens ... who is a Drunk, who
 * your Poisoner targeted, who the Fortune Teller red herring is, who the Demon killed".
 */
function grimoireMarks(state: GameState, p: PlayerState): string {
  const marks: string[] = [];
  const lost = abilityLostReason(state, p);
  if (lost === 'poisoned') marks.push('poisoned');
  if (lost === 'drunk') marks.push('drunk');
  if (p.isRedHerring) marks.push('redHerring');
  if (state.data.monkProtectedId === p.id) marks.push('protected');
  if (state.data.butlerMasterId === p.id) marks.push('butlerMaster');
  return marks.join(',');
}

export function spyInfo(state: GameState, self: PlayerState, slot: string): Msg {
  const names = state.players.map((p) => p.name);
  const dead = state.players.map((p) => (p.alive ? '' : '1'));
  if (abilityWorks(state, self)) {
    return msg('spyGrimoire', {
      names,
      roles: state.players.map((p) => p.character),
      dead,
      marks: state.players.map((p) => grimoireMarks(state, p)),
    });
  }
  // A drunk or poisoned Spy is shown a full but false grimoire — reminder tokens included, or their
  // absence alone would tell them their own ability is not working.
  const fakeRoles = state.players.map((_, i) => stablePick(state.secret, scriptCharacters(state), slot, self.id, 'fake', i));
  const fakeMarks = state.players.map((p, i) => {
    const roll = stableFloat(state.secret, slot, self.id, 'fake-mark', i);
    return roll < 0.12 ? 'poisoned' : roll < 0.22 ? 'redHerring' : roll < 0.3 ? 'protected' : '';
  });
  return msg('spyGrimoire', { names, roles: fakeRoles, dead, marks: fakeMarks });
}

export type { RegisterKind };
