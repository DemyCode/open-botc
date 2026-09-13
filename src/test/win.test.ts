import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castVote, closeVote, nominate, requestEndDay } from '../game/engine.js';
import { mkDay } from './helpers.js';

test('good wins once the Demon is executed', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']); // 5 alive, majority=3
  const [imp, empath, investigator, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  [empath, investigator, washerwoman].forEach((p) => castVote(s, p.id, true));
  closeVote(s);
  requestEndDay(s);
  assert.equal(s.winner, 'good');
});

test('evil wins when only 2 players remain alive alongside a living Demon', () => {
  const s = mkDay(['imp', 'poisoner', 'empath']); // 3 alive, majority=2
  const [imp, poisoner, empath] = s.players;
  nominate(s, imp.id, empath.id);
  castVote(s, imp.id, true);
  castVote(s, poisoner.id, true);
  closeVote(s);
  requestEndDay(s);
  assert.equal(s.winner, 'evil');
  assert.equal(empath.alive, false);
});

test('Scarlet Woman is promoted to Imp when the Demon dies with 5+ players alive', () => {
  const s = mkDay(['imp', 'scarletwoman', 'empath', 'investigator', 'washerwoman', 'soldier']); // 6 alive, majority=4
  const [imp, scarletwoman, empath, investigator, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  [empath, investigator, washerwoman, scarletwoman].forEach((p) => castVote(s, p.id, true));
  closeVote(s);
  requestEndDay(s);
  assert.equal(scarletwoman.character, 'imp');
  assert.equal(s.winner, null, 'evil still has a demon in play, the game continues');
});
