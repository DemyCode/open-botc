import { CHARACTERS } from './characters.js';
import { abilityWorks, apparentCharacter, registersAs, type RegisterKind } from './registration.js';
import { stableFloat, stablePick } from './rng.js';
import type { GameState, PlayerState, Team } from './types.js';

function others(state: GameState, self: PlayerState): PlayerState[] {
  return state.players.filter((p) => p.alive && p.id !== self.id);
}

function teamLabel(team: Team): string {
  return team === 'townsfolk' ? 'Townsfolk' : team === 'outsider' ? 'Outsiders' : team === 'minion' ? 'Minions' : 'Demons';
}

function pickPair(state: GameState, pool: PlayerState[], slot: string, self: string, tag: string): [PlayerState, PlayerState] {
  const a = stablePick(state.secret, pool, slot, self, tag, 'a');
  const rest = pool.filter((p) => p.id !== a.id);
  const b = rest.length ? stablePick(state.secret, rest, slot, self, tag, 'b') : a;
  return stableFloat(state.secret, slot, self, tag, 'order') < 0.5 ? [a, b] : [b, a];
}

/** Shared shape behind Washerwoman/Librarian/Investigator: "A or B is the <character>." */
export function investigativeInfo(state: GameState, self: PlayerState, team: Exclude<Team, 'demon'>, slot: string): string {
  const pool = others(state, self);
  const ctx = { asker: self.id, slot };
  if (abilityWorks(state, self)) {
    const candidates = pool.filter((p) => CHARACTERS[p.character].team === team);
    if (!candidates.length) {
      const [a, b] = pickPair(state, pool, slot, self.id, 'none');
      return `Neither ${a.name} nor ${b.name} is a ${teamLabel(team).slice(0, -1)} — there are no ${teamLabel(team)} in play.`;
    }
    const real = stablePick(state.secret, candidates, slot, self.id, 'target');
    const decoyPool = pool.filter((p) => p.id !== real.id);
    const decoy = decoyPool.length ? stablePick(state.secret, decoyPool, slot, self.id, 'decoy') : real;
    const charName = CHARACTERS[apparentCharacter(state, real, team, ctx)].name;
    const pair = stableFloat(state.secret, slot, self.id, 'order') < 0.5 ? [real, decoy] : [decoy, real];
    return `${pair[0].name} or ${pair[1].name} is the ${charName}.`;
  }
  const [a, b] = pickPair(state, pool, slot, self.id, 'fake');
  const teamChars = Object.values(CHARACTERS).filter((c) => c.team === team);
  const fake = stablePick(state.secret, teamChars, slot, self.id, 'fake-char');
  return `${a.name} or ${b.name} is the ${fake.name}.`;
}

