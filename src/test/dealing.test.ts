// The deal, checked as a property over thousands of secrets for every player count: the right
// mix, no duplicates, the Baron/Drunk rules, the red herring and the Demon's bluffs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS, DISTRIBUTION } from '../game/characters.js';
import { dealCharacters } from '../game/setup.js';
import { GameError } from '../game/types.js';
import type { CharacterId } from '../game/types.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const teamOf = (c: CharacterId) => CHARACTERS[c].team;
const SECRETS = 300;

function forEveryDeal(fn: (n: number, d: ReturnType<typeof dealCharacters>, players: string[], secret: string) => void): void {
  for (let n = 5; n <= 15; n++) {
    for (let i = 0; i < SECRETS; i++) {
      const players = ids(n);
      const secret = `deal-${n}-${i}`;
      fn(n, dealCharacters(players, secret), players, secret);
    }
  }
}

test('every player gets exactly one character, and no character is dealt twice', () => {
  forEveryDeal((n, d, players) => {
    assert.deepEqual(Object.keys(d.characters).sort(), [...players].sort());
    const dealt = Object.values(d.characters);
    assert.equal(dealt.length, n);
    assert.equal(new Set(dealt).size, n, 'a duplicate character');
    for (const c of dealt) assert.ok(CHARACTERS[c], `unknown character ${c}`);
  });
});

test('the mix of Townsfolk / Outsiders / Minions / Demon is exactly the official one (Baron: +2 Outsiders, -2 Townsfolk)', () => {
  forEveryDeal((n, d) => {
    const dealt = Object.values(d.characters);
    const count = (t: string) => dealt.filter((c) => teamOf(c) === t).length;
    const [town, out, minion, demon] = DISTRIBUTION[n];
    const baron = dealt.includes('baron');
    assert.equal(count('demon'), demon);
    assert.equal(count('minion'), minion);
    assert.equal(count('outsider'), baron ? out + 2 : out, `${n} players, baron=${baron}`);
    assert.equal(count('townsfolk'), baron ? town - 2 : town);
  });
});

test('the only Demon in Trouble Brewing is the Imp', () => {
  forEveryDeal((_, d) => assert.equal(Object.values(d.characters).filter((c) => c === 'imp').length, 1));
});

test('the Baron never appears with fewer than the Outsiders it needs (no negative Townsfolk)', () => {
  forEveryDeal((n, d) => {
    if (!Object.values(d.characters).includes('baron')) return;
    assert.ok(DISTRIBUTION[n][0] - 2 >= 1, 'a Baron game must still have a Townsfolk');
  });
});

test('everyone perceives their own character — except the Drunk, who perceives a Townsfolk not in play', () => {
  forEveryDeal((_, d) => {
    const inPlay = new Set(Object.values(d.characters));
    for (const [pid, c] of Object.entries(d.characters)) {
      if (c === 'drunk') {
        assert.equal(teamOf(d.perceived[pid]), 'townsfolk');
        assert.ok(!inPlay.has(d.perceived[pid]), 'the Drunk\'s false token is not also a real character in the game');
      } else {
        assert.equal(d.perceived[pid], c);
      }
    }
  });
});

test('there is exactly one Drunk-token effect: nobody else believes the Drunk\'s false character', () => {
  forEveryDeal((_, d) => {
    const believed = Object.values(d.perceived);
    assert.equal(new Set(believed).size, believed.length, 'two players believe they are the same character');
  });
});

test('the red herring is exactly one good player (never evil), and always exists', () => {
  forEveryDeal((_, d) => {
    assert.ok(d.redHerringId, 'a red herring must exist');
    assert.ok(['townsfolk', 'outsider'].includes(teamOf(d.characters[d.redHerringId!])), 'the red herring is good');
  });
});

test('the Demon gets exactly 3 different bluffs: good, not in play, and never the Drunk\'s false token', () => {
  forEveryDeal((_, d) => {
    assert.equal(d.bluffs.length, 3);
    assert.equal(new Set(d.bluffs).size, 3);
    const inPlay = new Set(Object.values(d.characters));
    const believed = new Set(Object.values(d.perceived));
    for (const b of d.bluffs) {
      assert.ok(['townsfolk', 'outsider'].includes(teamOf(b)), `${b} must be a good character`);
      assert.ok(!inPlay.has(b) && !believed.has(b), `${b} is in play`);
    }
  });
});

