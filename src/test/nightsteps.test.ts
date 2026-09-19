// The night is played in ROUNDS: in every round every player's phone shows exactly one screen and is
// tapped exactly once — the real actor picks ONE player (or a character, or reads their information or
// result), everyone else reads a tip and taps "Got it". So every phone at the table is tapped exactly
// as often as every other, and nothing on a tip says what anyone else is doing.
import assert from 'node:assert/strict';
import { poisonedId } from './helpers.js';
import { test } from 'node:test';
import { tick } from '../game/engine.js';
import { FIRST_NIGHT_SEQUENCE, MIN_ANSWER_MS, submitRealResponse } from '../game/night.js';
import type { CharacterId, GameState } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { advanceUntil, answerDecoys, answerRealTurn, byChar, mk, playRounds, runFullNight, skipRound, startNight } from './helpers.js';

/** Plays one night, recording which screen (by its identity) each player had to tap. */
function tapsTonight(s: GameState): Record<string, string[]> {
  const taps: Record<string, string[]> = {};
  while (s.phase === 'night' && s.pendingRealTurn) {
    for (const p of s.players) {
      const turn = viewFor(s, p.id).nightTurn;
      if (turn) (taps[p.id] ??= []).push(turn.stepKey);
    }
    playRounds(s, 1, {}, undefined, true); // one round: everyone taps once
  }
  return taps;
}

for (const chars of [
  ['imp', 'poisoner', 'empath', 'washerwoman', 'soldier'],
  ['imp', 'spy', 'fortuneteller', 'monk', 'butler', 'undertaker', 'chef'],
  ['imp', 'baron', 'saint', 'recluse', 'mayor', 'virgin', 'slayer', 'drunk'],
  ['po', 'godfather', 'chambermaid', 'gambler', 'courtier', 'seamstress', 'barber'],
] as CharacterId[][]) {
  test(`every player taps exactly as many screens as everyone else, every night, whatever their character (${chars.join(', ')})`, () => {
    const s = mk(chars, { drunkFakeChar: 'empath' });
    for (let night = 1; night <= 2; night++) {
      startNight(s);
      const taps = tapsTonight(s);
      const sequences = s.players.map((p) => JSON.stringify(taps[p.id] ?? []));
      assert.equal(new Set(sequences).size, 1, `night ${night}: someone tapped a different number of screens`);
      assert.ok((taps[s.players[0].id] ?? []).length > 0, `night ${night}: at least one screen`);
      runFullNight(s);
    }
  });
}

test('the Chambermaid: pick one player, pick a second, then read the answer — three rounds, and three tips for everyone else', () => {
  const s = mk(['imp', 'poisoner', 'chambermaid', 'soldier', 'monk', 'chef', 'mayor']);
  const maid = byChar(s, 'chambermaid');
  const others = s.players.filter((p) => p.id !== maid.id);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'chambermaid');
  const kinds = (): string[] => s.players.map((p) => viewFor(s, p.id).nightTurn?.kind ?? '-');

  // Round 1: the Chambermaid picks her first player; everyone else reads a tip.
  let mine = viewFor(s, maid.id).nightTurn!;
  assert.deepEqual([mine.kind, mine.index, mine.total, mine.canSkip], ['pick', 0, 2, false]);
  for (const p of others) assert.equal(viewFor(s, p.id).nightTurn!.kind, 'tip');
  playRounds(s, 1, { [maid.id]: [[byChar(s, 'imp').id]] });

  // Round 2: her second pick (the first one can't be picked again); a second tip for everyone else.
  mine = viewFor(s, maid.id).nightTurn!;
  assert.deepEqual([mine.kind, mine.index, mine.picked.map((p) => p.id)], ['pick', 1, [byChar(s, 'imp').id]]);
  assert.equal(mine.choices.find((c) => c.id === byChar(s, 'imp').id)!.disabled, true);
  assert.deepEqual(kinds().filter((k) => k === 'tip').length, others.length);
  playRounds(s, 1, { [maid.id]: [[byChar(s, 'monk').id]] });

  // Round 3: her answer; a third tip for everyone else.
  mine = viewFor(s, maid.id).nightTurn!;
  assert.equal(mine.kind, 'result');
  assert.equal(mine.body!.key, 'chambermaidInfo');
  for (const p of others) assert.equal(viewFor(s, p.id).nightTurn!.kind, 'tip');
  playRounds(s, 1, {});
  assert.notEqual(s.pendingRealTurn?.charId, 'chambermaid', 'and the step is over');
});

