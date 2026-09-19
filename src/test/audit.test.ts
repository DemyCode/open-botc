// Regression tests from a full rules audit against the wiki (2026-09-19). Each test replays the exact
// situation that was wrong, with every answer scripted, and pins what the real game does instead.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useDayAbility } from '../game/dayactions.js';
import { hooksOf } from '../game/deaths.js';
import { nominate, useSlayer } from '../game/engine.js';
import { submitRealResponse } from '../game/night.js';
import { abilityLostReason } from '../game/registration.js';
import { evalStatement, type Statement } from '../game/statements.js';
import type { CharacterId, GameState, Msg } from '../game/types.js';
import { viewFor } from '../game/view.js';
import {
  advanceUntil, answerRealTurn, breakDawn, byChar, endDayByConsensus, fastForwardToVote, mk, mkDay,
  runFullNight, skipRound, startNight, voteInOrder,
} from './helpers.js';

type Pick = { targets?: CharacterId[]; character?: string };

/** Plays one night with explicit answers per step (targets named by true character); the rest are skipped. Returns the steps that woke. */
function night(s: GameState, picks: Partial<Record<string, Pick>> = {}): string[] {
  if (s.phase !== 'night') startNight(s);
  const steps: string[] = [];
  let guard = 0;
  while (s.pendingRealTurn && guard++ < 60) {
    const step = s.pendingRealTurn.charId;
    steps.push(step);
    const p = picks[step];
    if (p) answerRealTurn(s, (p.targets ?? []).map((c) => byChar(s, c).id), p.character);
    else skipRound(s);
  }
  breakDawn(s);
  return steps;
}

function afterNight1(chars: CharacterId[]): GameState {
  const s = mk(chars);
  startNight(s);
  runFullNight(s);
  assert.equal(s.phase, 'day');
  return s;
}

const lastMsg = (s: GameState, c: CharacterId): Msg | undefined => byChar(s, c).log.at(-1)?.msg;

// ================================================================ Grandmother: one grandchild, one wake

test('Grandmother is woken on the first night only, and keeps the same grandchild all game', () => {
  const s = mk(['imp', 'poisoner', 'grandmother', 'washerwoman', 'butler', 'virgin', 'chef']);
  const gm = byChar(s, 'grandmother');
  assert.ok(night(s, { poisoner: { targets: ['poisoner'] } }).includes('grandmother'), 'she learns her grandchild on night 1');
  const grandchild = gm.flags.grandchildId;
  assert.ok(grandchild);
  assert.equal(gm.log.length, 1);

  for (let n = 2; n <= 4; n++) {
    const steps = night(s, { poisoner: { targets: ['poisoner'] }, imp: { targets: ['virgin'] } });
    assert.ok(!steps.includes('grandmother'), `not woken on night ${n}`);
    assert.equal(gm.flags.grandchildId, grandchild, `still the same grandchild on night ${n}`);
    if (s.winner) break;
  }
  assert.equal(gm.log.length, 1, 'no new "grandchild" message after night 1');
});

// ================================================================ Pukka: first-night Demon info

test('Pukka (7+ players) learns its Minions and 3 bluffs on the first night, like every Demon', () => {
  const s = mk(['pukka', 'poisoner', 'grandmother', 'washerwoman', 'butler', 'virgin', 'chef']);
  s.bluffs = ['monk', 'soldier', 'mayor'];
  const steps = night(s, { poisoner: { targets: ['poisoner'] }, pukka: { targets: ['chef'] } });
  assert.ok(steps.includes('demon-info'));
  const info = byChar(s, 'pukka').log.find((l) => l.msg.key === 'demonInfo')?.msg;
  assert.deepEqual(info, { key: 'demonInfo', vars: { names: [byChar(s, 'poisoner').name], bluffs: ['monk', 'soldier', 'mayor'] } });
  assert.equal(byChar(s, 'pukka').flags.pukkaVictim, byChar(s, 'chef').id, 'and still poisons with its own step');
});