export function chefInfo(state: GameState, self: PlayerState, slot: string): string {
  const seated = state.players.slice().sort((a, b) => a.seat - b.seat);
  const ctx = { asker: self.id, slot };
  let count = 0;
  for (let i = 0; i < seated.length; i++) {
    const p1 = seated[i];
    const p2 = seated[(i + 1) % seated.length];
    if (registersAs(state, p1, 'evil', ctx) && registersAs(state, p2, 'evil', ctx)) count++;
  }
  if (!abilityWorks(state, self)) {
    count = Math.floor(stableFloat(state.secret, slot, self.id, 'fake') * 3);
  }
  return `You see ${count} pair${count === 1 ? '' : 's'} of evil players sitting next to each other.`;
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

export function empathInfo(state: GameState, self: PlayerState, slot: string): string {
  const ctx = { asker: self.id, slot };
  const [left, right] = livingNeighbors(state, self);
  let count = [left, right].filter((p) => registersAs(state, p, 'evil', ctx)).length;
  if (!abilityWorks(state, self)) {
    count = Math.floor(stableFloat(state.secret, slot, self.id, 'fake') * 3);
  }
  return `${count} of your 2 alive neighbours ${count === 1 ? 'is' : 'are'} evil.`;
}

export function fortuneTellerInfo(state: GameState, self: PlayerState, targetIds: string[], slot: string): string {
  const ctx = { asker: self.id, slot };
  const targets = state.players.filter((p) => targetIds.includes(p.id));
  const real = targets.some((t) => t.isRedHerring || registersAs(state, t, 'demon', ctx));
  const answer = abilityWorks(state, self) ? real : stableFloat(state.secret, slot, self.id, 'fake') < 0.5;
  return answer ? 'Yes — one of them is the Demon.' : 'No — neither is the Demon.';
}

function apparentToObserver(state: GameState, target: PlayerState, ctx: { asker: string; slot: string }) {
  if (target.character === 'recluse' && registersAs(state, target, 'evil', ctx)) {
    return apparentCharacter(state, target, stableFloat(state.secret, ctx.slot, 'demon-or-minion', target.id) < 0.3 ? 'demon' : 'minion', ctx);
  }
  if (target.character === 'spy' && registersAs(state, target, 'good', ctx)) {
    return apparentCharacter(state, target, stableFloat(state.secret, ctx.slot, 'town-or-outsider', target.id) < 0.8 ? 'townsfolk' : 'outsider', ctx);
  }
  return target.character;
}

export function undertakerInfo(state: GameState, self: PlayerState, executed: PlayerState | null, slot: string): string {
  if (!executed) return 'Nobody was executed today.';
  const ctx = { asker: self.id, slot };
  const shown = abilityWorks(state, self)
    ? apparentToObserver(state, executed, ctx)
    : stablePick(state.secret, Object.values(CHARACTERS), slot, self.id, 'fake').id;
  return `${executed.name} was the ${CHARACTERS[shown].name}.`;
}

export function ravenkeeperInfo(state: GameState, self: PlayerState, targetId: string, slot: string): string {
  const target = state.players.find((p) => p.id === targetId)!;
  const ctx = { asker: self.id, slot };
  const shown = abilityWorks(state, self)
    ? apparentToObserver(state, target, ctx)
    : stablePick(state.secret, Object.values(CHARACTERS), slot, self.id, 'fake').id;
  return `${target.name} is the ${CHARACTERS[shown].name}.`;
}

export function minionInfo(state: GameState, self: PlayerState): string {
  const demon = state.players.find((p) => CHARACTERS[p.character].team === 'demon');
  const fellow = state.players.filter((p) => CHARACTERS[p.character].team === 'minion' && p.id !== self.id);
  const demonText = `The Demon is ${demon ? demon.name : 'unknown'}.`;
  if (fellow.length === 0) return `You have no fellow Minions. ${demonText}`;
  const names = fellow.map((p) => p.name).join(', ');
  return `Your fellow Minion${fellow.length === 1 ? ' is' : 's are'} ${names}. ${demonText}`;
}

export function demonInfo(state: GameState, self: PlayerState): string {
  const minions = state.players.filter((p) => CHARACTERS[p.character].team === 'minion');
  const names = minions.map((p) => p.name).join(', ') || 'no one';
  const bluffs = state.bluffs.map((id) => CHARACTERS[id].name).join(', ');
  return `Your Minion${minions.length === 1 ? ' is' : 's are'} ${names}. Your bluffs: ${bluffs}.`;
}

export function spyInfo(state: GameState, self: PlayerState, slot: string): string {
  if (abilityWorks(state, self)) {
    const lines = state.players.map((p) => `${p.name}: ${CHARACTERS[p.character].name}${p.alive ? '' : ' (dead)'}`);
    return `Grimoire — ${lines.join('; ')}.`;
  }
  const lines = state.players.map(
    (p, i) => `${p.name}: ${stablePick(state.secret, Object.values(CHARACTERS), slot, self.id, 'fake', i).name}`
  );
  return `Grimoire — ${lines.join('; ')}.`;
}

export type { RegisterKind };
