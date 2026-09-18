import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castVote, markReadyForSpeech, nominate, skipSpeech, toggleEndDayRequest, useSlayer } from '../game/engine.js';
import {
  advanceUntil, answerRealTurn, byChar, endDayByConsensus, fastForwardToVote,
  markAllReady, mk, mkDay, runFullNight, startNight, voteInOrder,
} from './helpers.js';

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

  endDayByConsensus(s);
  assert.equal(b.alive, false);
  assert.equal(s.phase, 'night');
  assert.equal(s.night, 2);
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
  assert.equal(s.currentNomination?.state, 'readyForAccusation');
  markAllReady(s);
  assert.equal(s.currentNomination?.state, 'accusing');
});

test('the nomination goes through ready -> accusing -> defending -> voting, and only the current speaker can skip', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [, poisoner, empath] = s.players;
  nominate(s, poisoner.id, empath.id);
  assert.equal(s.currentNomination?.state, 'readyForAccusation');
  markAllReady(s);
  assert.equal(s.currentNomination?.state, 'accusing');

  assert.throws(() => skipSpeech(s, empath.id), 'the accused should not be able to skip the accusation');
  skipSpeech(s, poisoner.id); // the accuser ends their own speech early
  assert.equal(s.currentNomination?.state, 'defending', 'the defense follows at once — no second "ready" step');

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
  markAllReady(s);

  assert.throws(() => skipSpeech(s, host.id), "the host should not be able to skip the accuser's speech");
  skipSpeech(s, poisoner.id);
  assert.equal(s.currentNomination?.state, 'defending');

  assert.throws(() => skipSpeech(s, host.id), "the host should not be able to skip the accused's defense");
  skipSpeech(s, empath.id);
  assert.equal(s.currentNomination?.state, 'voting');
});

test('the speech timer does not start until everyone — including the dead — signals ready', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [a, b, c, d, e, f] = s.players;
  c.alive = false; // a dead player from an earlier day, still watching
  nominate(s, a.id, b.id);
  assert.equal(s.currentNomination?.state, 'readyForAccusation');

  markReadyForSpeech(s, a.id);
  markReadyForSpeech(s, b.id);
  markReadyForSpeech(s, d.id);
  markReadyForSpeech(s, e.id);
  markReadyForSpeech(s, f.id);
  assert.equal(s.currentNomination?.state, 'readyForAccusation', 'the dead player has not signaled ready yet');

  markReadyForSpeech(s, c.id); // the dead player finally signals ready too
  assert.equal(s.currentNomination?.state, 'accusing');
});

test('signaling ready twice withdraws it again', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [a, b] = s.players;
  nominate(s, a.id, b.id);
  markReadyForSpeech(s, a.id);
  markReadyForSpeech(s, a.id); // changed their mind
  assert.ok(!s.currentNomination?.readyBy.includes(a.id));
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

test('a Drunk who believes they are the Slayer can attempt the ability, but it never actually works', () => {
  // Regression: the check used the player's true character (always 'drunk', never 'slayer'),
  // so the Drunk could never even attempt the shot — even though the client already offers it
  // to them, since the client goes off `perceived`. abilityWorks() is what should make the
  // attempt silently fail, not an outright rejection.
  const s = mk(['imp', 'drunk', 'empath', 'soldier', 'washerwoman'], { drunkFakeChar: 'slayer' });
  s.phase = 'day';
  s.day = 1;
  const drunk = byChar(s, 'drunk');
  const imp = byChar(s, 'imp');
  assert.equal(drunk.perceived, 'slayer');
  assert.doesNotThrow(() => useSlayer(s, drunk.id, imp.id));
  assert.equal(imp.alive, true, "the Drunk's shot must never actually work, even against the real Demon");
  assert.equal(s.winner, null);
});

test('Mayor redirect can pick any eligible alternative, not always the same one', () => {
  // Regression: the redirect target was always the first eligible match in player order —
  // effectively the same player every time for a given seating, instead of a real choice.
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const s = mk(['imp', 'mayor', 'empath', 'investigator', 'washerwoman', 'soldier']);
    startNight(s);
    runFullNight(s);
    startNight(s); // night 2
    const imp = byChar(s, 'imp');
    const mayor = byChar(s, 'mayor');
    advanceUntil(s, 'imp');
    answerRealTurn(s, [mayor.id]);
    assert.notEqual(s.deathsTonight[0], mayor.id, 'a working Mayor redirect must never let the Mayor die directly');
    seen.add(s.deathsTonight[0]);
  }
  assert.ok(seen.size > 1, 'expected the redirect target to vary across trials, not always hit the same player');
});