// ================================================================ Lunatic: their own card must not give them away

test('the Lunatic\'s own card reads evil (they believe they are the Demon); the truth shows only at the end', () => {
  const s = mk(['imp', 'poisoner', 'lunatic', 'washerwoman', 'butler', 'virgin', 'chef']);
  const lunatic = byChar(s, 'lunatic');
  lunatic.perceived = 'po';
  const card = viewFor(s, lunatic.id).myCharacter!;
  assert.equal(card.id, 'po');
  assert.equal(card.alignment, 'evil', 'a "Po · good" card would tell them they are the Lunatic');
  assert.equal(lunatic.alignment, 'good', 'they are really good');
  // The Drunk thinks they are a (good) Townsfolk: still good.
  const t = mk(['imp', 'poisoner', 'drunk', 'washerwoman', 'butler', 'virgin', 'chef'], { drunkFakeChar: 'chef' });
  assert.equal(viewFor(t, byChar(t, 'drunk').id).myCharacter!.alignment, 'good');
  // Game over: the true alignment.
  s.phase = 'ended';
  assert.equal(viewFor(s, lunatic.id).myCharacter!.alignment, 'good');
});

// ================================================================ Vortox: information is FALSE, never accidentally true

const SECRETS = Array.from({ length: 60 }, (_, i) => `vortox-${i}`);

test('Vortox: the Oracle is never told the true number of evil dead', () => {
  for (const secret of SECRETS) {
    const s = mkDay(['vortox', 'poisoner', 'oracle', 'soldier', 'monk', 'chef', 'mayor']);
    s.secret = secret;
    byChar(s, 'poisoner').alive = false; // 1 evil dead
    byChar(s, 'soldier').alive = false;
    const m = hooksOf('oracle').night!.info!(s, byChar(s, 'oracle'), `oracle-n2-${secret}`);
    assert.notEqual(m.vars!.count, 1, secret);
  }
});

test('Vortox: Clockmaker, Chef, Empath, Mathematician and Fortune Teller are always wrong', () => {
  for (const secret of SECRETS) {
    // seats: 0 vortox, 1 poisoner, 2 clockmaker, 3 chef, 4 empath, 5 mathematician, 6 fortuneteller
    const s = mk(['vortox', 'poisoner', 'clockmaker', 'chef', 'empath', 'mathematician', 'fortuneteller']);
    s.secret = secret;
    const info = (c: CharacterId) => hooksOf(c).night!.info!(s, byChar(s, c), `${c}-${secret}`);
    assert.notEqual(info('clockmaker').vars!.count, 1, 'the Demon sits next to its Minion: 1 step');
    assert.notEqual(info('chef').vars!.count, 1, 'one pair of evil neighbours');
    assert.notEqual(info('empath').vars!.count, 0, 'no evil neighbours');
    assert.notEqual(info('mathematician').vars!.count, 0, 'nobody malfunctioned');
    const ft = byChar(s, 'fortuneteller');
    hooksOf('fortuneteller').night!.apply!(s, ft, [byChar(s, 'vortox').id, byChar(s, 'chef').id], `ft-${secret}`);
    assert.equal(ft.nightResult!.key, 'fortuneTellerNo', 'the Demon was chosen: the answer must be no');
  }
});

test('Vortox: the Undertaker is never shown the executed player\'s true character', () => {
  for (const secret of SECRETS) {
    const s = mkDay(['vortox', 'poisoner', 'undertaker', 'soldier', 'monk', 'chef', 'mayor']);
    s.secret = secret;
    const monk = byChar(s, 'monk');
    monk.alive = false;
    s.lastExecutedId = monk.id;
    const m = hooksOf('undertaker').night!.info!(s, byChar(s, 'undertaker'), `u-${secret}`);
    assert.notEqual(m.vars!.role, 'monk', secret);
  }
});

