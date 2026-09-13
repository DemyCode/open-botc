import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS, DISTRIBUTION } from '../game/characters.js';
import { dealCharacters } from '../game/setup.js';

test('deals the correct team distribution for a given player count', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `p${i}`);
  const deal = dealCharacters(ids, 'seed-a');
  const counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of ids) counts[CHARACTERS[deal.characters[id]].team]++;
  const [tf, out, min, dem] = DISTRIBUTION[9];
  assert.deepEqual(counts, { townsfolk: tf, outsider: out, minion: min, demon: dem });
});

test('Baron adds 2 Outsiders and removes 2 Townsfolk', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `p${i}`);
  let found = false;
  for (let seed = 0; seed < 200 && !found; seed++) {
    const deal = dealCharacters(ids, `baron-seed-${seed}`);
    const chars = Object.values(deal.characters);
    if (!chars.includes('baron')) continue;
    found = true;
    const counts = { townsfolk: 0, outsider: 0 };
    for (const c of chars) {
      const team = CHARACTERS[c].team;
      if (team === 'townsfolk') counts.townsfolk++;
      if (team === 'outsider') counts.outsider++;
    }
    const [tf, out] = DISTRIBUTION[9];
    assert.equal(counts.outsider, out + 2);
    assert.equal(counts.townsfolk, tf - 2);
  }
  assert.ok(found, 'expected to find a Baron within 200 seeds');
});

test("the Drunk's fake token is excluded from play and from the Demon's bluffs", () => {
  const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
  let found = false;
  for (let seed = 0; seed < 300 && !found; seed++) {
    const deal = dealCharacters(ids, `drunk-seed-${seed}`);
    const chars = Object.values(deal.characters);
    if (!chars.includes('drunk')) continue;
    found = true;
    const drunkId = Object.keys(deal.characters).find((id) => deal.characters[id] === 'drunk')!;
    const fake = deal.perceived[drunkId];
    assert.notEqual(fake, 'drunk');
    assert.ok(!chars.includes(fake), 'the fake token must not be held by any real player');
    assert.ok(!deal.bluffs.includes(fake), "the fake token must not double as a Demon bluff");
  }
  assert.ok(found, 'expected to find a Drunk within 300 seeds');
});

test('the Fortune Teller red herring is a good player when one exists', () => {
  const ids = Array.from({ length: 7 }, (_, i) => `p${i}`);
  const deal = dealCharacters(ids, 'herring-seed');
  if (deal.redHerringId) {
    const team = CHARACTERS[deal.characters[deal.redHerringId]].team;
    assert.ok(team === 'townsfolk' || team === 'outsider');
  }
});
