import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castVote, closeVote, nominate, requestEndDay, useSlayer } from '../game/engine.js';
import { mkDay } from './helpers.js';

test('vote below majority does not put anyone on the block', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']); // 6 alive, majority=4
  const [a, , c] = s.players;
  nominate(s, a.id, c.id);
  castVote(s, a.id, true);
  castVote(s, c.id, true);
  closeVote(s);
  assert.equal(s.onBlockId, null);
});

test('a strictly higher later nomination overtakes the block; a tie clears it', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']); // majority=4
  const [a, b, c, d, e] = s.players;

  nominate(s, a.id, b.id);
  [a, c, d, e].forEach((p) => castVote(s, p.id, true)); // 4 yes -> on the block
  closeVote(s);
  assert.equal(s.onBlockId, b.id);

  nominate(s, b.id, c.id);
  [a, c, d].forEach((p) => castVote(s, p.id, true)); // 3 yes, below the current highest
  closeVote(s);
  assert.equal(s.onBlockId, b.id, 'a lower vote count must not replace the block');

  nominate(s, c.id, d.id);
  [a, c, d, e].forEach((p) => castVote(s, p.id, true)); // ties the current highest (4)
  closeVote(s);
  assert.equal(s.onBlockId, null, 'a tie must clear the block');
});

test('ending the day executes whoever is on the block and starts the next night', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [a, b, c, d, e] = s.players;
  nominate(s, a.id, b.id);
  [a, c, d, e].forEach((p) => castVote(s, p.id, true));
  closeVote(s);
  assert.equal(s.onBlockId, b.id);

  requestEndDay(s);
  assert.equal(b.alive, false);
  assert.equal(s.phase, 'night');
  assert.equal(s.night, 1);
});

test('nominating a working Virgin with a Townsfolk nominator executes the nominator instantly', () => {
  const s = mkDay(['imp', 'virgin', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [, virgin, empath] = s.players;
  nominate(s, empath.id, virgin.id);
  assert.equal(empath.alive, false);
  assert.equal(s.currentNomination, null);
  assert.equal(virgin.virginUsed, true);
});

test('a Virgin nominated by an evil player does not proc', () => {
  const s = mkDay(['imp', 'virgin', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, virgin] = s.players;
  nominate(s, imp.id, virgin.id);
  assert.equal(imp.alive, true);
  assert.ok(s.currentNomination, 'should proceed to a normal vote since the nominator is evil');
});

test('Slayer hitting the real Demon kills them and ends the game for good', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, slayer] = s.players;
  useSlayer(s, slayer.id, imp.id);
  assert.equal(imp.alive, false);
  assert.equal(s.winner, 'good');
});

test('Slayer missing does nothing and can only be used once', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, slayer, empath] = s.players;
  useSlayer(s, slayer.id, empath.id);
  assert.equal(empath.alive, true);
  assert.equal(s.winner, null);
  assert.throws(() => useSlayer(s, slayer.id, imp.id));
});

test("a Butler's yes vote is dropped if their master hasn't also voted yes", () => {
  const s = mkDay(['imp', 'butler', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, butler, empath] = s.players;
  s.butlerMasterId = empath.id;
  nominate(s, imp.id, empath.id);
  castVote(s, butler.id, true);
  closeVote(s);
  assert.equal(s.onBlockId, null, "the Butler's lone yes vote should not count");
});

test("a Butler's yes vote counts once their master also votes yes", () => {
  const s = mkDay(['imp', 'butler', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, butler, empath, investigator, washerwoman, soldier] = s.players;
  s.butlerMasterId = empath.id;
  nominate(s, imp.id, soldier.id);
  castVote(s, butler.id, true);
  castVote(s, empath.id, true);
  castVote(s, investigator.id, true);
  castVote(s, washerwoman.id, true);
  closeVote(s);
  assert.equal(s.onBlockId, soldier.id);
});

test('Mayor wins for good if no execution happens with exactly 3 players left', () => {
  const s = mkDay(['imp', 'mayor', 'soldier']);
  requestEndDay(s);
  assert.equal(s.winner, 'good');
  assert.equal(s.phase, 'ended');
});

test('executing the Saint ends the game for evil immediately', () => {
  const s = mkDay(['imp', 'saint', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, saint, empath, investigator, washerwoman] = s.players;
  nominate(s, imp.id, saint.id);
  [imp, empath, investigator, washerwoman].forEach((p) => castVote(s, p.id, true));
  closeVote(s);
  assert.equal(s.onBlockId, saint.id);

  requestEndDay(s);
  assert.equal(s.winner, 'evil');
  assert.equal(s.phase, 'ended');
});
