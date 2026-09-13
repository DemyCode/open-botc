import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nominate } from '../game/engine.js';
import { advanceUntil, answerRealTurn, byChar, endDayByConsensus, fastForwardToVote, mk, mkDay, runFullNight, startNight, voteInOrder } from './helpers.js';

test('good wins once the Demon is executed', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']); // 5 alive, majority=3
  const [imp, empath, investigator, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id]);
  endDayByConsensus(s);
  assert.equal(s.winner, 'good');
});

test('evil wins when only 2 players remain alive alongside a living Demon', () => {
  const s = mkDay(['imp', 'poisoner', 'empath']); // 3 alive, majority=2
  const [imp, poisoner, empath] = s.players;
  nominate(s, imp.id, empath.id);
  fastForwardToVote(s);
  voteInOrder(s, [imp.id, poisoner.id]);
  endDayByConsensus(s);
  assert.equal(s.winner, 'evil');
  assert.equal(empath.alive, false);
});

test('Scarlet Woman is promoted to Imp when the Demon dies with 5+ players alive', () => {
  const s = mkDay(['imp', 'scarletwoman', 'empath', 'investigator', 'washerwoman', 'soldier']); // 6 alive, majority=4
  const [imp, scarletwoman, empath, investigator, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id, scarletwoman.id]);
  endDayByConsensus(s);
  assert.equal(scarletwoman.character, 'imp');
  assert.equal(s.winner, null, 'evil still has a demon in play, the game continues');
});

test('a night kill that drops the alive count to 2 ends the game immediately, without waiting for a day action', () => {
  // Regression: night-time kills never ran a win check at all — the game would silently continue
  // into a day phase with only 2 players left alive instead of ending the instant it happened.
  const s = mk(['imp', 'poisoner', 'empath']); // 3 players
  startNight(s); // night 1 — the Imp only gets info, no kill yet
  runFullNight(s);
  startNight(s); // night 2 — the Imp can now kill
  const empath = byChar(s, 'empath');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [empath.id]);
  assert.equal(empath.alive, false);
  assert.equal(s.winner, 'evil', 'only 2 players remain alive alongside a living Demon — evil must win right away');
  assert.equal(s.phase, 'ended', 'the game must not continue into a day phase after the win condition is met');
});

test('a star-pass with no other Minion left to promote ends the game for good immediately', () => {
  const s = mk(['imp', 'empath', 'soldier']); // no Minion in this game at all
  startNight(s);
  runFullNight(s);
  startNight(s); // night 2
  const imp = byChar(s, 'imp');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [imp.id]); // self-kill (star-pass attempt)
  assert.equal(imp.alive, false);
  assert.equal(s.players.some((p) => p.character === 'imp' && p.alive), false, 'there was no Minion to promote');
  assert.equal(s.winner, 'good', 'with no Demon left at all, good must win immediately, not on the next day action');
  assert.equal(s.phase, 'ended');
});

test("Scarlet Woman's promotion takes priority over the star-pass, and she learns her Minions/bluffs like any Demon would", () => {
  const s = mk(['imp', 'scarletwoman', 'poisoner', 'empath', 'investigator', 'washerwoman']); // 6 players
  s.bluffs = ['virgin', 'mayor', 'saint'];
  startNight(s);
  runFullNight(s);
  startNight(s); // night 2
  const imp = byChar(s, 'imp');
  const sw = byChar(s, 'scarletwoman');
  const poisoner = byChar(s, 'poisoner');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [imp.id]); // star-pass, but 5 players remain alive afterward and the Scarlet Woman is one of two Minions

  assert.equal(imp.alive, false);
  assert.equal(sw.character, 'imp', 'the Scarlet Woman, not a random Minion, must become the new Demon');
  assert.equal(sw.perceived, 'imp');
  assert.equal(poisoner.character, 'poisoner', 'the other Minion must not be promoted instead');
  assert.equal(s.winner, null, 'a Demon still exists (the promoted Scarlet Woman) — the game continues');
  assert.ok(
    sw.log.some((e) => e.msg.key === 'demonInfo'),
    'the newly-promoted Scarlet Woman must learn her Minions and bluffs, same as any Demon would'
  );
});

test('a present but ineligible Scarlet Woman (too few players left alive) does not block the star-pass fallback', () => {
  // She's still part of the random fallback pool (any living Minion, herself included) — the
  // point is only that her *ineligibility* (too few alive) must not prevent a promotion from
  // happening at all, not that she specifically must be skipped.
  const s = mk(['imp', 'scarletwoman', 'poisoner', 'empath']); // only 3 remain alive after the Imp dies — below the 5+ threshold
  startNight(s);
  runFullNight(s);
  startNight(s); // night 2
  const imp = byChar(s, 'imp');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [imp.id]);

  const newImp = s.players.find((p) => p.character === 'imp' && p.alive);
  assert.ok(newImp, 'the star-pass fallback must still promote someone so the game can continue');
  assert.equal(s.winner, null, 'a Demon exists again — evil has not lost, and only 3 remain so evil has not won either');
});
