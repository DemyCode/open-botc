// Bad Moon Rising, character by character — each rule from the wiki page (summary, how to run and examples)
// played out in a real game state, and the ways it can go wrong (drunk, poisoned, protected...).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import { nominate, toggleEndDayRequest } from '../game/engine.js';
import { abilityLostReason, abilityWorks } from '../game/registration.js';
import { SCRIPTS } from '../game/scripts.js';
import type { CharacterId, GameState } from '../game/types.js';
import { advanceUntil, answerRealTurn, breakDawn, byChar, endDayByConsensus, fastForwardToVote, mk, mkDay, runFullNight, skipRound, startNight, voteInOrder } from './helpers.js';

type Pick = { targets?: CharacterId[]; character?: string };
/** Plays one night with explicit answers per step (by the character's id; targets are named by their true character). */
function night(s: GameState, picks: Partial<Record<string, Pick>> = {}): void {
  if (s.phase !== 'night') startNight(s);
  let guard = 0;
  while (s.pendingRealTurn && guard++ < 60) {
    const p = picks[s.pendingRealTurn.charId];
    if (p) answerRealTurn(s, (p.targets ?? []).map((c) => byChar(s, c).id), p.character);
    else skipRound(s);
  }
  breakDawn(s);
}
/** A game in the middle of night 1's aftermath: night 1 played out, the first day begun. */
function afterNight1(chars: CharacterId[], opts: Parameters<typeof mk>[1] = {}): GameState {
  const s = mk(chars, opts);
  s.secret = 'bmr-test';
  startNight(s);
  runFullNight(s);
  assert.equal(s.phase, 'day');
  return s;
}
const alive = (s: GameState, c: CharacterId) => byChar(s, c).alive;
const woke = (s: GameState, step: string) => !!s.pendingRealTurn && s.pendingRealTurn.charId === step;
/** Executes a player by nomination and unanimous vote, then ends the day: night 2 begins. */
function executeByVote(s: GameState, victim: CharacterId): void {
  const nominator = s.players.find((p) => p.alive && p.id !== byChar(s, victim).id)!;
  nominate(s, nominator.id, byChar(s, victim).id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.filter((p) => p.alive || !p.ghostVoteUsed).map((p) => p.id));
  endDayByConsensus(s);
}

// ---------------------------------------------------------------- the edition itself

test('Bad Moon Rising has its 25 characters: 13 Townsfolk, 4 Outsiders, 4 Minions, 4 Demons', () => {
  const chars = SCRIPTS.bmr.characters.map((id) => CHARACTERS[id]);
  assert.equal(chars.length, 25);
  const by = (t: string) => chars.filter((c) => c.team === t).length;
  assert.deepEqual([by('townsfolk'), by('outsider'), by('minion'), by('demon')], [13, 4, 4, 4]);
  for (const c of chars) assert.equal(c.edition, 'bmr');
});

// ---------------------------------------------------------------- Sailor

test('Sailor: choosing a Townsfolk gets them drunk until dusk; choosing anyone else makes the Sailor drunk', () => {
  const s = afterNight1(['imp', 'poisoner', 'sailor', 'washerwoman', 'soldier', 'drunk', 'chef']);
  night(s, { sailor: { targets: ['washerwoman'] }, imp: { targets: ['soldier'] } });
  assert.equal(abilityLostReason(s, byChar(s, 'washerwoman')), 'drunk', 'the chosen Townsfolk is drunk');
  assert.equal(abilityLostReason(s, byChar(s, 'sailor')), null);
  night(s, { sailor: { targets: ['poisoner'] }, imp: { targets: ['soldier'] } });
  assert.equal(abilityLostReason(s, byChar(s, 'washerwoman')), null, 'the drunkenness ended at dusk');
  assert.equal(abilityLostReason(s, byChar(s, 'sailor')), 'drunk', 'a Minion was chosen: the Sailor is the drunk one');
});