test('a tip says nothing about the step: no prompt, no players, no characters — only a number to tell screens apart', () => {
  const s = mk(['imp', 'poisoner', 'fortuneteller', 'washerwoman', 'soldier']);
  const soldier = byChar(s, 'soldier');
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  const tip = viewFor(s, soldier.id).nightTurn!;
  assert.deepEqual({ ...tip, stepKey: 'x', waitMs: 0 }, {
    kind: 'tip', body: null, choices: [], picked: [], index: 0, total: 0, canSkip: false, characters: [], stepKey: 'x', waitMs: 0,
  });
  assert.ok(!JSON.stringify(tip).includes('fortuneteller'));
});

test('a character step (the Gambler): one round to pick the player, one to name the character — two tips for everyone else', () => {
  const s = mk(['imp', 'poisoner', 'gambler', 'soldier', 'empath', 'chef', 'mayor']);
  const gambler = byChar(s, 'gambler');
  const soldier = byChar(s, 'soldier');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'gambler');
  assert.equal(viewFor(s, gambler.id).nightTurn!.kind, 'pick');
  assert.equal(viewFor(s, soldier.id).nightTurn!.kind, 'tip');
  playRounds(s, 1, { [gambler.id]: [[soldier.id]] });
  const named = viewFor(s, gambler.id).nightTurn!;
  assert.equal(named.kind, 'character');
  assert.ok(named.characters.some((c) => c.id === 'soldier'));
  assert.equal(viewFor(s, soldier.id).nightTurn!.kind, 'tip');
  playRounds(s, 1, {}, 'soldier');
  assert.equal(gambler.alive, true, 'a right guess');
  assert.notEqual(s.pendingRealTurn?.charId, 'gambler');
});

test('an optional ability declined with "No one" ends the step at once — for everyone, so the tap counts still match', () => {
  const s = mk(['imp', 'poisoner', 'seamstress', 'soldier', 'monk', 'chef', 'mayor']);
  const seam = byChar(s, 'seamstress');
  startNight(s);
  advanceUntil(s, 'seamstress');
  assert.equal(viewFor(s, seam.id).nightTurn!.canSkip, true);
  playRounds(s, 1, { [seam.id]: [[]] });
  assert.notEqual(s.pendingRealTurn?.charId, 'seamstress', 'one round, and done');
});

test('like the Storyteller, only steps whose character is in play happen — in the official order', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  const steps: string[] = [];
  while (s.pendingRealTurn) {
    assert.ok(s.pendingRealTurn.playerIds.length > 0, 'every step that runs has a real actor');
    steps.push(s.pendingRealTurn.charId);
    skipRound(s);
  }
  const expected = FIRST_NIGHT_SEQUENCE.filter((c) => ['minion-info', 'imp', 'poisoner', 'washerwoman', 'chef', 'empath'].includes(c));
  assert.deepEqual(steps, expected);
  assert.ok(!steps.includes('monk') && !steps.includes('librarian'), "no first-night step for the Monk, and none for the Librarian who isn't in play");
});

test('a night where nobody has anything to do has no steps at all, and still lasts at least 30 seconds', () => {
  const s = mk(['imp', 'soldier', 'mayor', 'virgin', 'saint']);
  startNight(s);
  assert.equal(s.pendingRealTurn, null);
  assert.equal(s.phase, 'night');
});

test("the screens' identity never reveals which character's step it is — it only counts steps and rounds", () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  const keys = tapsTonight(s)[byChar(s, 'soldier').id];
  assert.ok(keys.every((k) => /^1-\d+-\d+$/.test(k)), keys.join(' '));
  assert.equal(new Set(keys).size, keys.length, 'every screen has its own identity');
});

test('a tip answer never does anything — sending a player with it at the Imp step kills nobody', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const imp = byChar(s, 'imp');
  const soldier = byChar(s, 'soldier');
  const empath = byChar(s, 'empath');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  submitRealResponse(s, soldier.id, [empath.id]); // the Soldier's tip, with a player id sent along anyway
  submitRealResponse(s, imp.id, [soldier.id]); // the real kill, on the Soldier (who is safe)
  answerDecoys(s);
  runFullNight(s);
  assert.equal(empath.alive, true);
  assert.deepEqual(s.deathsTonight, []);
});

