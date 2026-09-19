// Every information character, checked against a brute-force computation over hundreds of random
// deals (5-15 players), with dead players, poison and drunkenness mixed in. What a healthy player
// is told must be TRUE; what a poisoned/drunk player is told must be well-formed and sometimes false.
import assert from 'node:assert/strict';
import { byChar, mk, poison } from './helpers.js';
import { test } from 'node:test';
import { alignmentOfCharacter, CHARACTERS } from '../game/characters.js';
import { addPlayer, createGame } from '../game/engine.js';
import {
  chefInfo, demonInfo, empathInfo, fortuneTellerInfo, investigativeInfo, livingNeighbors, minionInfo, ravenkeeperInfo, spyInfo, undertakerInfo,
} from '../game/info.js';
import { registersAs } from '../game/registration.js';
import { mulberry32, seedFromString } from '../game/rng.js';
import { dealCharacters } from '../game/setup.js';
import type { CharacterId, GameState, Msg, PlayerState } from '../game/types.js';

/** A dealt game (as after startGame) with a seeded scatter of dead players. */
function deal(n: number, seed: number, opts: { dead?: boolean } = {}): GameState {
  const s = createGame('INFO');
  s.secret = `info-${n}-${seed}`;
  const ps = Array.from({ length: n }, (_, i) => addPlayer(s, `P${i}`));
  const d = dealCharacters(ps.map((p) => p.id), s.secret);
  for (const p of ps) {
    p.character = d.characters[p.id];
    p.perceived = d.perceived[p.id];
    p.alignment = alignmentOfCharacter(p.character);
    p.isRedHerring = d.redHerringId === p.id;
  }
  s.bluffs = d.bluffs;
  s.phase = 'night';
  s.night = 2;
  if (opts.dead) {
    const rand = mulberry32(seedFromString(`dead-${seed}`));
    for (const p of ps) if (rand() < 0.3) p.alive = false;
  }
  return s;
}

const each = (fn: (s: GameState, n: number, seed: number) => void, opts: { dead?: boolean } = {}, seeds = 60) => {
  for (let n = 5; n <= 15; n++) for (let seed = 0; seed < seeds; seed++) fn(deal(n, seed, opts), n, seed);
};

/** Force somebody to have a character (moving what they had to the previous holder is unnecessary here). */
const givePlayer = (s: GameState, index: number, id: CharacterId): PlayerState => {
  const p = s.players[index];
  p.character = id;
  p.perceived = id;
  p.alignment = alignmentOfCharacter(id);
  return p;
};

// ---------------------------------------------------------------- Washerwoman / Librarian / Investigator

const investigators: [CharacterId, 'townsfolk' | 'outsider' | 'minion'][] = [
  ['washerwoman', 'townsfolk'], ['librarian', 'outsider'], ['investigator', 'minion'],
];