test('Vortox: the Juggler is told a wrong count, the Artist a wrong answer, the Savant two false things', () => {
  for (const secret of SECRETS.slice(0, 20)) {
    const s = mkDay(['vortox', 'poisoner', 'juggler', 'artist', 'savant', 'chef', 'mayor']);
    s.secret = secret;
    const juggler = byChar(s, 'juggler');
    juggler.flags.jugglerGuesses = [{ p: byChar(s, 'chef').id, v: 'chef' }, { p: byChar(s, 'mayor').id, v: 'soldier' }];
    assert.notEqual(hooksOf('juggler').night!.info!(s, juggler, `j-${secret}`).vars!.count, 1);

    const artist = byChar(s, 'artist');
    useDayAbility(s, artist.id, 'artist', [], { statement: { t: 'character', p: byChar(s, 'vortox').id, v: 'vortox' } });
    assert.equal(artist.log.at(-1)!.msg.vars!.truth, 0, '"is this player the Vortox?" — really yes, so told no');

    const savant = byChar(s, 'savant');
    useDayAbility(s, savant.id, 'savant', [], {});
    // Both statements are false: re-evaluate them from the replay (names -> player ids).
    const said = s.history.at(-1)!.vars as { a: string; b: string };
    const idOf = (name: string) => s.players.find((p) => p.name === name)!.id;
    const unname = (x: Record<string, unknown>): Statement => {
      const y: Record<string, unknown> = { ...x };
      for (const k of ['p', 'a', 'b'] as const) if (typeof y[k] === 'string') y[k] = idOf(y[k] as string);
      else if (y[k] && typeof y[k] === 'object') y[k] = unname(y[k] as Record<string, unknown>);
      if (y.s && typeof y.s === 'object') y.s = unname(y.s as Record<string, unknown>);
      return y as unknown as Statement;
    };
    const ctx = { asker: savant.id, slot: `savant-d${s.day}` };
    assert.equal(evalStatement(s, unname(JSON.parse(said.a)), ctx), false, `(1) ${said.a}`);
    assert.equal(evalStatement(s, unname(JSON.parse(said.b)), ctx), false, `(2) ${said.b}`);
  }
});

test('a poisoned Vortox falsifies nothing, and no execution does not hand evil the win', () => {
  const s = mkDay(['vortox', 'poisoner', 'oracle', 'soldier', 'monk', 'chef', 'mayor']);
  const vortox = byChar(s, 'vortox');
  s.effects.push({ kind: 'poisoned', target: vortox.id, source: byChar(s, 'poisoner').id, sourceChar: 'poisoner', untilNight: null, needsSourceAlive: true, needsSourceChar: 'poisoner' });
  byChar(s, 'monk').alive = false;
  assert.equal(hooksOf('oracle').night!.info!(s, byChar(s, 'oracle'), 'o').vars!.count, 0, 'true info: no evil dead');
  endDayByConsensus(s);
  assert.equal(s.winner, null);
  assert.equal(s.phase, 'night');
});

// ================================================================ Juggler: woken once

test('Juggler is woken only on the night after their first day — not every night', () => {
  const s = afterNight1(['imp', 'poisoner', 'juggler', 'soldier', 'monk', 'chef', 'mayor']);
  const juggler = byChar(s, 'juggler');
  useDayAbility(s, juggler.id, 'juggler', [], { guesses: [{ p: byChar(s, 'chef').id, v: 'chef' }] });
  endDayByConsensus(s);
  assert.ok(night(s, { imp: { targets: ['soldier'] } }).includes('juggler'), 'night 2: learns the count');
  assert.deepEqual(lastMsg(s, 'juggler'), { key: 'jugglerInfo', vars: { count: 1 } });
  endDayByConsensus(s);
  assert.ok(!night(s, { imp: { targets: ['soldier'] } }).includes('juggler'), 'night 3: not woken again');
  assert.equal(juggler.log.length, 1);
});

// ================================================================ Seamstress: once per game, when THEY choose