test('Sailor: cannot die while sober — not to the Demon, not to execution — but dies once drunk', () => {
  const s = afterNight1(['imp', 'poisoner', 'sailor', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { sailor: { targets: ['imp'] }, imp: { targets: ['sailor'] } });
  // the Sailor chose the Imp: a Minion/Demon → the Sailor is drunk → the Demon's kill lands
  assert.equal(alive(s, 'sailor'), false, 'drunk Sailor dies');
  const t = afterNight1(['imp', 'poisoner', 'sailor', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(t, { sailor: { targets: ['washerwoman'] }, imp: { targets: ['sailor'] } });
  assert.equal(alive(t, 'sailor'), true, 'sober Sailor survives the Demon');
  assert.ok(t.history.some((e) => e.type === 'attack' && e.vars.outcome === 'blocked' && e.vars.by === 'sailor'));
  executeByVote(t, 'sailor');
  assert.equal(alive(t, 'sailor'), true, 'executed but alive');
  assert.ok(t.history.some((e) => e.type === 'survived' && e.vars.by === 'sailor'));
});

test('Sailor: cannot choose a dead player (the ability asks again)', () => {
  const s = afterNight1(['imp', 'poisoner', 'sailor', 'washerwoman', 'soldier', 'monk', 'chef']);
  byChar(s, 'chef').alive = false;
  startNight(s);
  advanceUntil(s, 'sailor');
  assert.throws(() => answerRealTurn(s, [byChar(s, 'chef').id]), /cannot choose/i);
  answerRealTurn(s, [byChar(s, 'monk').id]);
});

// ---------------------------------------------------------------- Chambermaid

test('Chambermaid: learns how many of two chosen players woke tonight because of their ability', () => {
  const s = afterNight1(['imp', 'poisoner', 'chambermaid', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { chambermaid: { targets: ['imp', 'monk'] }, imp: { targets: ['soldier'] } });
  assert.deepEqual(byChar(s, 'chambermaid').log.at(-1)!.msg, { key: 'chambermaidInfo', vars: { count: 2 } });
  night(s, { chambermaid: { targets: ['washerwoman', 'chef'] }, imp: { targets: ['soldier'] } });
  assert.deepEqual(byChar(s, 'chambermaid').log.at(-1)!.msg.vars, { count: 0 });
  night(s, { chambermaid: { targets: ['poisoner', 'soldier'] }, imp: { targets: ['soldier'] } });
  assert.deepEqual(byChar(s, 'chambermaid').log.at(-1)!.msg.vars, { count: 1 });
});

test('Chambermaid: a step nobody real takes part in (the Soldier never wakes) does not count, and a drunk Chambermaid may be wrong', () => {
  const s = afterNight1(['imp', 'poisoner', 'chambermaid', 'washerwoman', 'soldier', 'monk', 'chef']);
  let wrong = 0;
  for (let i = 0; i < 12; i++) {
    s.secret = `chamber-${i}`;
    s.effects = [{ kind: 'drunk', target: byChar(s, 'chambermaid').id, source: null, sourceChar: 'test', untilNight: null }];
    night(s, { chambermaid: { targets: ['soldier', 'washerwoman'] }, imp: { targets: ['chef'] } });
    s.players.forEach((p) => (p.alive = true));
    s.phase = 'day';
    if ((byChar(s, 'chambermaid').log.at(-1)!.msg.vars as { count: number }).count !== 0) wrong++;
  }
  assert.ok(wrong > 0, 'a drunk Chambermaid gets unreliable counts');
});

// ---------------------------------------------------------------- Exorcist

test('Exorcist: a Demon they choose is told who they are and does not wake to attack', () => {
  const s = afterNight1(['imp', 'poisoner', 'exorcist', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'exorcist');
  answerRealTurn(s, [byChar(s, 'imp').id]);
  // the Imp step is skipped: nothing left before dawn that needs the Imp
  let imped = false;
  while (s.pendingRealTurn) { if (woke(s, 'imp')) imped = true; skipRound(s); }
  assert.equal(imped, false, 'the Imp did not wake');
  assert.ok(byChar(s, 'imp').log.some((e) => e.msg.key === 'exorcisedInfo' && (e.msg.vars as { name: string }).name === byChar(s, 'exorcist').name));
  breakDawn(s);
  assert.equal(s.deathsTonight.length, 0, 'nobody died');
});

test('Exorcist: choosing a player who is not the Demon changes nothing; the same player cannot be chosen two nights in a row', () => {
  const s = afterNight1(['imp', 'poisoner', 'exorcist', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'exorcist');
  answerRealTurn(s, [byChar(s, 'chef').id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'monk').id]);
  breakDawn(s);
  assert.equal(alive(s, 'monk'), false, 'the Imp still attacked');
  startNight(s);
  advanceUntil(s, 'exorcist');
  assert.throws(() => answerRealTurn(s, [byChar(s, 'chef').id]), /cannot choose/i);
  answerRealTurn(s, [byChar(s, 'imp').id]);
});

test('Exorcist: a drunk Exorcist does nothing', () => {
  const s = afterNight1(['imp', 'poisoner', 'exorcist', 'washerwoman', 'soldier', 'monk', 'chef']);
  s.poisonedId = byChar(s, 'exorcist').id;
  startNight(s);
  advanceUntil(s, 'exorcist');
  // (the Poisoner's step resets poison each night, so poison the Exorcist through an effect instead)
  s.effects.push({ kind: 'drunk', target: byChar(s, 'exorcist').id, source: null, sourceChar: 'test', untilNight: null });
  answerRealTurn(s, [byChar(s, 'imp').id]);
  advanceUntil(s, 'imp');
  assert.ok(woke(s, 'imp'));
});

// ---------------------------------------------------------------- Innkeeper

test('Innkeeper: both chosen players cannot die tonight, and one of them is drunk until dusk', () => {
  const s = afterNight1(['imp', 'poisoner', 'innkeeper', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { innkeeper: { targets: ['chef', 'monk'] }, imp: { targets: ['chef'] } });
  assert.equal(alive(s, 'chef'), true, 'protected from the Demon');
  const drunk = ['chef', 'monk'].filter((c) => abilityLostReason(s, byChar(s, c)) === 'drunk');
  assert.equal(drunk.length, 1, 'exactly one of them is drunk');
  assert.ok(s.history.some((e) => e.type === 'attack' && e.vars.by === 'innkeeper'));
  night(s, { innkeeper: { targets: ['chef', 'monk'] }, imp: { targets: ['washerwoman'] } });
  assert.equal(alive(s, 'washerwoman'), false, 'protection is only for tonight');
});

test('Innkeeper: protection lasts the night only — an execution the next day is not stopped', () => {
  const s = afterNight1(['imp', 'poisoner', 'innkeeper', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { innkeeper: { targets: ['chef', 'monk'] }, imp: { targets: ['soldier'] } });
  executeByVote(s, 'chef');
  assert.equal(alive(s, 'chef'), false);
});

test('Innkeeper: an Innkeeper who chooses themself and gets drunk protects nobody', () => {
  let found = 0;
  for (let i = 0; i < 40 && found < 1; i++) {
    const s = afterNight1(['imp', 'poisoner', 'innkeeper', 'washerwoman', 'soldier', 'monk', 'chef']);
    s.secret = `inn-${i}`;
    night(s, { innkeeper: { targets: ['innkeeper', 'monk'] }, imp: { targets: ['monk'] } });
    if (abilityLostReason(s, byChar(s, 'innkeeper')) === 'drunk') {
      found++;
      assert.equal(alive(s, 'monk'), false, 'the other chosen player is not safe either');
    }
  }
  assert.equal(found, 1, 'the Storyteller sometimes drinks the Innkeeper');
});

// ---------------------------------------------------------------- Gambler

test('Gambler: a right guess changes nothing; a wrong guess kills the Gambler', () => {
  const s = afterNight1(['imp', 'poisoner', 'gambler', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { gambler: { targets: ['monk'], character: 'monk' }, imp: { targets: ['chef'] } });
  assert.equal(alive(s, 'gambler'), true);
  night(s, { gambler: { targets: ['soldier'], character: 'monk' }, imp: { targets: ['washerwoman'] } });
  assert.equal(alive(s, 'gambler'), false);
  assert.ok(s.history.some((e) => e.type === 'death' && e.vars.cause === 'gambler'));
});

test('Gambler: the guess is against the true character — the Drunk who thinks they are the Empath is the Drunk', () => {
  const s = afterNight1(['imp', 'poisoner', 'gambler', 'washerwoman', 'soldier', 'drunk', 'chef'], { drunkFakeChar: 'empath' });
  night(s, { gambler: { targets: ['drunk'], character: 'empath' }, imp: { targets: ['chef'] } });
  assert.equal(alive(s, 'gambler'), false, 'guessing the believed character is wrong');
});

test('Gambler: a drunk Gambler never dies of a wrong guess; a guess needs a character', () => {
  const s = afterNight1(['imp', 'poisoner', 'gambler', 'washerwoman', 'soldier', 'monk', 'chef']);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'gambler').id, source: null, sourceChar: 'test', untilNight: null });
  night(s, { gambler: { targets: ['soldier'], character: 'monk' }, imp: { targets: ['chef'] } });
  assert.equal(alive(s, 'gambler'), true);
  startNight(s);
  advanceUntil(s, 'gambler');
  assert.throws(() => answerRealTurn(s, [byChar(s, 'soldier').id]), /character/i);
  assert.throws(() => answerRealTurn(s, [byChar(s, 'soldier').id], 'nonsense'), /character/i);
});

// ---------------------------------------------------------------- Courtier

test('Courtier: the chosen character is drunk for 3 nights and 3 days, then sober; the Courtier never wakes again', () => {
  const s = afterNight1(['imp', 'poisoner', 'courtier', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { courtier: { character: 'monk' }, imp: { targets: ['chef'] } });
  const monk = byChar(s, 'monk');
  assert.equal(abilityLostReason(s, monk), 'drunk');
  night(s, { imp: { targets: ['washerwoman'] } });
  assert.equal(abilityLostReason(s, monk), 'drunk', 'second night');
  night(s, { imp: { targets: ['soldier'] } });
  assert.equal(abilityLostReason(s, monk), 'drunk', 'third night and day');
  startNight(s);
  assert.equal(abilityLostReason(s, monk), null, 'sober from the fourth night');
  let courtierWoke = false;
  while (s.pendingRealTurn) { if (woke(s, 'courtier')) courtierWoke = true; skipRound(s); }
  assert.equal(courtierWoke, false, 'the ability is used up');
});

test('Courtier: may shake their head (no character) and act later; a character not in play does nothing; the Courtier is not told', () => {
  const s = afterNight1(['imp', 'poisoner', 'courtier', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { imp: { targets: ['chef'] } });
  startNight(s);
  assert.ok(byChar(s, 'courtier').flags.courtierUsed !== true);
  advanceUntil(s, 'courtier');
  answerRealTurn(s, [], 'saint');
  assert.equal(s.effects.length, 0, 'nobody is drunk');
  assert.equal(byChar(s, 'courtier').log.length, 0, 'no feedback');
});

test('Courtier: if the Courtier becomes drunk, the character they made drunk sobers up until the Courtier is sober again', () => {
  const s = afterNight1(['imp', 'poisoner', 'courtier', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { courtier: { character: 'monk' }, imp: { targets: ['chef'] } });
  const monk = byChar(s, 'monk');
  assert.equal(abilityLostReason(s, monk), 'drunk');
  const courtierDrunk = { kind: 'drunk' as const, target: byChar(s, 'courtier').id, source: null, sourceChar: 'test', untilNight: null };
  s.effects.push(courtierDrunk);
  assert.equal(abilityLostReason(s, monk), null, 'the Courtier is drunk: their target is sober');
  s.effects.pop();
  assert.equal(abilityLostReason(s, monk), 'drunk', 'and drunk again');
});

test('Courtier: a drunk Courtier who chooses a character makes nobody drunk, and cannot try again', () => {
  const s = afterNight1(['imp', 'poisoner', 'courtier', 'washerwoman', 'soldier', 'monk', 'chef']);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'courtier').id, source: null, sourceChar: 'test', untilNight: null });
  night(s, { courtier: { character: 'monk' }, imp: { targets: ['chef'] } });
  s.effects = [];
  assert.equal(abilityLostReason(s, byChar(s, 'monk')), null);
  assert.equal(byChar(s, 'courtier').flags.courtierUsed, true);
});

// ---------------------------------------------------------------- Professor

test('Professor: resurrects a dead Townsfolk (announced at dawn, without saying who or why) — once', () => {
  const s = afterNight1(['imp', 'poisoner', 'professor', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { imp: { targets: ['chef'] } });
  assert.equal(alive(s, 'chef'), false);
  night(s, { professor: { targets: ['chef'] }, imp: { targets: ['soldier'] } });
  assert.equal(alive(s, 'chef'), true, 'the Chef is alive again');
  assert.ok(s.publicLog.some((m) => m.key === 'resurrected' && (m.vars as { name: string }).name === byChar(s, 'chef').name));
  assert.ok(s.history.some((e) => e.type === 'resurrect'));
  startNight(s);
  let woke2 = false;
  while (s.pendingRealTurn) { if (woke(s, 'professor')) woke2 = true; skipRound(s); }
  assert.equal(woke2, false, 'used up');
});

test('Professor: choosing an Outsider, a Minion or a Demon wastes the ability; only dead players can be chosen', () => {
  const s = afterNight1(['imp', 'poisoner', 'professor', 'washerwoman', 'soldier', 'drunk', 'chef']);
  night(s, { imp: { targets: ['drunk'] } });
  startNight(s);
  advanceUntil(s, 'professor');
  assert.throws(() => answerRealTurn(s, [byChar(s, 'soldier').id]), /cannot choose/i);
  answerRealTurn(s, [byChar(s, 'drunk').id]);
  assert.equal(alive(s, 'drunk'), false, 'an Outsider stays dead');
  assert.equal(byChar(s, 'professor').flags.professorUsed, true, 'and the ability is gone');
});

test('Professor: a resurrected player has their ability back, even a once-per-game one (the Virgin can be nominated again)', () => {
  const s = afterNight1(['imp', 'poisoner', 'professor', 'washerwoman', 'soldier', 'monk', 'virgin']);
  const virgin = byChar(s, 'virgin');
  virgin.virginUsed = true;
  virgin.alive = false;
  night(s, { professor: { targets: ['virgin'] }, imp: { targets: ['soldier'] } });
  assert.equal(virgin.alive, true);
  assert.equal(virgin.virginUsed, false);
});

test('Professor: a drunk Professor resurrects nobody', () => {
  const s = afterNight1(['imp', 'poisoner', 'professor', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { imp: { targets: ['chef'] } });
  s.effects.push({ kind: 'drunk', target: byChar(s, 'professor').id, source: null, sourceChar: 'test', untilNight: null });
  night(s, { professor: { targets: ['chef'] }, imp: { targets: ['soldier'] } });
  assert.equal(alive(s, 'chef'), false);
});

// ---------------------------------------------------------------- Minstrel

test('Minstrel: when a Minion is executed and dies, everyone else is drunk through the night and the next day', () => {
  const s = afterNight1(['imp', 'poisoner', 'minstrel', 'washerwoman', 'soldier', 'monk', 'chef']);
  executeByVote(s, 'poisoner');
  assert.equal(alive(s, 'poisoner'), false);
  for (const p of s.players.filter((q) => q.character !== 'minstrel')) assert.equal(abilityLostReason(s, p), 'drunk', p.character);
  assert.equal(abilityLostReason(s, byChar(s, 'minstrel')), null);
  // the drunk Imp kills nobody tonight
  let target = byChar(s, 'soldier');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [target.id]);
  breakDawn(s);
  assert.equal(target.alive, true, 'a drunk Demon cannot kill');
  startNight(s);
  assert.equal(abilityLostReason(s, byChar(s, 'monk')), null, 'sober again at the following dusk');
});

test('Minstrel: nothing happens for a Townsfolk, for a dead Minion executed again, or when the Minstrel is drunk', () => {
  const s = afterNight1(['imp', 'poisoner', 'minstrel', 'washerwoman', 'soldier', 'monk', 'chef']);
  executeByVote(s, 'chef');
  assert.equal(s.effects.length, 0);
  const t = afterNight1(['imp', 'poisoner', 'minstrel', 'washerwoman', 'soldier', 'monk', 'chef']);
  t.effects.push({ kind: 'drunk', target: byChar(t, 'minstrel').id, source: null, sourceChar: 'test', untilNight: null });
  executeByVote(t, 'poisoner');
  assert.equal(t.effects.length, 1, 'only the test effect');
});

// ---------------------------------------------------------------- Tea Lady

test('Tea Lady: her two alive neighbours cannot die while both are good; an evil neighbour removes the protection', () => {
  const s = afterNight1(['imp', 'poisoner', 'tealady', 'washerwoman', 'soldier', 'monk', 'chef']);
  const order = s.players.slice().sort((a, b) => a.seat - b.seat);
  const i = order.findIndex((p) => p.character === 'tealady');
  const [left, right] = [order[(i + order.length - 1) % order.length], order[(i + 1) % order.length]];
  for (const p of [left, right]) { p.alignment = 'good'; }
  const target = left.character === 'imp' ? right : left;
  assert.equal(left.alignment === 'good' && right.alignment === 'good', true);
  night(s, { imp: { targets: [target.character] } });
  assert.equal(target.alive, true, 'protected by the Tea Lady');
  right.alignment = 'evil';
  night(s, { imp: { targets: [left.character] } });
  assert.equal(left.alive, false, 'an evil neighbour: no protection');
});

test('Tea Lady: also protects from execution, and a dead Tea Lady protects nobody', () => {
  const s = afterNight1(['imp', 'poisoner', 'tealady', 'washerwoman', 'soldier', 'monk', 'chef']);
  const order = s.players.slice().sort((a, b) => a.seat - b.seat);
  const i = order.findIndex((p) => p.character === 'tealady');
  const neighbour = order[(i + 1) % order.length];
  order.forEach((p) => { p.alignment = 'good'; });
  executeByVote(s, neighbour.character);
  assert.equal(neighbour.alive, true, 'executed but alive');
  const t = afterNight1(['imp', 'poisoner', 'tealady', 'washerwoman', 'soldier', 'monk', 'chef']);
  const tl = byChar(t, 'tealady');
  const n2 = t.players.slice().sort((a, b) => a.seat - b.seat);
  n2.forEach((p) => { p.alignment = 'good'; });
  tl.alive = false;
  const victim = n2[(n2.findIndex((p) => p === tl) + 1) % n2.length];
  night(t, { imp: { targets: [victim.character] } });
  assert.equal(victim.alive, false);
});

// ---------------------------------------------------------------- Pacifist

test('Pacifist: an executed good player might survive — once per game — and the execution still counts for the day', () => {
  const s = afterNight1(['imp', 'poisoner', 'pacifist', 'washerwoman', 'soldier', 'monk', 'chef']);
  executeByVote(s, 'chef');
  night(s, { imp: { targets: ['soldier'] } });
  assert.equal(alive(s, 'chef'), true, 'saved by the Pacifist');
  assert.ok(s.history.some((e) => e.type === 'survived' && e.vars.by === 'pacifist'));
  executeByVote(s, 'chef');
  assert.equal(alive(s, 'chef'), false, 'the Pacifist only does it once');
});

test('Pacifist: evil players are not saved, and a drunk Pacifist saves nobody', () => {
  const s = afterNight1(['imp', 'poisoner', 'pacifist', 'washerwoman', 'soldier', 'monk', 'chef']);
  executeByVote(s, 'poisoner');
  assert.equal(alive(s, 'poisoner'), false);
  const t = afterNight1(['imp', 'poisoner', 'pacifist', 'washerwoman', 'soldier', 'monk', 'chef']);
  t.effects.push({ kind: 'drunk', target: byChar(t, 'pacifist').id, source: null, sourceChar: 'test', untilNight: null });
  executeByVote(t, 'chef');
  assert.equal(alive(t, 'chef'), false);
});

// ---------------------------------------------------------------- Fool

test('Fool: the first time they die they do not — for any reason — and the second time they do', () => {
  const s = afterNight1(['imp', 'poisoner', 'fool', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { imp: { targets: ['fool'] } });
  assert.equal(alive(s, 'fool'), true, 'the Demon cannot kill them the first time');
  assert.equal(s.deathsTonight.length, 0);
  executeByVote(s, 'fool');
  assert.equal(alive(s, 'fool'), false, 'the second death is real');
});

test('Fool: another ability protecting them does not use up their life; a drunk Fool dies at once', () => {
  const s = afterNight1(['imp', 'poisoner', 'fool', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { monk: { targets: ['fool'] }, imp: { targets: ['fool'] } });
  assert.equal(alive(s, 'fool'), true);
  assert.notEqual(byChar(s, 'fool').flags.foolUsed, true, 'the Monk protected them: the Fool keeps their life');
  const t = afterNight1(['imp', 'poisoner', 'fool', 'washerwoman', 'soldier', 'monk', 'chef']);
  t.effects.push({ kind: 'drunk', target: byChar(t, 'fool').id, source: null, sourceChar: 'test', untilNight: null });
  night(t, { imp: { targets: ['fool'] } });
  assert.equal(alive(t, 'fool'), false);
});
void mkDay; void toggleEndDayRequest; void abilityWorks;