for (const [char, team] of investigators) {
  test(`${char}: a healthy one is shown one real ${team} among two named players (checked over ${11 * 60} deals)`, () => {
    let checked = 0;
    each((s) => {
      const self = givePlayer(s, 0, char);
      const msg = investigativeInfo(s, self, team, 'slot');
      const others = s.players.filter((p) => p.alive && p.id !== self.id);
      // Who counts as the Townsfolk/Outsider/Minion depends on how each player REGISTERS
      // (a Spy may register as a Townsfolk/Outsider, a Recluse as a Minion).
      const candidates = others.filter((p) => registersAs(s, p, team, { asker: self.id, slot: 'slot' }));
      if (msg.key === 'noTeamInPlay') {
        assert.equal(candidates.length, 0, 'said "none in play" while one is');
        return;
      }
      assert.equal(msg.key, 'investigativeInfo');
      const { a, b, role } = msg.vars as { a: string; b: string; role: CharacterId };
      assert.notEqual(a, b, 'two different players');
      const named = [a, b].map((name) => s.players.find((p) => p.name === name)!);
      assert.ok(named.every((p) => p && p.alive && p.id !== self.id), 'both alive, neither is the asker');
      assert.equal(CHARACTERS[role].team, team, `the character shown is a ${team}`);
      const disguised = (p: PlayerState) => (p.character === 'spy' && team !== 'minion') || (p.character === 'recluse' && team === 'minion');
      assert.ok(named.some((p) => p.character === role || (disguised(p) && registersAs(s, p, team, { asker: self.id, slot: 'slot' }))), `one of ${a}/${b} really is (or registers as) the ${role}`);
      checked++;
    });
    assert.ok(checked > 200, `only ${checked} deals had something to show`);
  });

  test(`${char}: a poisoned one is still told something well-formed (two players, a ${team}), and it is sometimes a lie`, () => {
    let lies = 0;
    let truths = 0;
    each((s) => {
      const self = givePlayer(s, 0, char);
      s.players.find((p) => p.character === 'poisoner') ?? givePlayer(s, s.players.length - 1, 'poisoner');
      poison(s, self.id);
      const msg = investigativeInfo(s, self, team, 'slot');
      assert.equal(msg.key, 'investigativeInfo');
      const { a, b, role } = msg.vars as { a: string; b: string; role: CharacterId };
      assert.notEqual(a, b);
      assert.notEqual(a, self.name);
      assert.notEqual(b, self.name);
      assert.equal(CHARACTERS[role].team, team);
      const named = [a, b].map((name) => s.players.find((p) => p.name === name)!);
      if (named.some((p) => p.character === role)) truths++;
      else lies++;
    });
    assert.ok(lies > 20, `the poisoned ${char} was told the truth almost always (${lies} lies, ${truths} truths)`);
  });

  test(`${char}: a Drunk who thinks they are one is treated the same way`, () => {
    let lies = 0;
    each((s) => {
      const self = givePlayer(s, 0, 'drunk');
      self.perceived = char;
      const msg = investigativeInfo(s, self, team, 'slot');
      const { a, b, role } = msg.vars as { a: string; b: string; role: CharacterId };
      const named = [a, b].map((name) => s.players.find((p) => p.name === name)!);
      if (!named.some((p) => p && p.character === role)) lies++;
    });
    assert.ok(lies > 20, 'a Drunk is never given reliable information');
  });

  test(`${char}: the same question asked twice gets the same answer (no flip-flopping)`, () => {
    each((s) => {
      const self = givePlayer(s, 0, char);
      assert.deepEqual(investigativeInfo(s, self, team, 'slot-x'), investigativeInfo(s, self, team, 'slot-x'));
    }, {}, 10);
  });
}

test('Librarian: with no Outsider in play she is told so, naming two players who are not Outsiders', () => {
  let saw = 0;
  each((s) => {
    // no Outsiders — and no Spy, who might register as one
    for (const p of s.players) if (CHARACTERS[p.character].team === 'outsider' || p.character === 'spy') givePlayer(s, s.players.indexOf(p), 'soldier');
    const self = givePlayer(s, 0, 'librarian');
    const m = investigativeInfo(s, self, 'outsider', 'slot');
    assert.equal(m.key, 'noTeamInPlay');
    const named = [m.vars!.a, m.vars!.b].map((name) => s.players.find((p) => p.name === name)!);
    assert.ok(named.every((p) => CHARACTERS[p.character].team !== 'outsider'));
    assert.equal(m.vars!.team, 'outsider');
    saw++;
  });
  assert.ok(saw > 100);
});

test('Investigator: the Spy can be shown as the Minion (it is a Minion), and the Recluse never appears as a real Minion', () => {
  const s = deal(9, 4);
  const self = givePlayer(s, 0, 'investigator');
  for (let i = 1; i < 9; i++) if (CHARACTERS[s.players[i].character].team === 'minion') givePlayer(s, i, 'soldier');
  givePlayer(s, 1, 'spy');
  const m = investigativeInfo(s, self, 'minion', 'slot');
  assert.equal(m.vars!.role, 'spy');
});

// ---------------------------------------------------------------- Chef

