import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castVote, nominate, requestEndDay, skipSpeech, useSlayer } from '../game/engine.js';
import { fastForwardToVote, mkDay, voteInOrder } from './helpers.js';

test('vote below majority does not put anyone on the block', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']); // 6 alive, majority=4
  const [a, , c] = s.players;
  nominate(s, a.id, c.id);
  fastForwardToVote(s);
  voteInOrder(s, [a.id, c.id]); // only 2 yes
  assert.equal(s.onBlockId, null);
});

test('a strictly higher later nomination overtakes the block; a tie clears it', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']); // majority=4
  const [a, b, c, d, e] = s.players;

  nominate(s, a.id, b.id);
  fastForwardToVote(s);
  voteInOrder(s, [a.id, c.id, d.id, e.id]); // 4 yes -> on the block
  assert.equal(s.onBlockId, b.id);

  nominate(s, b.id, c.id);
  fastForwardToVote(s);
  voteInOrder(s, [a.id, c.id, d.id]); // 3 yes, below the current highest
  assert.equal(s.onBlockId, b.id, 'a lower vote count must not replace the block');

  nominate(s, c.id, d.id);
  fastForwardToVote(s);
  voteInOrder(s, [a.id, c.id, d.id, e.id]); // ties the current highest (4)
  assert.equal(s.onBlockId, null, 'a tie must clear the block');
});

test('ending the day executes whoever is on the block and starts the next night', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [a, b, c, d, e] = s.players;
  nominate(s, a.id, b.id);
  fastForwardToVote(s);
  voteInOrder(s, [a.id, c.id, d.id, e.id]);
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
  assert.ok(s.currentNomination, 'should proceed to a normal accusation since the nominator is evil');
  assert.equal(s.currentNomination?.state, 'accusing');
});

test('the nomination goes through accusing -> defending -> voting, and only the current speaker can skip', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [, poisoner, empath] = s.players;
  nominate(s, poisoner.id, empath.id);
  assert.equal(s.currentNomination?.state, 'accusing');

  assert.throws(() => skipSpeech(s, empath.id), 'the accused should not be able to skip the accusation');
  skipSpeech(s, poisoner.id); // the accuser ends their own speech early
  assert.equal(s.currentNomination?.state, 'defending');

  assert.throws(() => skipSpeech(s, poisoner.id), 'the accuser should not be able to skip the defense');
  skipSpeech(s, empath.id); // the accused ends their own defense early
  assert.equal(s.currentNomination?.state, 'voting');
  assert.ok(s.currentNomination?.currentVoterId, 'voting should start on the first eligible voter');
});

test('the host has no authority to skip someone else\'s speech — only the speaker themselves can', () => {
  // Regression test: the host used to be able to cut off the accused's defense (or the
  // accuser's speech) early, even when they were neither party. The host is just whoever
  // happened to create the room, not a storyteller with power over other players' turns.
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [host, poisoner, empath] = s.players; // host (imp) is neither the accuser nor the accused
  nominate(s, poisoner.id, empath.id);

  assert.throws(() => skipSpeech(s, host.id), "the host should not be able to skip the accuser's speech");
  skipSpeech(s, poisoner.id);
  assert.equal(s.currentNomination?.state, 'defending');

  assert.throws(() => skipSpeech(s, host.id), "the host should not be able to skip the accused's defense");
  skipSpeech(s, empath.id);
  assert.equal(s.currentNomination?.state, 'voting');
});

test('votes go around the circle in order, one at a time', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [, poisoner, empath] = s.players;
  nominate(s, poisoner.id, empath.id);
  fastForwardToVote(s);
  const nom = s.currentNomination!;
  const firstVoter = nom.currentVoterId!;
  assert.throws(
    () => castVote(s, s.players.find((p) => p.id !== firstVoter)!.id, true),
    'only the current voter may cast a vote'
  );
  castVote(s, firstVoter, true);
  assert.notEqual(s.currentNomination?.currentVoterId, firstVoter, 'the turn should advance to the next voter');
});

test('a vote cannot be force-closed early — it always runs the full circle, even once majority is reached', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']); // majority=4
  const [, poisoner, empath] = s.players;
  nominate(s, poisoner.id, empath.id);
  fastForwardToVote(s);
  // 4 yes votes already reaches majority, but the circle must still ask the remaining 2 players.
  for (let i = 0; i < 4; i++) castVote(s, s.currentNomination!.currentVoterId!, true);
  assert.ok(s.currentNomination, 'the vote must not resolve before every player has been asked');
  assert.equal(s.currentNomination?.state, 'voting');

  voteInOrder(s, []); // finish the circle, voting no for whoever's left
  assert.equal(s.onBlockId, empath.id);
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
  fastForwardToVote(s);
  voteInOrder(s, [butler.id]); // butler votes yes, master (empath, the nominee) never votes yes
  assert.equal(s.onBlockId, null, "the Butler's lone yes vote should not count");
});

test("a Butler's yes vote counts once their master also votes yes", () => {
  const s = mkDay(['imp', 'butler', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, butler, empath, investigator, washerwoman, soldier] = s.players;
  s.butlerMasterId = empath.id;
  nominate(s, imp.id, soldier.id);
  fastForwardToVote(s);
  voteInOrder(s, [butler.id, empath.id, investigator.id, washerwoman.id]);
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
  fastForwardToVote(s);
  voteInOrder(s, [imp.id, empath.id, investigator.id, washerwoman.id]);
  assert.equal(s.onBlockId, saint.id);

  requestEndDay(s);
  assert.equal(s.winner, 'evil');
  assert.equal(s.phase, 'ended');
});