test('Seamstress may shake their head: choosing no-one keeps the ability for a later night', () => {
  const s = mk(['imp', 'poisoner', 'seamstress', 'soldier', 'monk', 'chef', 'mayor']);
  startNight(s);
  advanceUntil(s, 'seamstress');
  const seam = byChar(s, 'seamstress');
  assert.deepEqual(viewFor(s, seam.id).nightTurn!.counts, [0, 2]);
  assert.throws(() => submitRealResponse(s, seam.id, [byChar(s, 'chef').id]), /selection count/, 'one player is not an answer');
  answerRealTurn(s, []);
  night(s);
  assert.equal(seam.flags.seamstressUsed, undefined, 'not used up');
  assert.equal(seam.log.length, 0);

  endDayByConsensus(s);
  night(s, { imp: { targets: ['soldier'] }, seamstress: { targets: ['chef', 'mayor'] } });
  assert.deepEqual(lastMsg(s, 'seamstress'), { key: 'seamstressInfo', vars: { same: 1 } });
  endDayByConsensus(s);
  assert.ok(!night(s, { imp: { targets: ['monk'] } }).includes('seamstress'), 'used once: never woken again');
});

// ================================================================ Barber: the Demon may decline, may include themself; swapped players are told

function barberNight(): GameState {
  const s = afterNight1(['fanggu', 'witch', 'barber', 'empath', 'savant', 'artist', 'juggler']);
  const nominator = byChar(s, 'empath');
  nominate(s, nominator.id, byChar(s, 'barber').id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id));
  endDayByConsensus(s);
  assert.equal(byChar(s, 'barber').alive, false);
  return s;
}

test('Barber: the Demon may choose not to swap anyone', () => {
  const s = barberNight();
  const before = s.players.map((p) => p.character);
  night(s, { barber: { targets: [] }, fanggu: { targets: ['savant'] } });
  assert.deepEqual(s.players.map((p) => p.character), before);
});

test('Barber: the Demon may swap themself with another player; both learn their new character', () => {
  const s = barberNight();
  const demon = byChar(s, 'fanggu');
  const empath = byChar(s, 'empath');
  night(s, { barber: { targets: ['fanggu', 'empath'] }, fanggu: { targets: ['savant'] } });
  assert.equal(demon.character, 'empath');
  assert.equal(empath.character, 'fanggu');
  assert.deepEqual(demon.log.find((l) => l.msg.key === 'barberSwapped')?.msg, { key: 'barberSwapped', vars: { role: 'empath' } });
  assert.deepEqual(empath.log.find((l) => l.msg.key === 'barberSwapped')?.msg, { key: 'barberSwapped', vars: { role: 'fanggu' } });
});

// ================================================================ Slayer vs Zombuul

test('Slayer shoots the Zombuul the first time: it "dies" (registers as dead) but lives on, and the game goes on', () => {
  const s = mkDay(['zombuul', 'poisoner', 'slayer', 'soldier', 'monk', 'chef', 'mayor']);
  const zombuul = byChar(s, 'zombuul');
  useSlayer(s, byChar(s, 'slayer').id, zombuul.id);
  assert.equal(s.winner, null, 'good has not won: the Zombuul lives');
  assert.equal(zombuul.alive, false, 'the town sees it die');
  assert.equal(zombuul.flags.hiddenAlive, true);
  assert.equal(s.publicLog.at(-1)!.key, 'slayerHit');
});

// ================================================================ Mutant: the madness execution IS the day's execution

test('Mutant executed for madness: the day ends at once, so nobody else can be executed that day', () => {
  const s = mkDay(['imp', 'poisoner', 'mutant', 'soldier', 'monk', 'chef', 'mayor', 'butler']);
  s.onBlockId = byChar(s, 'chef').id; // someone was already about to die
  useDayAbility(s, byChar(s, 'mutant').id, 'mutant', [], {});
  assert.equal(byChar(s, 'mutant').alive, false);
  assert.equal(s.phase, 'night', 'straight to night');
  assert.equal(byChar(s, 'chef').alive, true, 'no second execution');
  assert.equal(s.lastExecutedId, byChar(s, 'mutant').id);
});