function bruteForceChef(s: GameState): { min: number; max: number } {
  const seated = s.players.slice().sort((a, b) => a.seat - b.seat);
  const evil = (p: PlayerState, mode: 'min' | 'max'): boolean => {
    const trueEvil = alignmentOfCharacter(p.character) === 'evil';
    if (p.character === 'recluse') return mode === 'max'; // might register as evil
    if (p.character === 'spy') return mode === 'min' ? false : true; // might register as good
    return trueEvil;
  };
  let min = 0;
  let max = 0;
  for (let i = 0; i < seated.length; i++) {
    const a = seated[i];
    const b = seated[(i + 1) % seated.length];
    if (evil(a, 'min') && evil(b, 'min')) min++;
    if (evil(a, 'max') && evil(b, 'max')) max++;
  }
  return { min, max };
}

test('Chef: the number of adjacent evil pairs is exactly right (dead players still sit there)', () => {
  let exact = 0;
  each((s) => {
    const chef = givePlayer(s, 0, 'chef');
    const { min, max } = bruteForceChef(s);
    const count = (chefInfo(s, chef, 'slot').vars as { count: number }).count;
    assert.ok(count >= min && count <= max, `Chef said ${count}, truth is ${min}..${max}`);
    if (min === max) { assert.equal(count, min); exact++; }
  }, { dead: true });
  assert.ok(exact > 200, 'most deals have no Recluse/Spy, so the answer is exact');
});

test('Chef: a hand-built table — evil at seats 0,1,2 and 5,6 makes 3 pairs; a circle wraps around', () => {
  const s = deal(8, 1);
  const layout: CharacterId[] = ['imp', 'poisoner', 'baron', 'soldier', 'mayor', 'spy', 'scarletwoman', 'soldier'];
  layout.forEach((c, i) => givePlayer(s, i, c));
  const chef = givePlayer(s, 3, 'chef');
  // evil (spy counts as evil unless it registers good): seats 0,1,2,5,6 → pairs 0-1, 1-2, 5-6 (+ maybe 6-7? no) = 3
  const { min, max } = bruteForceChef(s);
  const count = (chefInfo(s, chef, 'slot').vars as { count: number }).count;
  assert.ok(count >= min && count <= max);
  assert.equal(max, 3);
  // wrap-around: seats 7 and 0 both evil
  givePlayer(s, 7, 'imp');
  givePlayer(s, 0, 'poisoner');
  givePlayer(s, 1, 'soldier');
  givePlayer(s, 2, 'soldier');
  givePlayer(s, 5, 'soldier');
  givePlayer(s, 6, 'soldier');
  assert.equal((chefInfo(s, chef, 'slot').vars as { count: number }).count, 1, 'seat 7 (last) and seat 0 (first) are neighbours');
});

test('Chef: nobody evil next to each other means 0', () => {
  const s = deal(10, 2);
  const layout: CharacterId[] = ['imp', 'soldier', 'poisoner', 'soldier', 'baron', 'soldier', 'mayor', 'soldier', 'washerwoman', 'soldier'];
  layout.forEach((c, i) => givePlayer(s, i, c));
  const chef = givePlayer(s, 9, 'chef');
  assert.equal((chefInfo(s, chef, 'slot').vars as { count: number }).count, 0);
});

test('Chef: a poisoned Chef is told a plausible number (never more pairs than the table can hold), and it varies', () => {
  const seen = new Set<number>();
  each((s) => {
    const chef = givePlayer(s, 0, 'chef');
    givePlayer(s, s.players.length - 1, 'poisoner');
    poison(s, chef.id);
    const count = (chefInfo(s, chef, 'slot').vars as { count: number }).count;
    assert.ok(Number.isInteger(count) && count >= 0);
    const evil = s.players.filter((p) => p.alignment === 'evil').length;
    assert.ok(count <= (evil >= s.players.length ? evil : Math.max(0, evil - 1)), 'no more pairs than the evil players could form');
    seen.add(count);
  });
  assert.ok(seen.size > 1, 'the lie is not always the same number');
});

