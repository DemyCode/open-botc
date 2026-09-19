import assert from 'node:assert/strict';
import { poisonedId } from './helpers.js';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import { submitRealResponse } from '../game/night.js';
import { tick } from '../game/engine.js';
import { viewFor } from '../game/view.js';
import { advanceUntil, answerRealTurn, breakDawn, byChar, byPerceived, mk, runFullNight, skipRound, startNight } from './helpers.js';

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

  assert.equal(state.data.monkProtectedId, null, 'a poisoned Monk should not successfully protect anyone');
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
  assert.equal(ft.nightResult?.key, 'fortuneTellerYes');
  assert.deepEqual(ft.nightResult, ft.log.at(-1)?.msg, 'the immediate result should match what was logged');
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

  assert.deepEqual(rk.nightResult, { key: 'ravenkeeperInfo', vars: { name: chef.name, role: 'chef' } });
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

test('Fortune Teller may legally target a dead player', () => {
  // Regression: the generic choose-shape target validation required every target to be alive,
  // but the Fortune Teller is explicitly allowed to check a corpse.
  const state = mk(['imp', 'fortuneteller', 'empath', 'soldier', 'washerwoman']);
  const empath = byChar(state, 'empath');
  empath.alive = false; // already dead from an earlier day
  startNight(state);
  const ft = byChar(state, 'fortuneteller');
  const soldier = byChar(state, 'soldier');
  advanceUntil(state, 'fortuneteller');
  assert.doesNotThrow(() => submitRealResponse(state, ft.id, [empath.id, soldier.id]));
});

test('Ravenkeeper may legally target a different dead player, not just themselves', () => {
  // Regression: only self-targeting was ever possible for a dead actor under the old validation
  // (`id !== playerId` was the only exception to "must be alive") — a second dead player could
  // never be legally chosen.
  const state = mk(['imp', 'ravenkeeper', 'chef', 'soldier', 'washerwoman']);
  startNight(state);
  runFullNight(state);
  startNight(state); // night 2
  const rk = byChar(state, 'ravenkeeper');
  const chef = byChar(state, 'chef');
  chef.alive = false; // some other player who died on an earlier day
  advanceUntil(state, 'imp');
  answerRealTurn(state, [rk.id]); // kill the ravenkeeper so they get their triggered turn
  advanceUntil(state, 'ravenkeeper');
  assert.doesNotThrow(() => submitRealResponse(state, rk.id, [chef.id]));
  assert.deepEqual(rk.nightResult, { key: 'ravenkeeperInfo', vars: { name: chef.name, role: 'chef' } });
});

test('Butler may legally choose a dead player as their master', () => {
  const state = mk(['imp', 'butler', 'empath', 'soldier', 'washerwoman']);
  const empath = byChar(state, 'empath');
  empath.alive = false;
  startNight(state);
  const butler = byChar(state, 'butler');
  advanceUntil(state, 'butler');
  assert.doesNotThrow(() => submitRealResponse(state, butler.id, [empath.id]));
  assert.equal(state.data.butlerMasterId, empath.id);
});

test('a night result is still delivered even when answering was the very last action of the whole night', () => {
  // Regression: the view used to hide nightResult once the phase left 'night'. If a player's
  // choose-and-get-a-result turn (Fortune Teller, Ravenkeeper) happened to be the last action
  // left for anyone that night, finishNight() ran synchronously in the same call, so the very
  // same response that produced the result also flipped the phase to 'day' before it was ever
  // shown — the player never saw their answer at all.
  const s = mk(['fortuneteller', 'imp', 'empath', 'soldier', 'washerwoman']); // no butler/undertaker/spy: nobody acts after the Fortune Teller
  startNight(s);
  runFullNight(s);
  startNight(s); // night 2
  const imp = byChar(s, 'imp');
  const empath = byChar(s, 'empath');
  const ft = byChar(s, 'fortuneteller');
  const soldier = byChar(s, 'soldier');

  advanceUntil(s, 'imp');
  answerRealTurn(s, [soldier.id]); // Soldier is immune, but the round still completes normally
  advanceUntil(s, 'empath');
  answerRealTurn(s, []); // info-shape round, just needs acknowledging
  advanceUntil(s, 'fortuneteller');
  submitRealResponse(s, ft.id, [imp.id, empath.id]); // the last real actor of the whole night
  while (s.pendingRealTurn) skipRound(s); // everyone else's decoys, then the remaining steps
  breakDawn(s);

  assert.equal(s.phase, 'day');
  const view = viewFor(s, ft.id);
  assert.equal(view.phase, 'day');
  assert.ok(view.nightResult, 'the Fortune Teller must still receive her result even though the phase already moved to day');
  assert.equal(view.nightResult?.key, 'fortuneTellerYes');
});

