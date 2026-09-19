import { CHARACTERS } from './characters.js';
import { hooksOf } from './deaths.js';
import { abilityWorks, apparentCharacter, registersAs, type RegisterKind } from './registration.js';
import { stableFloat, stablePick } from './rng.js';
import type { GameState, Msg, PlayerState, Team } from './types.js';

function msg(key: string, vars?: Record<string, string | number | string[]>): Msg {
  return vars ? { key, vars } : { key };
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
  if (abilityWorks(state, self)) {
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
  const teamChars = Object.values(CHARACTERS).filter((c) => c.team === team);
  const fake = stablePick(state.secret, teamChars, slot, self.id, 'fake-char');
  return msg('investigativeInfo', { a: a.name, b: b.name, role: fake.id });
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
  if (!abilityWorks(state, self)) {
    count = Math.floor(stableFloat(state.secret, slot, self.id, 'fake') * 3);
  }
  return msg('chefInfo', { count });
}

export function livingNeighbors(state: GameState, self: PlayerState): [PlayerState, PlayerState] {
  const seated = state.players.slice().sort((a, b) => a.seat - b.seat);
  const idx = seated.findIndex((p) => p.id === self.id);
  const find = (step: number) => {
    let i = idx;
    for (let n = 0; n < seated.length; n++) {
      i = (i + step + seated.length) % seated.length;
      if (seated[i].alive && seated[i].id !== self.id) return seated[i];
    }
    return seated[idx];
  };
  return [find(-1), find(1)];
}

export function empathInfo(state: GameState, self: PlayerState, slot: string): Msg {
  const ctx = { asker: self.id, slot };
  const [left, right] = livingNeighbors(state, self);
  let count = [left, right].filter((p) => registersAs(state, p, 'evil', ctx)).length;
  if (!abilityWorks(state, self)) {
    count = Math.floor(stableFloat(state.secret, slot, self.id, 'fake') * 3);
  }
  return msg('empathInfo', { count });
}

export function fortuneTellerInfo(state: GameState, self: PlayerState, targetIds: string[], slot: string): Msg {
  const ctx = { asker: self.id, slot };
  const targets = state.players.filter((p) => targetIds.includes(p.id));
  const real = targets.some((t) => t.isRedHerring || registersAs(state, t, 'demon', ctx));
  const answer = abilityWorks(state, self) ? real : stableFloat(state.secret, slot, self.id, 'fake') < 0.5;
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
  const ctx = { asker: self.id, slot };
  const shown = abilityWorks(state, self)
    ? apparentToObserver(state, executed, ctx)
    : stablePick(state.secret, Object.values(CHARACTERS), slot, self.id, 'fake').id;
  return msg('undertakerInfo', { name: executed.name, role: shown });
}

export function ravenkeeperInfo(state: GameState, self: PlayerState, targetId: string, slot: string): Msg {
  const target = state.players.find((p) => p.id === targetId)!;
  const ctx = { asker: self.id, slot };
  const shown = abilityWorks(state, self)
    ? apparentToObserver(state, target, ctx)
    : stablePick(state.secret, Object.values(CHARACTERS), slot, self.id, 'fake').id;
  return msg('ravenkeeperInfo', { name: target.name, role: shown });
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

export function spyInfo(state: GameState, self: PlayerState, slot: string): Msg {
  if (abilityWorks(state, self)) {
    return msg('spyGrimoire', {
      names: state.players.map((p) => p.name),
      roles: state.players.map((p) => p.character),
      dead: state.players.map((p) => (p.alive ? '' : '1')),
    });
  }
  const fakeRoles = state.players.map((p, i) => stablePick(state.secret, Object.values(CHARACTERS), slot, self.id, 'fake', i).id);
  return msg('spyGrimoire', {
    names: state.players.map((p) => p.name),
    roles: fakeRoles,
    dead: state.players.map((p) => (p.alive ? '' : '1')),
  });
}

export type { RegisterKind };
