// The engine IS the Storyteller: every judgement call the real Storyteller makes (false information,
// who the Mayor's death bounces to, which Minion inherits the Imp...) must be plausible, stay inside
// the game's script, and be a pure function of the game's secret — never of Math.random().
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import { chefInfo, investigativeInfo, ravenkeeperInfo, spyInfo, undertakerInfo } from '../game/info.js';
import { apparentCharacter } from '../game/registration.js';
import { SCRIPTS } from '../game/scripts.js';
import type { GameState } from '../game/types.js';
import { advanceUntil, answerRealTurn, byChar, mk, poison, runFullNight, startNight } from './helpers.js';

const SECRETS = Array.from({ length: 60 }, (_, i) => `secret-${i}`);
const TB = new Set(SCRIPTS.tb.characters);
const roleOf = (m: { vars?: Record<string, unknown> }): string => String(m.vars?.role);

/** A Trouble Brewing table where the given player's ability is poisoned by a living Poisoner. */
function poisonedTable(chars: string[], victim: string, secret: string): GameState {
  const s = mk(chars as never);
  s.secret = secret;
  poison(s, byChar(s, victim as never).id);
  return s;
}

// ---------------------------------------------------------------- false information stays on the script

test('legal: a poisoned Undertaker is only ever told a character of the script', () => {
  for (const secret of SECRETS) {
    const s = poisonedTable(['undertaker', 'poisoner', 'imp', 'empath', 'monk', 'soldier'], 'undertaker', secret);
    const m = undertakerInfo(s, byChar(s, 'undertaker'), byChar(s, 'monk'), 'u1');
    assert.ok(TB.has(roleOf(m)), `${secret}: ${roleOf(m)} is not a Trouble Brewing character`);
  }
});

test('legal: a poisoned Ravenkeeper is only ever told a character of the script', () => {
  for (const secret of SECRETS) {
    const s = poisonedTable(['ravenkeeper', 'poisoner', 'imp', 'empath', 'monk', 'soldier'], 'ravenkeeper', secret);
    const m = ravenkeeperInfo(s, byChar(s, 'ravenkeeper'), byChar(s, 'monk').id, 'r1');
    assert.ok(TB.has(roleOf(m)), `${secret}: ${roleOf(m)} is not a Trouble Brewing character`);
  }
});

test('legal: a poisoned Spy sees a grimoire made only of the script\'s characters', () => {
  for (const secret of SECRETS) {
    const s = poisonedTable(['spy', 'poisoner', 'imp', 'empath', 'monk', 'soldier'], 'spy', secret);
    poison(s, byChar(s, 'spy').id);
    const m = spyInfo(s, byChar(s, 'spy'), 's1');
    for (const role of m.vars!.roles as string[]) assert.ok(TB.has(role), `${secret}: ${role} is not a Trouble Brewing character`);
  }
});

test('legal: a poisoned Investigator/Washerwoman/Librarian is told a character of the right team, from the script', () => {
  for (const [who, team] of [['investigator', 'minion'], ['washerwoman', 'townsfolk'], ['librarian', 'outsider']] as const) {
    for (const secret of SECRETS) {
      const s = poisonedTable([who, 'poisoner', 'imp', 'empath', 'monk', 'soldier'], who, secret);
      const m = investigativeInfo(s, byChar(s, who), team, 'i1');
      const role = roleOf(m);
      assert.ok(TB.has(role), `${who}/${secret}: ${role} is not a Trouble Brewing character`);
      assert.equal(CHARACTERS[role].team, team, `${who}/${secret}: ${role} is not a ${team}`);
    }
  }
});

test('legal: a Recluse registering as a Minion with none in play still names a character of the script', () => {
  // Off the wiki: a Recluse may be shown as a Minion even when there is none in play.
  for (const secret of SECRETS) {
    const s = mk(['recluse', 'washerwoman', 'imp', 'empath', 'monk', 'soldier']);
    s.secret = secret;
    const role = apparentCharacter(s, byChar(s, 'recluse'), 'minion', { asker: byChar(s, 'washerwoman').id, slot: 'x' });
    assert.ok(TB.has(role), `${secret}: ${role} is not a Trouble Brewing character`);
  }
});

test('legal: the script is whatever was chosen — a Bad Moon Rising game never gets a Trouble Brewing lie', () => {
  const BMR = new Set(SCRIPTS.bmr.characters);
  for (const secret of SECRETS.slice(0, 20)) {
    const s = mk(['undertaker', 'poisoner', 'imp', 'empath', 'monk', 'soldier']);
    s.scriptChars = SCRIPTS.bmr.characters.slice();
    s.secret = secret;
    poison(s, byChar(s, 'undertaker').id);
    const m = undertakerInfo(s, byChar(s, 'undertaker'), byChar(s, 'monk'), 'u1');
    assert.ok(BMR.has(roleOf(m)), `${secret}: ${roleOf(m)} is not on the Bad Moon Rising script`);
  }
});

// ---------------------------------------------------------------- plausible false information

test('legal: a malfunctioning Chef never claims more evil pairs than could possibly exist', () => {
  // Five players with two evil: there can be at most 1 pair of evil neighbours.
  for (const secret of SECRETS) {
    const s = poisonedTable(['chef', 'poisoner', 'imp', 'empath', 'monk'], 'chef', secret);
    const count = Number(chefInfo(s, byChar(s, 'chef'), 'c1').vars!.count);
    assert.ok(count >= 0 && count <= 1, `${secret}: Chef told ${count} pairs with only 2 evil players`);
  }
});

