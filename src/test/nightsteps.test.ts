// Everyone is woken at every step of the night order: the real actor gets their real screen,
// everyone else a decoy of the same shape, and nobody can answer before 5 seconds have passed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tick } from '../game/engine.js';
import { FIRST_NIGHT_SEQUENCE, MIN_ANSWER_MS, OTHER_NIGHT_SEQUENCE, submitRealResponse } from '../game/night.js';
import type { CharacterId, GameState } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { advanceUntil, answerDecoys, answerRealTurn, byChar, mk, runFullNight, skipRound, startNight } from './helpers.js';

/** Plays one night, recording what each player's screen looked like at every step. */
function screensTonight(s: GameState): Record<string, string[]> {
  const screens: Record<string, string[]> = {};
  while (s.phase === 'night' && s.pendingRealTurn) {
    for (const p of s.players) {
      const turn = viewFor(s, p.id).nightTurn;
      if (turn) (screens[p.id] ??= []).push(`${turn.stepKey}:${turn.shape}:${turn.min}-${turn.max}:${turn.choices.length}`);
    }
    skipRound(s);
  }
  return screens;
}

for (const chars of [
  ['imp', 'poisoner', 'empath', 'washerwoman', 'soldier'],
  ['imp', 'spy', 'fortuneteller', 'monk', 'butler', 'undertaker', 'chef'],
  ['imp', 'baron', 'saint', 'recluse', 'mayor', 'virgin', 'slayer', 'drunk'],
] as CharacterId[][]) {
  test(`every living player sees the exact same sequence of screens, whatever their character (${chars.join(', ')})`, () => {
    const s = mk(chars, { drunkFakeChar: 'empath' });
    for (let night = 1; night <= 2; night++) {
      startNight(s);
      const screens = screensTonight(s);
      const sequences = s.players.filter((p) => p.alive).map((p) => JSON.stringify(screens[p.id]));
      assert.equal(new Set(sequences).size, 1, `night ${night}: someone's screens differed from the others'`);
      const expected = night === 1 ? FIRST_NIGHT_SEQUENCE.length : OTHER_NIGHT_SEQUENCE.length;
      assert.equal(screens[s.players[0].id].length, expected, `night ${night}: one screen per step of the night order`);
      runFullNight(s);
    }
  });
}

test('every step of the night order runs every night, even for characters not in play', () => {
  const s = mk(['imp', 'soldier', 'mayor', 'virgin', 'saint']); // nobody here acts on the first night
  startNight(s);
  const steps: string[] = [];
  while (s.pendingRealTurn) {
    steps.push(s.pendingRealTurn.charId);
    assert.deepEqual(s.pendingRealTurn.playerIds, [], 'nobody really acts');
    skipRound(s);
  }
  assert.deepEqual(steps, FIRST_NIGHT_SEQUENCE);
});

test('a decoy screen looks like the real one: same shape, same choices, and never names the step', () => {
  const s = mk(['imp', 'poisoner', 'fortuneteller', 'washerwoman', 'soldier']);
  const ft = byChar(s, 'fortuneteller');
  const soldier = byChar(s, 'soldier');
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  const real = viewFor(s, ft.id).nightTurn!;
  const decoy = viewFor(s, soldier.id).nightTurn!;
  assert.equal(real.decoy, false);
  assert.equal(decoy.decoy, true);
  for (const k of ['shape', 'min', 'max', 'title', 'stepKey'] as const) assert.deepEqual(decoy[k], real[k], k);
  assert.deepEqual(decoy.choices, real.choices);
  assert.equal(decoy.decoyResult, true, 'the Fortune Teller gets a result screen, so the decoy gets one too');
  assert.ok(!JSON.stringify(decoy).includes('fortuneteller'), 'a decoy never says whose step it is');
});

test('a 2-player step gets the 2-player decoy question; an info step gets something to read', () => {
  const s = mk(['imp', 'poisoner', 'fortuneteller', 'washerwoman', 'soldier']);
  const soldier = byChar(s, 'soldier');
  startNight(s);
  advanceUntil(s, 'washerwoman');
  assert.deepEqual(viewFor(s, soldier.id).nightTurn!.body, { key: 'decoyInfo' });
  advanceUntil(s, 'fortuneteller');
  assert.deepEqual(viewFor(s, soldier.id).nightTurn!.body, { key: 'decoySameTeam' });
});