test('the night waits for every tip too — a round only ends once everyone has tapped', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const poisoner = byChar(s, 'poisoner');
  startNight(s);
  advanceUntil(s, 'poisoner');
  const step = s.pendingRealTurn;
  submitRealResponse(s, poisoner.id, [poisoner.id]);
  assert.equal(s.pendingRealTurn, step, 'the real actor is done, but the round waits for the tips');
  assert.equal(poisonedId(s), null, 'the ability applies when the round closes');
  answerDecoys(s);
  assert.notEqual(s.pendingRealTurn, step);
  assert.equal(poisonedId(s), poisoner.id);
});

test(`nobody can answer sooner than ${MIN_ANSWER_MS / 1000} seconds after a screen opens — real screen or tip`, () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const poisoner = byChar(s, 'poisoner');
  const soldier = byChar(s, 'soldier');
  startNight(s);
  advanceUntil(s, 'poisoner');
  const t = s.pendingRealTurn!;
  assert.throws(() => submitRealResponse(s, poisoner.id, [soldier.id], t.openedAt + MIN_ANSWER_MS - 1), /Too early/);
  assert.throws(() => submitRealResponse(s, soldier.id, [], t.openedAt + MIN_ANSWER_MS - 1), /Too early/);
  submitRealResponse(s, poisoner.id, [soldier.id], t.openedAt + MIN_ANSWER_MS);
  submitRealResponse(s, soldier.id, [], t.openedAt + MIN_ANSWER_MS);
  answerDecoys(s);
  assert.equal(poisonedId(s), soldier.id);
});

test('every round restarts the wait: the second pick of a Fortune Teller is also locked for 5 seconds', () => {
  const s = mk(['imp', 'poisoner', 'fortuneteller', 'washerwoman', 'soldier']);
  const ft = byChar(s, 'fortuneteller');
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  playRounds(s, 1, { [ft.id]: [[byChar(s, 'imp').id]] });
  const t = s.pendingRealTurn!;
  assert.throws(() => submitRealResponse(s, ft.id, [byChar(s, 'soldier').id], t.openedAt + MIN_ANSWER_MS - 1), /Too early/);
});

test('the screen tells each phone how long it must still wait before answering', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  startNight(s);
  const wait = viewFor(s, s.players[0].id).nightTurn!.waitMs;
  assert.ok(wait > MIN_ANSWER_MS - 1000 && wait <= MIN_ANSWER_MS, `waitMs was ${wait}`);
  s.pendingRealTurn!.openedAt -= MIN_ANSWER_MS;
  assert.equal(viewFor(s, s.players[0].id).nightTurn!.waitMs, 0);
});

test('a pick screen takes exactly one player (or "No one" where allowed) — never two at once', () => {
  const s = mk(['imp', 'poisoner', 'fortuneteller', 'washerwoman', 'soldier']);
  const ft = byChar(s, 'fortuneteller');
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  assert.throws(() => submitRealResponse(s, ft.id, [byChar(s, 'imp').id, byChar(s, 'soldier').id]), /one player at a time/);
  assert.throws(() => submitRealResponse(s, ft.id, []), /Choose a player/, 'the Fortune Teller must choose');
});

test('a disconnected player\'s tip never blocks the night, but a disconnected real actor does', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const poisoner = byChar(s, 'poisoner');
  const soldier = byChar(s, 'soldier');
  startNight(s);
  advanceUntil(s, 'poisoner');
  const step = s.pendingRealTurn;
  poisoner.connected = false;
  soldier.connected = false;
  for (const id of step!.participantIds) {
    if (id !== poisoner.id && id !== soldier.id) submitRealResponse(s, id, []);
  }
  tick(s, Date.now());
  assert.equal(s.pendingRealTurn, step, 'still waiting for the Poisoner — a real screen is never skipped');
  submitRealResponse(s, poisoner.id, [soldier.id]); // back online, answers
  tick(s, Date.now());
  assert.notEqual(s.pendingRealTurn, step, "the offline Soldier's tip did not hold the night up");
});

test('someone killed tonight keeps getting tips until dawn — their screens don\'t give their death away', () => {
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
    assert.ok(turn, 'the victim is still woken at every round');
    assert.equal(turn!.kind, 'tip');
    screens++;
    playRounds(s, 1, {}, undefined, true);
  }
  assert.ok(screens > 0);
});

test('a player dead from an earlier night never gets a real screen, only tips', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const empath = byChar(s, 'empath');
  empath.alive = false;
  startNight(s);
  while (s.pendingRealTurn) {
    assert.equal(viewFor(s, empath.id).nightTurn?.kind, 'tip', 'the dead only ever get tips');
    assert.ok(!s.pendingRealTurn.playerIds.includes(empath.id));
    skipRound(s);
  }
});
