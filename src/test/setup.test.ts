import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHARACTERS,
  DISTRIBUTION,
  MAX_PLAYERS,
  MIN_PLAYERS,
  charsOfTeam,
} from '../game/characters.js';
import { addPlayer, createGame, startGame } from '../game/engine.js';
import { dealCharacters } from '../game/setup.js';
import type { GameState } from '../game/types.js';

function lobby(n: number, seed?: number): GameState {
  const s = createGame('TEST');
  if (seed !== undefined) s.rng = seed;
  for (let i = 0; i < n; i++) addPlayer(s, `P${i}`);
  return s;
}

describe('setup', () => {
  it('deals the official team split for every supported player count', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      for (let seed = 0; seed < 40; seed++) {
        const s = lobby(n, seed * 7919 + 13);
        const deal = dealCharacters(s, s.players);
        const [tf, out, min, dem] = DISTRIBUTION[n];

        assert.equal(deal.inPlay.length, n, `n=${n} seed=${seed}: dealt ${deal.inPlay.length}`);
        assert.equal(deal.counts.demon, dem);
        assert.equal(deal.counts.minion, min);

        const baron = deal.inPlay.includes('baron');
        assert.equal(deal.counts.outsider, out + (baron ? 2 : 0), `n=${n} outsiders`);
        assert.equal(deal.counts.townsfolk, tf - (baron ? 2 : 0), `n=${n} townsfolk`);
      }
    }
  });

  it('never deals the same character twice', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = lobby(12, seed * 104729 + 1);
      const deal = dealCharacters(s, s.players);
      assert.equal(new Set(deal.inPlay).size, deal.inPlay.length);
    }
  });

  it('gives the Drunk an extra Townsfolk token that nobody else holds', () => {
    let seen = 0;
    for (let seed = 0; seed < 400 && seen < 20; seed++) {
      const s = lobby(9, seed * 2654435761 + 3);
      const deal = dealCharacters(s, s.players);
      if (!deal.inPlay.includes('drunk')) continue;
      seen++;

      assert.ok(deal.drunkFake, 'drunk should have a fake token');
      assert.equal(CHARACTERS[deal.drunkFake!].team, 'townsfolk');
      assert.ok(
        !deal.inPlay.includes(deal.drunkFake!),
        'the fake Townsfolk must not also be genuinely in play',
      );

      const drunkId = Object.keys(deal.assignments).find(
        (id) => deal.assignments[id] === 'drunk',
      )!;
      assert.equal(deal.perceived[drunkId], deal.drunkFake);
    }
    assert.ok(seen > 0, 'expected the Drunk to come up at least once');
  });

  it('every non-Drunk player believes their real character', () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = lobby(11, seed * 40503 + 7);
      const deal = dealCharacters(s, s.players);
      for (const [id, real] of Object.entries(deal.assignments)) {
        if (real === 'drunk') continue;
        assert.equal(deal.perceived[id], real);
      }
    }
  });

  it('demon bluffs are good characters that are not in play', () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = lobby(10, seed * 22695477 + 11);
      const deal = dealCharacters(s, s.players);
      assert.equal(deal.demonBluffs.length, 3);
      for (const b of deal.demonBluffs) {
        const team = CHARACTERS[b].team;
        assert.ok(team === 'townsfolk' || team === 'outsider', `${b} is not good`);
        assert.ok(!deal.inPlay.includes(b), `${b} is in play but offered as a bluff`);
        assert.notEqual(b, deal.drunkFake, 'the Drunk token cannot be a bluff');
      }
    }
  });

  it('picks a red herring exactly when a Fortune Teller is in play', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = lobby(8, seed * 69069 + 5);
      const deal = dealCharacters(s, s.players);
      if (deal.inPlay.includes('fortuneteller')) {
        assert.ok(deal.redHerring, 'FT in play but no red herring');
        const real = deal.assignments[deal.redHerring!];
        const team = CHARACTERS[real].team;
        assert.ok(team === 'townsfolk' || team === 'outsider', 'red herring must be good');
      } else {
        assert.equal(deal.redHerring, null);
      }
    }
  });

  it('the Baron makes room by removing Townsfolk, never overflowing Outsiders', () => {
    const allOutsiders = charsOfTeam('outsider').length;
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const withBaron = DISTRIBUTION[n][1] + 2;
      assert.ok(
        withBaron <= allOutsiders,
        `n=${n}: Baron would need ${withBaron} Outsiders, only ${allOutsiders} exist`,
      );
    }
  });

  it('refuses to start below the minimum player count', () => {
    const s = lobby(4);
    assert.throws(() => startGame(s, s.hostId), /at least 5/i);
  });

  it('assigns alignment from the dealt team', () => {
    const s = lobby(13);
    startGame(s, s.hostId);
    for (const p of s.players) {
      const team = CHARACTERS[p.character!].team;
      const expected = team === 'minion' || team === 'demon' ? 'evil' : 'good';
      assert.equal(p.alignment, expected);
    }
    assert.equal(s.players.filter((p) => p.alignment === 'evil').length, 4);
  });
});