test('a player never gets the same decoy question twice in a row', () => {
  const s = mk(['imp', 'poisoner', 'monk', 'butler', 'soldier', 'mayor']);
  const last: Record<string, string> = {};
  for (let night = 1; night <= 4; night++) {
    startNight(s);
    while (s.pendingRealTurn) {
      for (const [id, key] of Object.entries(s.pendingRealTurn.decoys)) {
        if (key === 'decoyInfo' || key === 'decoySameTeam') continue; // fixed by the step's shape
        assert.notEqual(key, last[id]);
        last[id] = key;
      }
      skipRound(s);
    }
    runFullNight(s);
  }
});

test('a decoy answer never does anything — picking someone at the Imp step kills nobody', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const imp = byChar(s, 'imp');
  const soldier = byChar(s, 'soldier');
  const empath = byChar(s, 'empath');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  submitRealResponse(s, soldier.id, [empath.id]); // the Soldier's decoy "pick" at the Imp's step
  submitRealResponse(s, imp.id, [soldier.id]); // the real kill, on the Soldier (who is safe)
  answerDecoys(s);
  runFullNight(s);
  assert.equal(empath.alive, true);
  assert.deepEqual(s.deathsTonight, []);
});

test('the night waits for every decoy too — a step only ends once everyone has answered', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const poisoner = byChar(s, 'poisoner');
  startNight(s);
  advanceUntil(s, 'poisoner');
  const step = s.pendingRealTurn;
  submitRealResponse(s, poisoner.id, [poisoner.id]);
  assert.equal(s.pendingRealTurn, step, 'the real actor is done, but the step waits for the decoys');
  answerDecoys(s);
  assert.notEqual(s.pendingRealTurn, step);
});

test(`nobody can answer sooner than ${MIN_ANSWER_MS / 1000} seconds after a step opens — real turn or decoy`, () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const poisoner = byChar(s, 'poisoner');
  const soldier = byChar(s, 'soldier');
  startNight(s);
  advanceUntil(s, 'poisoner');
  const t = s.pendingRealTurn!;
  assert.throws(() => submitRealResponse(s, poisoner.id, [soldier.id], t.openedAt + MIN_ANSWER_MS - 1), /Too early/);
  assert.throws(() => submitRealResponse(s, soldier.id, [poisoner.id], t.openedAt + MIN_ANSWER_MS - 1), /Too early/);
  assert.equal(s.poisonedId, null, 'a refused answer changes nothing');
  submitRealResponse(s, poisoner.id, [soldier.id], t.openedAt + MIN_ANSWER_MS);
  submitRealResponse(s, soldier.id, [poisoner.id], t.openedAt + MIN_ANSWER_MS);
  assert.equal(s.poisonedId, soldier.id);
});

test('the screen tells each phone how long it must still wait before answering', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  startNight(s);
  const wait = viewFor(s, s.players[0].id).nightTurn!.waitMs;
  assert.ok(wait > MIN_ANSWER_MS - 1000 && wait <= MIN_ANSWER_MS, `waitMs was ${wait}`);
  s.pendingRealTurn!.openedAt -= MIN_ANSWER_MS;
  assert.equal(viewFor(s, s.players[0].id).nightTurn!.waitMs, 0);
});

test('a disconnected player\'s decoy never blocks the night, but a disconnected real actor does', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const poisoner = byChar(s, 'poisoner');
  const soldier = byChar(s, 'soldier');
  startNight(s);
  advanceUntil(s, 'poisoner');
  const step = s.pendingRealTurn;
  poisoner.connected = false;
  soldier.connected = false;
  for (const id of step!.participantIds) {
    if (id !== poisoner.id && id !== soldier.id) submitRealResponse(s, id, [soldier.id]);
  }
  tick(s, Date.now());
  assert.equal(s.pendingRealTurn, step, 'still waiting for the Poisoner — a real turn is never skipped');
  submitRealResponse(s, poisoner.id, [soldier.id]); // back online, answers
  tick(s, Date.now());
  assert.notEqual(s.pendingRealTurn, step, "the offline Soldier's decoy did not hold the night up");
});

test('someone killed tonight keeps getting decoys until dawn — their screens don\'t give their death away', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk']);
  const washerwoman = byChar(s, 'washerwoman');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [washerwoman.id]);
  assert.equal(washerwoman.alive, false);
  let screens = 0;
  while (s.pendingRealTurn) {
    const turn = viewFor(s, washerwoman.id).nightTurn;
    assert.ok(turn, 'the victim is still woken at every step');
    assert.equal(turn!.decoy, true);
    screens++;
    skipRound(s);
  }
  assert.ok(screens > 0);
});

test('a player dead from an earlier night rests: no screens at all', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const empath = byChar(s, 'empath');
  empath.alive = false;
  startNight(s);
  while (s.pendingRealTurn) {
    assert.equal(viewFor(s, empath.id).nightTurn, null);
    skipRound(s);
  }
});