test('regression: a player can still nominate even after every other living player has already nominated or been nominated', () => {
  // Old bug: the day auto-ended once every living player had done *at least one* of (nominate,
  // be nominated) — but someone who had only ever been a *nominee* so far still has their own
  // nomination available and must be allowed to use it. This auto-end heuristic has since been
  // removed entirely in favor of the explicit unanimous "ready to end the day" consensus, which
  // doesn't have this problem.
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator']);
  const [a, b, c, d] = s.players;
  nominate(s, a.id, b.id);
  fastForwardToVote(s);
  voteInOrder(s, []);
  nominate(s, c.id, d.id);
  fastForwardToVote(s);
  voteInOrder(s, []);

  assert.equal(s.phase, 'day', 'the day must not have auto-ended — b and d have never used their own nomination');
  assert.doesNotThrow(() => nominate(s, b.id, a.id), 'b has not yet nominated anyone and must still be able to');
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

test("a dead Butler's ghost vote is unrestricted — a dead player has no ability", () => {
  // Regression: abilityWorks() doesn't check `alive` (it mustn't — the Saint is checked after
  // dying, and dead-only actors like the Ravenkeeper still need it), so the Butler restriction
  // was being applied to a dead Butler too. Per the official ruling, a dead Butler votes freely.
  const s = mkDay(['imp', 'butler', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, butler, empath, investigator, , soldier] = s.players;
  butler.alive = false;
  s.butlerMasterId = investigator.id;
  nominate(s, imp.id, soldier.id);
  fastForwardToVote(s);
  voteInOrder(s, [butler.id, imp.id, empath.id]); // master (investigator) never votes yes
  assert.equal(s.onBlockId, soldier.id, "the dead Butler's vote must count even though their master didn't vote");
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
  endDayByConsensus(s);
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

  endDayByConsensus(s);
  assert.equal(s.winner, 'evil');
  assert.equal(s.phase, 'ended');
});

test('ending the day early requires every living player to agree, not just one', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b, c, d, e] = s.players;
  toggleEndDayRequest(s, a.id);
  toggleEndDayRequest(s, b.id);
  toggleEndDayRequest(s, c.id);
  toggleEndDayRequest(s, d.id);
  assert.equal(s.phase, 'day', 'the day must not end until everyone has agreed');

  toggleEndDayRequest(s, e.id); // the last holdout agrees
  assert.equal(s.phase, 'night', 'the day ends the moment the last living player agrees');
});

test('toggling end-day again withdraws your agreement', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b] = s.players;
  toggleEndDayRequest(s, a.id);
  toggleEndDayRequest(s, a.id); // change their mind
  toggleEndDayRequest(s, b.id);
  toggleEndDayRequest(s, s.players[2].id);
  toggleEndDayRequest(s, s.players[3].id);
  toggleEndDayRequest(s, s.players[4].id);
  assert.equal(s.phase, 'day', "a withdrawn agreement should not count toward the total");
});

test('only living players are required to agree, and dead players cannot vote to end the day', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [, , empath] = s.players;
  empath.alive = false; // e.g. already executed on a prior day

  assert.throws(() => toggleEndDayRequest(s, empath.id), 'a dead player cannot agree to end the day');

  const alive = s.players.filter((p) => p.alive);
  assert.equal(alive.length, 4);
  for (const p of alive.slice(0, -1)) toggleEndDayRequest(s, p.id);
  assert.equal(s.phase, 'day', 'the dead player is not required to agree, but the rest still are');
  toggleEndDayRequest(s, alive[alive.length - 1].id);
  assert.equal(s.phase, 'night', 'the day ends once every currently-living player has agreed');
});

test('a new nomination clears everyone\'s prior agreement to end the day', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b, c, d] = s.players;
  toggleEndDayRequest(s, a.id);
  toggleEndDayRequest(s, b.id);
  toggleEndDayRequest(s, c.id);
  assert.equal(s.endDayRequestedBy.length, 3);

  nominate(s, d.id, a.id);
  assert.equal(s.endDayRequestedBy.length, 0, 'a fresh nomination should reset everyone\'s agreement');
});

test('you cannot agree to end the day while a nomination is in progress', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b] = s.players;
  nominate(s, a.id, b.id);
  assert.throws(() => toggleEndDayRequest(s, a.id));
});