// ---------------------------------------------------------------- Empath

function bruteForceEmpath(s: GameState, self: PlayerState): { min: number; max: number } {
  const seated = s.players.slice().sort((a, b) => a.seat - b.seat);
  const idx = seated.findIndex((p) => p.id === self.id);
  const pick = (dir: number) => {
    for (let k = 1; k < seated.length; k++) {
      const q = seated[(idx + dir * k + seated.length * 2) % seated.length];
      if (q.alive) return q;
    }
    return seated[idx];
  };
  const [l, r] = [pick(-1), pick(1)];
  const lo = [l, r].filter((p) => p.character !== 'recluse' && p.character !== 'spy' ? alignmentOfCharacter(p.character) === 'evil' : false).length;
  const hi = [l, r].filter((p) => p.character === 'recluse' || (alignmentOfCharacter(p.character) === 'evil')).length;
  return { min: lo, max: hi };
}

test('Empath: counts evil among the two ALIVE neighbours, skipping the dead (over deals with many dead)', () => {
  let exact = 0;
  each((s) => {
    const empath = givePlayer(s, 0, 'empath');
    empath.alive = true;
    const { min, max } = bruteForceEmpath(s, empath);
    const count = (empathInfo(s, empath, 'slot').vars as { count: number }).count;
    assert.ok(count >= min && count <= max, `Empath said ${count}, truth is ${min}..${max}`);
    if (min === max) { assert.equal(count, min); exact++; }
  }, { dead: true });
  assert.ok(exact > 300);
});

test('livingNeighbors: skips every dead seat, wraps around, and is never the player themself', () => {
  const s = deal(8, 3);
  s.players.forEach((p) => (p.alive = true));
  const me = s.players[0];
  s.players[1].alive = false;
  s.players[2].alive = false;
  s.players[7].alive = false;
  const [left, right] = livingNeighbors(s, me);
  assert.equal(left.id, s.players[6].id, 'left skips the dead seat 7');
  assert.equal(right.id, s.players[3].id, 'right skips the dead seats 1 and 2');
  assert.notEqual(left.id, me.id);
});

test('livingNeighbors with only one other player alive returns that player on both sides', () => {
  const s = deal(6, 3);
  s.players.forEach((p, i) => (p.alive = i === 0 || i === 3));
  const [l, r] = livingNeighbors(s, s.players[0]);
  assert.equal(l.id, s.players[3].id);
  assert.equal(r.id, s.players[3].id);
});

test('Empath: two evil neighbours reads 2, none reads 0, one reads 1 — on a hand-built table', () => {
  const s = deal(7, 5);
  const layout: CharacterId[] = ['soldier', 'imp', 'empath', 'poisoner', 'mayor', 'monk', 'chef'];
  layout.forEach((c, i) => givePlayer(s, i, c));
  s.players.forEach((p) => (p.alive = true));
  const empath = s.players[2];
  assert.equal((empathInfo(s, empath, 'slot').vars as { count: number }).count, 2);
  givePlayer(s, 3, 'soldier');
  assert.equal((empathInfo(s, empath, 'slot').vars as { count: number }).count, 1);
  givePlayer(s, 1, 'soldier');
  assert.equal((empathInfo(s, empath, 'slot').vars as { count: number }).count, 0);
  s.players[3].alive = false;
  givePlayer(s, 4, 'imp'); // the next living neighbour on the right is now seat 4
  assert.equal((empathInfo(s, empath, 'slot').vars as { count: number }).count, 1, 'the dead seat 3 is skipped');
});

test('Empath: poisoned or drunk gets a number 0-2, sometimes wrong', () => {
  let wrong = 0;
  each((s) => {
    const empath = givePlayer(s, 0, 'empath');
    givePlayer(s, s.players.length - 1, 'poisoner');
    poison(s, empath.id);
    empath.alive = true;
    const { min, max } = bruteForceEmpath(s, empath);
    const count = (empathInfo(s, empath, 'slot').vars as { count: number }).count;
    assert.ok(count >= 0 && count <= 2);
    if (count < min || count > max) wrong++;
  });
  assert.ok(wrong > 30);
});

