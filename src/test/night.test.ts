import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceUntil, answerRealTurn, byChar, byPerceived, mk, runFullNight, skipRound, startNight } from './helpers.js';

test('every living player is covered exactly once by every night round (real xor decoy)', () => {
  const state = mk([
    'poisoner', 'imp', 'monk', 'empath', 'fortuneteller', 'washerwoman',
    'librarian', 'investigator', 'chef', 'undertaker', 'virgin', 'soldier',
  ]);
  startNight(state);

  let rounds = 0;
  while (state.phase === 'night') {
    const realIds = state.pendingRealTurn ? state.pendingRealTurn.playerIds : [];
    const decoyIds = state.pendingDecoy ? state.pendingDecoy.playerIds : [];
    const alive = state.players.filter((p) => p.alive).map((p) => p.id);

    // no overlap between real actors and decoy recipients this round
    for (const id of realIds) assert.ok(!decoyIds.includes(id), `${id} is both real and decoy in the same round`);

    // every living player is covered by this round, one way or the other
    const covered = new Set([...realIds, ...decoyIds]);
    for (const id of alive) assert.ok(covered.has(id), `${id} was left out of a night round entirely`);

    rounds++;
    skipRound(state);
  }
  assert.ok(rounds > 0, 'expected at least one night round to fire');
});

test('Ravenkeeper only gets a real turn the night they die, otherwise decoy', () => {
  const state = mk(['imp', 'ravenkeeper', 'monk', 'poisoner', 'empath', 'soldier']);
  startNight(state); // night 1 — ravenkeeper never appears in the first-night sequence at all
  let steps = 0;
  while (state.phase === 'night' && steps < 20) {
    if (state.pendingRealTurn) assert.notEqual(state.pendingRealTurn.charId, 'ravenkeeper');
    skipRound(state);
    steps++;
  }
  assert.equal(state.phase, 'day');

  // Force it to be day, then a fresh night where the Imp kills the Ravenkeeper.
  startNight(state); // night 2
  const rk = byChar(state, 'ravenkeeper');
  advanceUntil(state, 'imp');
  answerRealTurn(state, [rk.id]);

  assert.ok(state.pendingRealTurn, 'expected a round after the imp kill');
  assert.equal(state.pendingRealTurn!.charId, 'ravenkeeper');
  assert.deepEqual(state.pendingRealTurn!.playerIds, [rk.id]);
});

test('the Drunk gets a real-shaped turn on their fake character schedule, but the ability never really works', () => {
  const state = mk(['imp', 'drunk', 'monk', 'poisoner', 'soldier', 'saint'], { drunkFakeChar: 'empath' });
  startNight(state);
  advanceUntil(state, 'empath');
  const t = state.pendingRealTurn!;
  const drunk = byPerceived(state, 'empath');
  assert.deepEqual(t.playerIds, [drunk.id]);
  assert.equal(t.shape, 'info');
  // fabricated info was already written to their log at round-start time
  assert.equal(drunk.log.at(-1)?.night, state.night);
});

test("a poisoned Monk's protection silently fails", () => {
  const state = mk(['imp', 'monk', 'poisoner', 'empath', 'soldier', 'saint']);
  startNight(state); // night 1 — Monk has no first-night action
  runFullNight(state);
  startNight(state); // night 2 — Monk can now act

  const monk = byChar(state, 'monk');
  const empath = byChar(state, 'empath');

  advanceUntil(state, 'poisoner');
  answerRealTurn(state, [monk.id]); // poisoner poisons the monk

  advanceUntil(state, 'monk');
  answerRealTurn(state, [empath.id]); // poisoned monk "protects" empath — should not actually work

  assert.equal(state.monkProtectedId, null, 'a poisoned Monk should not successfully protect anyone');
});