test('a madness execution is an execution: the Evil Twin wins when their good twin (a Mutant) is executed for it', () => {
  const s = mkDay(['imp', 'eviltwin', 'mutant', 'soldier', 'monk', 'chef', 'mayor', 'butler']);
  byChar(s, 'eviltwin').flags.twinId = byChar(s, 'mutant').id;
  useDayAbility(s, byChar(s, 'mutant').id, 'mutant', [], {});
  assert.equal(s.winner, 'evil');
});

// ================================================================ Vigormortis: a killed Minion keeps their ability

test('Vigormortis: a dead Poisoner keeps poisoning (any player, not just a neighbour) while the Vigormortis lives', () => {
  // seats: 0 vigormortis, 1 poisoner, 2 empath, 3 soldier, 4 monk, 5 chef, 6 mayor
  const s = afterNight1(['vigormortis', 'poisoner', 'empath', 'soldier', 'monk', 'chef', 'mayor']);
  endDayByConsensus(s);
  night(s, { poisoner: { targets: ['poisoner'] }, vigormortis: { targets: ['poisoner'] } });
  assert.equal(byChar(s, 'poisoner').alive, false);
  endDayByConsensus(s);
  night(s, { poisoner: { targets: ['chef'] }, vigormortis: { targets: ['soldier'] } });
  assert.equal(abilityLostReason(s, byChar(s, 'chef')), 'poisoned', 'the dead Poisoner\'s poison works');
  // The Vigormortis dies: the kept ability (and its poison) ends.
  byChar(s, 'vigormortis').alive = false;
  assert.equal(abilityLostReason(s, byChar(s, 'chef')), null);
});

test('Vigormortis: a dead Witch still curses — the cursed player dies when they nominate', () => {
  const s = afterNight1(['vigormortis', 'witch', 'empath', 'soldier', 'monk', 'chef', 'mayor', 'butler']);
  endDayByConsensus(s);
  night(s, { witch: { targets: ['mayor'] }, vigormortis: { targets: ['witch'] } });
  assert.equal(byChar(s, 'witch').alive, false);
  endDayByConsensus(s);
  night(s, { witch: { targets: ['chef'] }, vigormortis: { targets: ['butler'] } });
  nominate(s, byChar(s, 'chef').id, byChar(s, 'monk').id);
  assert.equal(byChar(s, 'chef').alive, false, 'the curse struck');
});

// ================================================================ Fang Gu: the jump is once per game

test('Fang Gu: after one jump, the new Fang Gu attacking an Outsider just kills them', () => {
  const s = afterNight1(['fanggu', 'witch', 'saint', 'recluse', 'monk', 'chef', 'mayor']);
  endDayByConsensus(s);
  night(s, { fanggu: { targets: ['saint'] }, monk: { targets: ['chef'] } });
  const newFang = s.players[2];
  assert.equal(newFang.character, 'fanggu');
  endDayByConsensus(s);
  night(s, { fanggu: { targets: ['recluse'] }, monk: { targets: ['chef'] } });
  const recluse = s.players[3];
  assert.equal(recluse.character, 'recluse', 'no second jump');
  assert.equal(recluse.alive, false, 'the Outsider dies as normal');
  assert.equal(newFang.alive, true);
});

// ================================================================ Klutz: evil means evil ALIGNMENT

test('Klutz choosing a good player the Pit-Hag turned into a Demon does not lose the game', () => {
  const s = mkDay(['imp', 'pithag', 'klutz', 'seamstress', 'soldier', 'monk', 'chef']);
  const seam = byChar(s, 'seamstress');
  seam.character = 'vortox'; // still good: the Pit-Hag changes characters, not alignments
  const klutz = byChar(s, 'klutz');
  klutz.alive = false;
  klutz.flags.klutzPending = true;
  hooksOf('klutz').day!.use(s, klutz, [seam.id], {});
  assert.equal(s.winner, null);
});