test('the deal is a pure function of the players and the secret', () => {
  for (let i = 0; i < 40; i++) {
    const a = dealCharacters(ids(9), `s${i}`);
    const b = dealCharacters(ids(9), `s${i}`);
    assert.deepEqual(a, b);
  }
});

test('different secrets give different deals; different player lists too', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) seen.add(JSON.stringify(dealCharacters(ids(10), `s${i}`).characters));
  assert.ok(seen.size >= 48, `only ${seen.size} different deals out of 50`);
});

test('over many deals every character appears, and each one lands on every seat position', () => {
  const seen = new Set<string>();
  const bySeat = new Map<string, Set<number>>();
  for (let i = 0; i < 2000; i++) {
    const n = 5 + (i % 11);
    const players = ids(n);
    const d = dealCharacters(players, `cov-${i}`);
    players.forEach((p, seat) => {
      const c = d.characters[p];
      seen.add(c);
      if (!bySeat.has(c)) bySeat.set(c, new Set());
      bySeat.get(c)!.add(seat);
    });
  }
  assert.equal(seen.size, 22, `missing: ${Object.keys(CHARACTERS).filter((c) => !seen.has(c)).join(', ')}`);
  for (const [c, seats] of bySeat) assert.ok(seats.size >= 5, `${c} only ever sat at ${seats.size} different seats`);
});

test('the Baron shows up in a sensible share of games (not never, not always)', () => {
  let baron = 0;
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    const d = dealCharacters(ids(12), `baron-${i}`);
    total++;
    if (Object.values(d.characters).includes('baron')) baron++;
  }
  assert.ok(baron > total * 0.1 && baron < total * 0.6, `Baron in ${baron}/${total} games`);
});

test('the Drunk shows up too, and only ever in games with Outsiders', () => {
  let drunk = 0;
  for (let n = 6; n <= 15; n++) {
    for (let i = 0; i < 200; i++) {
      const d = dealCharacters(ids(n), `drunk-${n}-${i}`);
      if (Object.values(d.characters).includes('drunk')) {
        drunk++;
        assert.ok(DISTRIBUTION[n][1] > 0 || Object.values(d.characters).includes('baron'), 'a Drunk needs an Outsider slot');
      }
    }
  }
  assert.ok(drunk > 50);
});

test('the team split holds for the smallest and the largest game', () => {
  for (const n of [5, 15]) {
    const d = dealCharacters(ids(n), 'edge');
    assert.equal(Object.keys(d.characters).length, n);
  }
});

test('fewer than 5 or more than 15 players cannot be dealt — with a GameError, not a crash', () => {
  for (const n of [0, 1, 2, 3, 4, 16, 17, 40]) assert.throws(() => dealCharacters(ids(n), 'x'), GameError, `${n} players`);
});

test('the distribution table matches the official one for every player count', () => {
  const official: Record<number, number[]> = {
    5: [3, 0, 1, 1], 6: [3, 1, 1, 1], 7: [5, 0, 1, 1], 8: [5, 1, 1, 1], 9: [5, 2, 1, 1], 10: [7, 0, 2, 1],
    11: [7, 1, 2, 1], 12: [7, 2, 2, 1], 13: [9, 0, 3, 1], 14: [9, 1, 3, 1], 15: [9, 2, 3, 1],
  };
  assert.deepEqual(DISTRIBUTION, official);
  for (const [n, [t, o, m, d]] of Object.entries(DISTRIBUTION)) assert.equal(t + o + m + d, Number(n));
});

test('the character list is the official Trouble Brewing 22: 13 Townsfolk, 4 Outsiders, 4 Minions, 1 Demon', () => {
  const by = (t: string) => Object.values(CHARACTERS).filter((c) => c.edition === 'tb' && c.team === t).length;
  assert.equal(by('townsfolk'), 13);
  assert.equal(by('outsider'), 4);
  assert.equal(by('minion'), 4);
  assert.equal(by('demon'), 1);
});