test('legal: with no evil player at all, a malfunctioning Chef says 0', () => {
  const s = mk(['chef', 'empath', 'soldier', 'monk', 'washerwoman']);
  s.secret = 'x';
  s.effects.push({ kind: 'drunk', target: byChar(s, 'chef').id, source: null, sourceChar: 'test', untilNight: null });
  assert.equal(Number(chefInfo(s, byChar(s, 'chef'), 'c1').vars!.count), 0);
});

// ---------------------------------------------------------------- the Storyteller is deterministic

/** Runs `fn` with Math.random forbidden: any rules decision that reaches for it fails the test. */
function withoutMathRandom<T>(fn: () => T): T {
  const real = Math.random;
  Math.random = () => { throw new Error('the Storyteller must not use Math.random()'); };
  try { return fn(); } finally { Math.random = real; }
}

function mayorBounce(secret: string): string[] {
  const s = mk(['mayor', 'imp', 'empath', 'librarian', 'soldier', 'chef', 'washerwoman']);
  s.secret = secret;
  s.day = 1;
  s.night = 1;
  return withoutMathRandom(() => {
    startNight(s);
    advanceUntil(s, 'imp');
    answerRealTurn(s, [byChar(s, 'mayor').id]);
    runFullNight(s);
    return s.players.filter((p) => !p.alive).map((p) => p.name);
  });
}

test('legal: the Mayor\'s bounce is decided by the game secret alone', () => {
  for (const secret of SECRETS.slice(0, 10)) assert.deepEqual(mayorBounce(secret), mayorBounce(secret), secret);
});

test('legal: the Mayor\'s bounce is not always the same player (the Storyteller varies)', () => {
  const victims = new Set(SECRETS.map((secret) => mayorBounce(secret).join(',')));
  assert.ok(victims.size > 1, `always ${[...victims]}`);
});

test('illegal: the Mayor\'s death never bounces onto the Imp, or stays on the Mayor, when someone else can die instead', () => {
  for (const secret of SECRETS) {
    const dead = mayorBounce(secret);
    assert.equal(dead.length, 1, `${secret}: exactly one death`);
    assert.ok(!dead.includes('P0'), `${secret}: the Mayor should have been spared`);
    assert.ok(!dead.includes('P1'), `${secret}: the Imp cannot die of their own kill`);
  }
});

function starPass(secret: string): string {
  const s = mk(['imp', 'poisoner', 'baron', 'empath', 'librarian', 'soldier', 'chef']);
  s.secret = secret;
  s.day = 1;
  s.night = 1;
  return withoutMathRandom(() => {
    startNight(s);
    advanceUntil(s, 'imp');
    answerRealTurn(s, [byChar(s, 'imp').id]);
    runFullNight(s);
    return s.players.find((p) => p.character === 'imp' && p.alive)?.name ?? 'none';
  });
}

test('legal: the Imp\'s star-pass picks the new Imp from the game secret alone', () => {
  for (const secret of SECRETS.slice(0, 10)) assert.equal(starPass(secret), starPass(secret), secret);
});

test('legal: the star-pass can land on either Minion (the Storyteller varies)', () => {
  const heirs = new Set(SECRETS.map(starPass));
  assert.ok(heirs.size > 1, `always ${[...heirs]}`);
  assert.ok(!heirs.has('none'), 'a Minion always inherits');
});

// ---------------------------------------------------------------- the Poisoner's poison is an ordinary effect

import { abilityLostReason } from '../game/registration.js';

function poisonedEmpath() {
  const s = mk(['imp', 'poisoner', 'empath', 'librarian', 'soldier', 'chef', 'washerwoman']);
  s.day = 1;
  s.night = 1;
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [byChar(s, 'empath').id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'librarian').id]); // (a skipped Imp would kill the Poisoner)
  return s;
}

test('legal: poison lasts through the night and the next day', () => {
  const s = poisonedEmpath();
  assert.equal(abilityLostReason(s, byChar(s, 'empath')), 'poisoned', 'tonight');
  runFullNight(s);
  assert.equal(s.phase, 'day');
  assert.equal(abilityLostReason(s, byChar(s, 'empath')), 'poisoned', 'tomorrow day');
});

test('legal: poison is gone the moment the next night begins (until the Poisoner chooses again)', () => {
  const s = poisonedEmpath();
  runFullNight(s);
  startNight(s);
  assert.equal(abilityLostReason(s, byChar(s, 'empath')), null);
});

test('legal: poison ends the moment the Poisoner dies', () => {
  const s = poisonedEmpath();
  byChar(s, 'poisoner').alive = false;
  assert.equal(abilityLostReason(s, byChar(s, 'empath')), null);
});

test('legal: poison ends when the Poisoner stops being the Poisoner (e.g. a Pit-Hag changes them)', () => {
  const s = poisonedEmpath();
  byChar(s, 'poisoner').character = 'soldier';
  assert.equal(abilityLostReason(s, byChar(s, 'empath')), null);
});

test('illegal: a drunk Poisoner poisons nobody', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'librarian', 'soldier', 'chef', 'washerwoman']);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'poisoner').id, source: null, sourceChar: 'test', untilNight: null });
  s.day = 1;
  s.night = 1;
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [byChar(s, 'empath').id]);
  assert.equal(abilityLostReason(s, byChar(s, 'empath')), null);
});