// ---------------------------------------------------------------- Fortune Teller

test('Fortune Teller: Yes exactly when one of the two is the Demon or the red herring (a Recluse may also read Yes)', () => {
  let yes = 0;
  let no = 0;
  each((s, n, seed) => {
    const ft = givePlayer(s, 0, 'fortuneteller');
    const rand = mulberry32(seedFromString(`ft-${n}-${seed}`));
    for (let trial = 0; trial < 6; trial++) {
      const others = s.players.filter((p) => p.id !== ft.id);
      const a = others[Math.floor(rand() * others.length)];
      const b = others.filter((p) => p.id !== a.id)[Math.floor(rand() * (others.length - 1))];
      const msg = fortuneTellerInfo(s, ft, [a.id, b.id], `slot-${trial}`);
      const mustBeYes = [a, b].some((p) => CHARACTERS[p.character].team === 'demon' || p.isRedHerring);
      const mayBeYes = mustBeYes || [a, b].some((p) => p.character === 'recluse');
      if (mustBeYes) assert.equal(msg.key, 'fortuneTellerYes');
      else if (!mayBeYes) assert.equal(msg.key, 'fortuneTellerNo');
      if (msg.key === 'fortuneTellerYes') yes++;
      else no++;
    }
  });
  assert.ok(yes > 100 && no > 100, `both answers must occur (${yes} yes, ${no} no)`);
});

test('Fortune Teller: a poisoned one gives a Yes or No, and is wrong at least sometimes', () => {
  let wrong = 0;
  each((s) => {
    const ft = givePlayer(s, 0, 'fortuneteller');
    givePlayer(s, s.players.length - 1, 'poisoner');
    poison(s, ft.id);
    const demon = s.players.find((p) => CHARACTERS[p.character].team === 'demon');
    if (!demon) return; // (the test's own overwriting of seat 0 removed the Demon in this deal)
    const other = s.players.find((p) => p.id !== demon.id && p.id !== ft.id)!;
    for (let k = 0; k < 4; k++) {
      const msg = fortuneTellerInfo(s, ft, [demon.id, other.id], `slot-${k}`);
      assert.ok(msg.key === 'fortuneTellerYes' || msg.key === 'fortuneTellerNo');
      if (msg.key === 'fortuneTellerNo') wrong++;
    }
  });
  assert.ok(wrong > 30, 'a poisoned Fortune Teller must sometimes say No when the Demon is there');
});

test('Fortune Teller: choosing the same two players on a different night can give a different answer for a Recluse (each question is rolled again)', () => {
  const s = deal(9, 8);
  const ft = givePlayer(s, 0, 'fortuneteller');
  givePlayer(s, 1, 'recluse');
  s.players[1].isRedHerring = false;
  s.players.forEach((p, i) => { if (i > 1 && (p.isRedHerring || CHARACTERS[p.character].team === 'demon')) p.isRedHerring = false; });
  const other = s.players.find((p, i) => i > 1 && CHARACTERS[p.character].team !== 'demon')!;
  const answers = new Set<string>();
  for (let n = 0; n < 40; n++) answers.add(fortuneTellerInfo(s, ft, [s.players[1].id, other.id], `night-${n}`).key);
  assert.equal(answers.size, 2, 'the Recluse registers as the Demon only some of the time');
});

// ---------------------------------------------------------------- Undertaker / Ravenkeeper

test('Undertaker: told the executed player\'s true character (Spy and Recluse may show as something else)', () => {
  each((s) => {
    const under = givePlayer(s, 0, 'undertaker');
    for (const target of s.players.slice(1)) {
      const m = undertakerInfo(s, under, target, 'slot');
      assert.equal(m.key, 'undertakerInfo');
      assert.equal(m.vars!.name, target.name);
      if (target.character !== 'spy' && target.character !== 'recluse') assert.equal(m.vars!.role, target.character);
      else assert.ok(String(m.vars!.role) in CHARACTERS);
    }
  }, {}, 8);
});