test("a player killed earlier the same night still appears alive in the Fortune Teller's choice list — not revealed before dawn", () => {
  // Regression: the choice list's "alive" flag came straight from the live data model, so a
  // player the Imp killed earlier the same night (a correct, earlier step in the night order)
  // showed up labeled "(dead)" to the Fortune Teller acting right after — leaking a death nobody
  // is supposed to know about yet.
  const s = mk(['imp', 'fortuneteller', 'empath', 'soldier', 'washerwoman']);
  startNight(s);
  runFullNight(s);
  startNight(s); // night 2
  const empath = byChar(s, 'empath');
  const ft = byChar(s, 'fortuneteller');

  advanceUntil(s, 'imp');
  answerRealTurn(s, [empath.id]); // kill empath — this correctly happens before the Fortune Teller's turn
  assert.equal(empath.alive, false);

  advanceUntil(s, 'fortuneteller');
  const view = viewFor(s, ft.id);
  const empathChoice = view.nightTurn?.choices.find((c) => c.id === empath.id);
  assert.ok(empathChoice, 'the freshly-killed player must still be offered as a choice');
  assert.equal(empathChoice.alive, true, 'must not be labeled dead — that has not been revealed yet');
});

test('a player who died on an earlier night correctly still shows as dead in a later choice list', () => {
  const s = mk(['imp', 'fortuneteller', 'empath', 'soldier', 'washerwoman']);
  const empath = byChar(s, 'empath');
  empath.alive = false;
  empath.diedTonight = false; // died (and was revealed) on some earlier night
  startNight(s);
  const ft = byChar(s, 'fortuneteller');
  advanceUntil(s, 'fortuneteller');
  const view = viewFor(s, ft.id);
  const empathChoice = view.nightTurn?.choices.find((c) => c.id === empath.id);
  assert.ok(empathChoice);
  assert.equal(empathChoice.alive, false, 'a death from an earlier night is already public knowledge');
});

test('the Poisoner may target a dead player — "any player" at night includes the dead (it just does nothing)', () => {
  const state = mk(['imp', 'poisoner', 'monk', 'empath', 'soldier', 'washerwoman']);
  const empath = byChar(state, 'empath');
  empath.alive = false;
  startNight(state);
  const poisoner = byChar(state, 'poisoner');
  advanceUntil(state, 'poisoner');
  submitRealResponse(state, poisoner.id, [empath.id]);
  assert.equal(poisonedId(state), empath.id);
});

test('a night turn never times out — the night waits for a real answer however long it takes', () => {
  // Regression: an unanswered turn used to be auto-answered (random targets) after 60s.
  const state = mk(['imp', 'monk', 'empath', 'washerwoman', 'soldier', 'poisoner']);
  startNight(state);
  const t = state.pendingRealTurn!;
  assert.ok(t, 'expected a pending real turn');
  tick(state, Date.now() + 24 * 60 * 60 * 1000); // a whole day later
  assert.equal(state.phase, 'night');
  assert.equal(state.pendingRealTurn, t, 'the same turn must still be waiting');
  assert.deepEqual(t.responses, {}, 'nobody may be answered for automatically');
});

test('a night lasts at least 30 seconds, even when nobody really acts', () => {
  const s = mk(['imp', 'soldier', 'mayor', 'virgin', 'saint']); // 5 players, nobody acts on night 1
  const before = Date.now();
  startNight(s);
  while (s.pendingRealTurn) skipRound(s); // only decoys tonight
  assert.equal(s.phase, 'night', 'even a night where nobody acts does not end instantly');
  assert.ok(s.dawnAt! >= before + 30_000, 'a night lasts at least 30 seconds');
  tick(s, s.dawnAt! - 1);
  assert.equal(s.phase, 'night', 'not a moment early');
  tick(s, s.dawnAt!);
  assert.equal(s.phase, 'day');
});

test('dawn after a long night: the day starts the moment the last answer lands — no extra wait', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  startNight(s);
  s.nightStartedAt = Date.now() - 10 * 60_000; // the night has already lasted 10 minutes
  while (s.pendingRealTurn) skipRound(s);
  assert.equal(s.phase, 'day', 'no pause between the last answer and the day');
  assert.equal(s.day, 1);
  assert.equal(s.dawnAt, null);
});
