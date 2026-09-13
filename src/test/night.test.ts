import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import { submitRealResponse } from '../game/night.js';
import { advanceUntil, answerRealTurn, byChar, byPerceived, mk, runFullNight, skipRound, startNight } from './helpers.js';

test('a night round only ever involves the actual actor(s) for that character', () => {
  const state = mk([
    'poisoner', 'imp', 'monk', 'empath', 'fortuneteller', 'washerwoman',
    'librarian', 'investigator', 'chef', 'undertaker', 'virgin', 'soldier',
  ]);
  startNight(state);

  let rounds = 0;
  while (state.phase === 'night') {
    const t = state.pendingRealTurn;
    if (t) {
      const actuallyHoldIt =
        t.charId === 'minion-info'
          ? state.players.filter((p) => p.alive && CHARACTERS[p.character].team === 'minion').map((p) => p.id)
          : state.players.filter((p) => p.alive && p.perceived === t.charId).map((p) => p.id);
      assert.deepEqual(new Set(t.playerIds), new Set(actuallyHoldIt), `round for ${t.charId} should exactly match its real holders`);
    }
    rounds++;
    skipRound(state);
  }
  assert.ok(rounds > 0, 'expected at least one night round to fire');
});

test('Ravenkeeper only gets a real turn the night they die', () => {
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

test('Fortune Teller: the result of choosing is available immediately, not just in the permanent log', () => {
  // Regression test: choosing 2 players used to only write the answer to the player's permanent
  // log (only visible later, during the day) — their screen showed nothing right after
  // answering, which is the bug this covers.
  const state = mk(['imp', 'fortuneteller', 'empath', 'soldier', 'washerwoman']);
  startNight(state);
  const ft = byChar(state, 'fortuneteller');
  const imp = byChar(state, 'imp');
  const empath = byChar(state, 'empath');

  advanceUntil(state, 'fortuneteller');
  submitRealResponse(state, ft.id, [imp.id, empath.id]);

  // Fortune Teller is the only holder of this round, so it has already advanced by now — the
  // result must survive on the player, not the (already-replaced) round object.
  assert.match(ft.nightResult ?? '', /^Yes/);
  assert.equal(ft.nightResult, ft.log.at(-1)?.text, 'the immediate result should match what was logged');
});

test('Ravenkeeper: the result of choosing is available immediately, not just in the permanent log', () => {
  const state = mk(['imp', 'ravenkeeper', 'chef', 'soldier', 'washerwoman']);
  startNight(state);
  runFullNight(state);
  startNight(state); // night 2
  const rk = byChar(state, 'ravenkeeper');
  const chef = byChar(state, 'chef');

  advanceUntil(state, 'imp');
  answerRealTurn(state, [rk.id]); // kill the ravenkeeper

  advanceUntil(state, 'ravenkeeper');
  submitRealResponse(state, rk.id, [chef.id]);

  assert.equal(rk.nightResult, `${chef.name} is the Chef.`);
});

test('diedTonight only reflects the most recently completed night, not any death ever', () => {
  // Regression coverage for the dawn-message feature: diedTonight used to be set on death and
  // never reset, so it would stay true forever after whichever night someone actually died —
  // making a dawn "You died tonight" message impossible to compute correctly on a later night.
  const state = mk(['imp', 'ravenkeeper', 'chef', 'soldier', 'washerwoman', 'poisoner']);
  startNight(state);
  runFullNight(state);
  startNight(state); // night 2

  const rk = byChar(state, 'ravenkeeper');
  advanceUntil(state, 'imp');
  answerRealTurn(state, [rk.id]); // kill the ravenkeeper
  assert.equal(rk.diedTonight, true, 'should be true on the night they actually died');

  runFullNight(state);
  startNight(state); // night 3 — a night where the (already dead) ravenkeeper does nothing

  assert.equal(rk.diedTonight, false, 'must be reset by a later night, even though they stayed dead');
  assert.equal(rk.alive, false, 'staying dead is unaffected by the diedTonight reset');
});