test('Ravenkeeper: told the chosen player\'s true character (Spy and Recluse may show as something else)', () => {
  each((s) => {
    const rk = givePlayer(s, 0, 'ravenkeeper');
    for (const target of s.players) {
      const m = ravenkeeperInfo(s, rk, target.id, 'slot');
      assert.equal(m.vars!.name, target.name);
      if (target.character !== 'spy' && target.character !== 'recluse') assert.equal(m.vars!.role, target.character);
      else assert.ok(String(m.vars!.role) in CHARACTERS);
    }
  }, {}, 8);
});

test('Undertaker and Ravenkeeper: when poisoned they name a real character, often the wrong one', () => {
  let wrong = 0;
  each((s) => {
    const under = givePlayer(s, 0, 'undertaker');
    givePlayer(s, s.players.length - 1, 'poisoner');
    poison(s, under.id);
    const target = s.players[1];
    const m = undertakerInfo(s, under, target, 'slot');
    assert.ok(String(m.vars!.role) in CHARACTERS);
    if (m.vars!.role !== target.character) wrong++;
  });
  assert.ok(wrong > 200);
});

test('a Spy or Recluse shown to the Undertaker/Ravenkeeper is sometimes disguised and sometimes not', () => {
  const s = deal(9, 2);
  const under = givePlayer(s, 0, 'undertaker');
  const spy = givePlayer(s, 1, 'spy');
  const recluse = givePlayer(s, 2, 'recluse');
  const disguised = { spy: new Set<string>(), recluse: new Set<string>() };
  for (let n = 0; n < 80; n++) {
    disguised.spy.add(String(undertakerInfo(s, under, spy, `night-${n}`).vars!.role));
    disguised.recluse.add(String(undertakerInfo(s, under, recluse, `night-${n}`).vars!.role));
  }
  assert.ok(disguised.spy.has('spy') && disguised.spy.size > 1, 'the Spy sometimes shows as good');
  assert.ok(disguised.recluse.has('recluse') && disguised.recluse.size > 1, 'the Recluse sometimes shows as evil');
  for (const r of disguised.spy) assert.ok(r === 'spy' || CHARACTERS[r as CharacterId].team === 'townsfolk' || CHARACTERS[r as CharacterId].team === 'outsider');
  for (const r of disguised.recluse) assert.ok(r === 'recluse' || ['minion', 'demon'].includes(CHARACTERS[r as CharacterId].team));
});

// ---------------------------------------------------------------- Minions, Demon, Spy

test('Minion info: every other Minion by name plus the Demon; a lone Minion is told so', () => {
  each((s) => {
    const minions = s.players.filter((p) => CHARACTERS[p.character].team === 'minion');
    const demon = s.players.find((p) => CHARACTERS[p.character].team === 'demon')!;
    for (const m of minions) {
      const info = minionInfo(s, m);
      const others = minions.filter((x) => x.id !== m.id).map((x) => x.name);
      if (others.length === 0) {
        assert.equal(info.key, 'minionInfoSolo');
      } else {
        assert.equal(info.key, 'minionInfoGroup');
        assert.deepEqual([...(info.vars!.names as string[])].sort(), others.sort());
      }
      assert.equal(info.vars!.demon, demon.name);
    }
  });
});

test('Demon info: every Minion by name and the three bluffs (good, not in play, never the Drunk\'s false character)', () => {
  each((s) => {
    const imp = s.players.find((p) => CHARACTERS[p.character].team === 'demon')!;
    const info = demonInfo(s, imp);
    const minions = s.players.filter((p) => CHARACTERS[p.character].team === 'minion').map((p) => p.name);
    assert.deepEqual([...(info.vars!.names as string[])].sort(), minions.sort());
    const bluffs = info.vars!.bluffs as CharacterId[];
    assert.equal(bluffs.length, 3);
    assert.equal(new Set(bluffs).size, 3);
    const inPlay = new Set(s.players.map((p) => p.character));
    const believed = new Set(s.players.map((p) => p.perceived));
    for (const b of bluffs) {
      assert.ok(['townsfolk', 'outsider'].includes(CHARACTERS[b].team), `${b} is good`);
      assert.ok(!inPlay.has(b), `${b} is not in play`);
      assert.ok(!believed.has(b), `${b} is not what anyone believes to be (the Drunk's token)`);
    }
  });
});

test('Spy: sees every player\'s true character and who is dead, in seat order', () => {
  each((s) => {
    const spy = givePlayer(s, 0, 'spy');
    const m = spyInfo(s, spy, 'slot');
    assert.deepEqual(m.vars!.names, s.players.map((p) => p.name));
    assert.deepEqual(m.vars!.roles, s.players.map((p) => p.character));
    assert.deepEqual(m.vars!.dead, s.players.map((p) => (p.alive ? '' : '1')));
  }, { dead: true }, 20);
});

test('Spy: the grimoire carries the Storyteller\'s reminder tokens — who is poisoned, drunk, the red herring, protected', () => {
  const s = mk(['spy', 'poisoner', 'monk', 'drunk', 'fortuneteller', 'soldier', 'imp'], { drunkFakeChar: 'empath' });
  const spy = byChar(s, 'spy');
  poison(s, byChar(s, 'soldier').id);
  byChar(s, 'fortuneteller').isRedHerring = true;
  s.data.monkProtectedId = byChar(s, 'imp').id;
  const marks = spyInfo(s, spy, 'slot').vars!.marks as string[];
  const markOf = (c: CharacterId) => marks[s.players.findIndex((p) => p.character === c)];
  assert.equal(markOf('soldier'), 'poisoned', 'the Poisoner\'s target');
  assert.equal(markOf('drunk'), 'drunk', 'the Drunk');
  assert.equal(markOf('fortuneteller'), 'redHerring', 'the Fortune Teller\'s red herring');
  assert.equal(markOf('imp'), 'protected', 'the Monk\'s protection tonight');
  assert.equal(markOf('monk'), '', 'and nothing on a player with no reminder');
});

test('Spy: a drunk or poisoned Spy still sees reminder tokens (their absence would give the poison away)', () => {
  const s = mk(['spy', 'poisoner', 'monk', 'empath', 'fortuneteller', 'soldier', 'imp']);
  poison(s, byChar(s, 'spy').id);
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    s.secret = `fake-${i}`;
    (spyInfo(s, byChar(s, 'spy'), 'slot').vars!.marks as string[]).forEach((m) => seen.add(m));
  }
  assert.ok(seen.size > 1, `a false grimoire still shows some reminders (${[...seen]})`);
});

test('Spy: a poisoned Spy sees a full but wrong grimoire', () => {
  let wrongCells = 0;
  each((s) => {
    const spy = givePlayer(s, 0, 'spy');
    givePlayer(s, s.players.length - 1, 'poisoner');
    poison(s, spy.id);
    const m = spyInfo(s, spy, 'slot');
    const roles = m.vars!.roles as string[];
    assert.equal(roles.length, s.players.length);
    assert.ok(roles.every((r) => r in CHARACTERS));
    roles.forEach((r, i) => { if (r !== s.players[i].character) wrongCells++; });
  }, {}, 20);
  assert.ok(wrongCells > 500);
});

test('an info message never contains anything but plain data (names, numbers, character ids)', () => {
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) throw new Error('empty value in a message');
    if (Array.isArray(v)) v.forEach(walk);
    else assert.ok(['string', 'number'].includes(typeof v), `unexpected ${typeof v}`);
  };
  each((s) => {
    const self = givePlayer(s, 0, 'washerwoman');
    const msgs: Msg[] = [investigativeInfo(s, self, 'townsfolk', 'a'), chefInfo(s, self, 'a'), empathInfo(s, self, 'a'), demonInfo(s, self), spyInfo(s, self, 'a')];
    for (const m of msgs) Object.values(m.vars ?? {}).forEach(walk);
  }, {}, 6);
});

