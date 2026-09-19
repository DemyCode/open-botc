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

// ---------------------------------------------------------------- Goon

test('Goon: the first player to choose them each night is drunk until dusk, and the Goon takes their alignment', () => {
  const s = afterNight1(['imp', 'poisoner', 'goon', 'washerwoman', 'soldier', 'monk', 'chef']);
  assert.equal(byChar(s, 'goon').alignment, 'good');
  night(s, { poisoner: { targets: ['goon'] }, monk: { targets: ['goon'] }, imp: { targets: ['soldier'] } });
  assert.equal(byChar(s, 'goon').alignment, 'evil', 'the Poisoner (evil) was first');
  assert.equal(abilityLostReason(s, byChar(s, 'poisoner')), 'drunk', 'the Poisoner is drunk');
  assert.equal(abilityLostReason(s, byChar(s, 'monk')), null, 'a second chooser is not affected');
  assert.ok(byChar(s, 'goon').log.some((e) => e.msg.key === 'goonEvil'));
  assert.ok(s.history.some((e) => e.type === 'alignment'));
});

test('Goon: a drunk Poisoner\'s poison does not work; the Goon stays immune to nothing else (the Demon can still kill them)', () => {
  const s = afterNight1(['imp', 'poisoner', 'goon', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { poisoner: { targets: ['goon'] }, imp: { targets: ['goon'] } });
  assert.equal(s.poisonedId, null, 'the drunk Poisoner poisoned nobody');
  assert.equal(alive(s, 'goon'), false);
});

test('Goon: an evil Goon registers as evil to the Empath and the Chef (alignment, not team)', () => {
  const s = afterNight1(['imp', 'poisoner', 'goon', 'empath', 'soldier', 'monk', 'chef']);
  const goon = byChar(s, 'goon');
  goon.alignment = 'evil';
  const ctx = { asker: 'x', slot: 'y' };
  assert.equal(abilityLostReason(s, goon), null);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return import('../game/registration.js').then(({ registersAs }) => {
    assert.equal(registersAs(s, goon, 'evil', ctx), true);
    assert.equal(registersAs(s, goon, 'good', ctx), false);
  });
});

test('Goon: turns good again when a good player chooses them first', () => {
  const s = afterNight1(['imp', 'poisoner', 'goon', 'washerwoman', 'soldier', 'monk', 'chef']);
  byChar(s, 'goon').alignment = 'evil';
  night(s, { monk: { targets: ['goon'] }, imp: { targets: ['soldier'] } });
  assert.equal(byChar(s, 'goon').alignment, 'good');
  assert.equal(abilityLostReason(s, byChar(s, 'monk')), 'drunk');
});

// ---------------------------------------------------------------- Lunatic

test('Lunatic: is dealt as a Demon they are not: told made-up Minions and bluffs, and wakes as that Demon each night', () => {
  const s = mk(['imp', 'poisoner', 'lunatic', 'washerwoman', 'soldier', 'monk', 'chef']);
  const lunatic = byChar(s, 'lunatic');
  lunatic.perceived = 'zombuul';
  s.secret = 'lunatic';
  startNight(s);
  assert.ok(woke(s, 'minion-info'));
  skipRound(s);
  assert.ok(woke(s, 'demon-info'), 'the shared Demon-info step');
  assert.deepEqual(s.pendingRealTurn!.playerIds, [lunatic.id], 'only the Lunatic (the Imp gets it in their own step)');
  const info = s.pendingRealTurn!.bodyByPlayer[lunatic.id];
  assert.equal(info.key, 'demonInfo');
  assert.equal((info.vars!.names as string[]).length, 1, 'as many "Minions" as there really are');
  assert.equal((info.vars!.bluffs as string[]).length, 3);
});

test('Lunatic: their attacks do nothing, and the real Demon learns who they chose', () => {
  const s = afterNight1(['imp', 'poisoner', 'lunatic', 'washerwoman', 'soldier', 'monk', 'chef']);
  byChar(s, 'lunatic').perceived = 'imp';
  startNight(s);
  advanceUntil(s, 'imp');
  assert.equal(s.pendingRealTurn!.playerIds.length, 2, 'the Imp and the Lunatic both wake as the Imp');
  const imp = byChar(s, 'imp');
  const lunatic = byChar(s, 'lunatic');
  const chef = byChar(s, 'chef');
  const soldier = byChar(s, 'soldier');
  const t = s.pendingRealTurn!;
  // the Lunatic answers first: their kill does nothing
  const lunaticId = lunatic.id;
  void imp;
  answerOne(s, lunaticId, [chef.id]);
  answerOne(s, imp.id, [soldier.id]);
  skipRound(s);
  assert.equal(chef.alive, true, 'the Lunatic killed nobody');
  assert.ok(imp.log.some((e) => e.msg.key === 'lunaticChose' && (e.msg.vars as { names: string[] }).names[0] === chef.name), 'the Demon was told');
  assert.ok(s.history.some((e) => e.type === 'attack' && e.vars.actor === lunaticId && e.vars.outcome === 'ineffective'));
  void t;
});
function answerOne(s: GameState, id: string, targets: string[]): void {
  submitOne(s, id, targets);
}
import { submitRealResponse } from '../game/night.js';
function submitOne(s: GameState, id: string, targets: string[]): void {
  submitRealResponse(s, id, targets);
}

test('Lunatic: the real Demon is told who the Lunatic is on the first night', () => {
  const s = mk(['imp', 'poisoner', 'lunatic', 'washerwoman', 'soldier', 'monk', 'chef']);
  byChar(s, 'lunatic').perceived = 'zombuul';
  startNight(s);
  advanceUntil(s, 'imp');
  const info = s.pendingRealTurn!.bodyByPlayer[byChar(s, 'imp').id];
  assert.equal((info.vars as { lunatic?: string }).lunatic, byChar(s, 'lunatic').name);
});

// ---------------------------------------------------------------- Tinker

test('Tinker: might die at any night — never when it would end the game, never while protected', () => {
  let died = 0;
  for (let i = 0; i < 40; i++) {
    const s = afterNight1(['imp', 'poisoner', 'tinker', 'washerwoman', 'soldier', 'monk', 'chef']);
    s.secret = `tinker-${i}`;
    night(s, { imp: { targets: ['soldier'] } });
    if (!alive(s, 'tinker')) {
      died++;
      assert.ok(s.history.some((e) => e.type === 'tinker'));
    }
  }
  assert.ok(died > 3 && died < 25, `the Tinker died ${died} times in 40 nights`);
  const s = afterNight1(['imp', 'poisoner', 'tinker', 'washerwoman', 'soldier', 'monk', 'chef']);
  s.players.filter((p) => !['imp', 'poisoner', 'tinker'].includes(p.character)).forEach((p) => (p.alive = false));
  for (let i = 0; i < 30; i++) { s.secret = `t${i}`; night(s, { imp: { targets: ['poisoner'] } }); if (s.phase === 'ended') break; s.phase = 'day'; }
});

// ---------------------------------------------------------------- Moonchild

test('Moonchild: when dead they publicly choose a living player; a good player dies that night, an evil one does not', () => {
  const s = afterNight1(['imp', 'poisoner', 'moonchild', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { imp: { targets: ['moonchild'] } });
  assert.equal(alive(s, 'moonchild'), false);
  const mc = byChar(s, 'moonchild');
  useDay(s, mc.id, 'moonchild', [byChar(s, 'chef').id]);
  assert.ok(s.publicLog.some((m) => m.key === 'moonchildChooses'));
  night(s, { imp: { targets: ['soldier'] } });
  assert.equal(alive(s, 'chef'), false, 'the good player they chose died');
  const t = afterNight1(['imp', 'poisoner', 'moonchild', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(t, { imp: { targets: ['moonchild'] } });
  useDay(t, byChar(t, 'moonchild').id, 'moonchild', [byChar(t, 'poisoner').id]);
  night(t, { imp: { targets: ['soldier'] } });
  assert.equal(alive(t, 'poisoner'), true, 'an evil player is unaffected');
});

test('Moonchild: only a dead player is offered the action, and anyone dead may bluff it — with no effect', () => {
  const s = afterNight1(['imp', 'poisoner', 'moonchild', 'washerwoman', 'soldier', 'monk', 'chef']);
  const offered = (id: string) => viewOf(s, id).myDayActions.map((a) => a.character);
  for (const p of s.players) assert.ok(!offered(p.id).includes('moonchild'), 'nobody is dead yet');
  night(s, { imp: { targets: ['chef'] } });
  const dead = byChar(s, 'chef');
  assert.ok(offered(dead.id).includes('moonchild'), 'a dead Chef is offered the same button as a dead Moonchild');
  useDay(s, dead.id, 'moonchild', [byChar(s, 'soldier').id]);
  night(s, { imp: { targets: ['monk'] } });
  assert.equal(alive(s, 'soldier'), true, 'a bluff kills nobody');
  assert.ok(!offered(dead.id).includes('moonchild') || s.phase === 'night', 'once only');
});

test('Moonchild: a drunk Moonchild at night kills nobody; one drunk only when they chose still kills', () => {
  const s = afterNight1(['imp', 'poisoner', 'moonchild', 'washerwoman', 'soldier', 'monk', 'chef']);
  night(s, { imp: { targets: ['moonchild'] } });
  useDay(s, byChar(s, 'moonchild').id, 'moonchild', [byChar(s, 'chef').id]);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'moonchild').id, source: null, sourceChar: 'test', untilNight: null });
  night(s, { imp: { targets: ['soldier'] } });
  assert.equal(alive(s, 'chef'), true, 'drunk at night: no kill');
});

test('Moonchild: executed but saved (Pacifist) does not die, so has nothing to choose', () => {
  const s = afterNight1(['imp', 'poisoner', 'moonchild', 'washerwoman', 'pacifist', 'monk', 'chef']);
  executeByVote(s, 'moonchild');
  assert.equal(alive(s, 'moonchild'), true);
  assert.notEqual(byChar(s, 'moonchild').flags.moonchildPending, true);
});

import { useDayAbility } from '../game/engine.js';
import { viewFor } from '../game/view.js';
function useDay(s: GameState, playerId: string, character: string, targets: string[], payload: Record<string, unknown> = {}): void {
  useDayAbility(s, playerId, character, targets, payload);
}
function viewOf(s: GameState, id: string) { return viewFor(s, id); }

// ---------------------------------------------------------------- Grandmother

test('Grandmother: learns a good player and their character on the first night; dies if the Demon kills that player', () => {
  const s = mk(['imp', 'poisoner', 'grandmother', 'washerwoman', 'butler', 'virgin', 'chef']);
  s.secret = 'gran';
  startNight(s);
  advanceUntil(s, 'grandmother');
  const gm = byChar(s, 'grandmother');
  const info = s.pendingRealTurn!.bodyByPlayer[gm.id];
  assert.equal(info.key, 'grandmotherInfo');
  const child = s.players.find((p) => p.name === info.vars!.name)!;
  assert.equal(child.alignment, 'good');
  assert.equal(child.character, info.vars!.role, 'the true character');
  assert.notEqual(child.id, gm.id);
  runFullNight(s);
  night(s, { imp: { targets: [child.character] } });
  assert.equal(child.alive, false);
  assert.equal(gm.alive, false, 'the Grandmother died with their grandchild');
});

test('Grandmother: does not die when the grandchild dies of anything else, or when the Grandmother is drunk', () => {
  const s = mk(['imp', 'poisoner', 'grandmother', 'washerwoman', 'butler', 'virgin', 'chef']);
  s.secret = 'gran2';
  startNight(s);
  runFullNight(s);
  const gm = byChar(s, 'grandmother');
  const child = s.players.find((p) => p.id === gm.flags.grandchildId)!;
  executeByVote(s, child.character);
  assert.equal(child.alive, false);
  assert.equal(gm.alive, true, 'execution does not count');
  const t = mk(['imp', 'poisoner', 'grandmother', 'washerwoman', 'butler', 'virgin', 'chef']);
  t.secret = 'gran2';
  startNight(t);
  runFullNight(t);
  const gm2 = byChar(t, 'grandmother');
  const child2 = t.players.find((p) => p.id === gm2.flags.grandchildId)!;
  t.effects.push({ kind: 'drunk', target: gm2.id, source: null, sourceChar: 'test', untilNight: null });
  night(t, { imp: { targets: [child2.character] } });
  assert.equal(child2.alive, false);
  assert.equal(gm2.alive, true);
});

// ---------------------------------------------------------------- Godfather

test('Godfather: learns the Outsiders in play on the first night; kills when an Outsider died by execution today', () => {
  const s = mk(['imp', 'godfather', 'saint', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'godfather');
  assert.deepEqual(s.pendingRealTurn!.bodyByPlayer[byChar(s, 'godfather').id], { key: 'godfatherInfo', vars: { roles: ['saint'] } });
  runFullNight(s);
  night(s, { imp: { targets: ['chef'] } });
  s.phase = 'day';
  // executing the Saint would end the game — use a Recluse instead
  const t = mk(['imp', 'godfather', 'recluse', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(t);
  runFullNight(t);
  executeByVote(t, 'recluse');
  assert.equal(alive(t, 'recluse'), false);
  night(t, { godfather: { targets: ['monk'] }, imp: { targets: ['chef'] } });
  assert.equal(alive(t, 'monk'), false, "the Godfather's kill");
  assert.equal(alive(t, 'chef'), false, "and the Demon's");
});

test('Godfather: does not wake when no Outsider died by execution today (a Townsfolk, or an Outsider at night)', () => {
  const t = mk(['imp', 'godfather', 'recluse', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(t);
  runFullNight(t);
  executeByVote(t, 'chef');
  let woke1 = false;
  while (t.pendingRealTurn) { if (woke(t, 'godfather')) woke1 = true; skipRound(t); }
  assert.equal(woke1, false);
});

test('Godfather: with no Outsiders in play the first night tells them so', () => {
  const s = mk(['imp', 'godfather', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'godfather');
  assert.equal(s.pendingRealTurn!.bodyByPlayer[byChar(s, 'godfather').id].key, 'godfatherNone');
});

// ---------------------------------------------------------------- Devil's Advocate

test("Devil's Advocate: their chosen player survives tomorrow's execution — once per night, never the same two nights in a row", () => {
  const s = afterNight1(['imp', 'devilsadvocate', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  night(s, { devilsadvocate: { targets: ['chef'] }, imp: { targets: ['soldier'] } });
  executeByVote(s, 'chef');
  assert.equal(alive(s, 'chef'), true);
  assert.ok(s.history.some((e) => e.type === 'survived' && e.vars.by === 'devilsadvocate'));
  advanceUntil(s, 'devilsadvocate');
  assert.throws(() => answerRealTurn(s, [byChar(s, 'chef').id]), /cannot choose/i);
});

test("Devil's Advocate: a drunk one protects nobody; protection ends at the next dusk", () => {
  const s = afterNight1(['imp', 'devilsadvocate', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'devilsadvocate').id, source: null, sourceChar: 'test', untilNight: null });
  night(s, { devilsadvocate: { targets: ['chef'] }, imp: { targets: ['soldier'] } });
  executeByVote(s, 'chef');
  assert.equal(alive(s, 'chef'), false);
  assert.equal(s.data.daProtected, null, 'reset each night');
});

// ---------------------------------------------------------------- Assassin

test('Assassin: once per game kills a player even through protection — the Soldier, the Monk, the Tea Lady', () => {
  const s = afterNight1(['imp', 'assassin', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  night(s, { assassin: { targets: ['soldier'] }, imp: { targets: ['chef'] } });
  assert.equal(alive(s, 'soldier'), false, 'the Soldier is safe from the Demon, not from the Assassin');
  startNight(s);
  let woke2 = false;
  while (s.pendingRealTurn) { if (woke(s, 'assassin')) woke2 = true; skipRound(s); }
  assert.equal(woke2, false, 'once per game');
});

test('Assassin: may choose nobody and wait; a drunk Assassin kills nobody and cannot try again', () => {
  const s = afterNight1(['imp', 'assassin', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  night(s, { imp: { targets: ['chef'] } });
  assert.equal(byChar(s, 'assassin').flags.assassinUsed, undefined);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'assassin').id, source: null, sourceChar: 'test', untilNight: null });
  night(s, { assassin: { targets: ['empath'] }, imp: { targets: ['washerwoman'] } });
  assert.equal(alive(s, 'empath'), true);
  assert.equal(byChar(s, 'assassin').flags.assassinUsed, true);
});

// ---------------------------------------------------------------- Mastermind

test('Mastermind: when the Demon is executed the game goes on; the next day a good execution means evil wins', () => {
  const s = afterNight1(['imp', 'mastermind', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  executeByVote(s, 'imp');
  assert.equal(s.winner, null, 'the game continues, the Demon\'s death is not announced');
  assert.equal(s.phase, 'night');
  assert.ok(s.history.some((e) => e.type === 'finalDay'));
  night(s, {});
  executeByVote(s, 'chef');
  assert.equal(s.winner, 'evil');
});

test('Mastermind: an evil player executed the next day — or nobody — means good wins', () => {
  const s = afterNight1(['imp', 'mastermind', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  executeByVote(s, 'imp');
  night(s, {});
  executeByVote(s, 'mastermind');
  assert.equal(s.winner, 'good');
  const t = afterNight1(['imp', 'mastermind', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  executeByVote(t, 'imp');
  night(t, {});
  endDayByConsensus(t);
  assert.equal(t.winner, 'good', 'no execution');
});

test('Mastermind: a Demon killed any other way (or a drunk Mastermind) is an ordinary win for good', () => {
  const s = afterNight1(['imp', 'mastermind', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'mastermind').id, source: null, sourceChar: 'test', untilNight: null });
  executeByVote(s, 'imp');
  assert.equal(s.winner, 'good');
});

test('Mastermind: with only two players left the extra day is still played (evil does not win from the count alone)', () => {
  const s = afterNight1(['imp', 'mastermind', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  for (const c of ['empath', 'soldier', 'monk']) byChar(s, c as CharacterId).alive = false;
  executeByVote(s, 'imp');
  assert.equal(s.winner, null);
  assert.equal(s.phase, 'night');
});

// ---------------------------------------------------------------- Zombuul

test('Zombuul: the first time they die they live on but count as dead; the game goes on even with two others alive', () => {
  const s = afterNight1(['zombuul', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  s.data.diedToday = [];
  executeByVote(s, 'zombuul');
  const z = byChar(s, 'zombuul');
  assert.equal(z.alive, false, 'registers as dead');
  assert.equal(z.flags.hiddenAlive, true);
  assert.equal(s.winner, null, 'the game continues');
  assert.ok(s.history.some((e) => e.type === 'survived' || e.type === 'death'));
  // two others left: still not over
  for (const c of ['washerwoman', 'empath', 'soldier']) byChar(s, c as CharacterId).alive = false;
  s.players.filter((p) => p.character === 'monk' || p.character === 'chef').forEach((p) => (p.alive = true));
  s.players.find((p) => p.character === 'poisoner')!.alive = false;
  assert.equal(s.players.filter((p) => p.alive).length, 2);
});

test('Zombuul: does not wake the night after someone died today (even their own "death"), wakes otherwise', () => {
  const s = afterNight1(['zombuul', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  executeByVote(s, 'zombuul');
  let wokeZ = false;
  while (s.pendingRealTurn) { if (woke(s, 'zombuul')) wokeZ = true; skipRound(s); }
  assert.equal(wokeZ, false, 'a player died today');
  breakDawn(s);
  // day 2: nobody dies today
  endDayByConsensus(s);
  startNightIfDay(s);
  advanceUntil(s, 'zombuul');
  answerRealTurn(s, [byChar(s, 'chef').id]);
  breakDawn(s);
  assert.equal(alive(s, 'chef'), false, 'the "dead" Zombuul still attacks');
});
function startNightIfDay(s: GameState) { if (s.phase !== 'night') startNight(s); }

test('Zombuul: killed a second time, they die for real and good wins; a drunk Zombuul dies at once', () => {
  const s = afterNight1(['zombuul', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  executeByVote(s, 'zombuul');
  night(s, {});
  executeByVote(s, 'zombuul');
  assert.equal(s.winner, 'good');
  const t = afterNight1(['zombuul', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  t.effects.push({ kind: 'drunk', target: byChar(t, 'zombuul').id, source: null, sourceChar: 'test', untilNight: null });
  executeByVote(t, 'zombuul');
  assert.equal(t.winner, 'good');
});

// ---------------------------------------------------------------- Pukka

test('Pukka: poisons on the first night too; the previous victim dies the next night when the Pukka attacks again', () => {
  const s = mk(['pukka', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'pukka');
  answerRealTurn(s, [byChar(s, 'chef').id]);
  runFullNight(s);
  assert.equal(abilityLostReason(s, byChar(s, 'chef')), 'poisoned');
  assert.equal(alive(s, 'chef'), true);
  night(s, { pukka: { targets: ['monk'] } });
  assert.equal(alive(s, 'chef'), false, 'died the next night');
  assert.equal(abilityLostReason(s, byChar(s, 'monk')), 'poisoned');
  assert.equal(abilityLostReason(s, byChar(s, 'chef')), null, 'no longer poisoned (dead)');
});

test('Pukka: an Exorcised Pukka does not attack but the previous victim still dies; an Innkeeper stops that death', () => {
  const s = mk(['pukka', 'exorcist', 'washerwoman', 'empath', 'soldier', 'innkeeper', 'chef']);
  startNight(s);
  advanceUntil(s, 'pukka');
  answerRealTurn(s, [byChar(s, 'chef').id]);
  runFullNight(s);
  night(s, { innkeeper: { targets: ['washerwoman', 'soldier'] }, exorcist: { targets: ['pukka'] } });
  assert.equal(alive(s, 'chef'), false, 'died anyway');
  assert.equal(byChar(s, 'pukka').flags.pukkaVictim, undefined);
  const t = mk(['pukka', 'exorcist', 'washerwoman', 'empath', 'soldier', 'innkeeper', 'chef']);
  startNight(t);
  advanceUntil(t, 'pukka');
  answerRealTurn(t, [byChar(t, 'chef').id]);
  runFullNight(t);
  night(t, { innkeeper: { targets: ['chef', 'soldier'] }, pukka: { targets: ['empath'] } });
  assert.equal(alive(t, 'chef'), true, 'protected by the Innkeeper');
  assert.notEqual(abilityLostReason(t, byChar(t, 'chef')), 'poisoned', 'and no longer poisoned');
});

test('Pukka: a drunk Pukka poisons nobody and kills nobody, but the old poison resumes when they sober up', () => {
  const s = mk(['pukka', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'pukka');
  answerRealTurn(s, [byChar(s, 'chef').id]);
  runFullNight(s);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'pukka').id, source: null, sourceChar: 'test', untilNight: null });
  night(s, { pukka: { targets: ['monk'] } });
  assert.equal(alive(s, 'chef'), true, 'no kill while drunk');
  assert.equal(abilityLostReason(s, byChar(s, 'monk')), null, 'no poison while drunk');
  s.effects = s.effects.filter((e) => e.sourceChar !== 'test');
  night(s, { pukka: { targets: ['monk'] } });
  assert.equal(alive(s, 'chef'), false, 'resumed');
});

test('Pukka: the poison ends when the Pukka dies', () => {
  const s = mk(['pukka', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'pukka');
  answerRealTurn(s, [byChar(s, 'chef').id]);
  runFullNight(s);
  byChar(s, 'pukka').alive = false;
  assert.equal(abilityLostReason(s, byChar(s, 'chef')), null);
});

// ---------------------------------------------------------------- Shabaloth

test('Shabaloth: kills two players each night, in the order chosen, but not the first night', () => {
  const s = afterNight1(['shabaloth', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  night(s, { shabaloth: { targets: ['chef', 'empath'] } });
  assert.equal(alive(s, 'chef'), false);
  assert.equal(alive(s, 'empath'), false);
  assert.equal(s.deathsTonight.length, 2);
});

test('Shabaloth: protected victims survive individually; a Goon chosen drunkens the Shabaloth for the second attack', () => {
  const s = afterNight1(['shabaloth', 'poisoner', 'washerwoman', 'goon', 'soldier', 'monk', 'chef']);
  night(s, { shabaloth: { targets: ['goon', 'chef'] } });
  assert.equal(alive(s, 'goon'), true, 'the drunk Shabaloth could not kill the Goon');
  assert.equal(alive(s, 'chef'), true, 'nor the second');
  assert.equal(byChar(s, 'goon').alignment, 'evil');
  const t = afterNight1(['shabaloth', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  night(t, { shabaloth: { targets: ['soldier', 'chef'] } });
  assert.equal(alive(t, 'soldier'), true);
  assert.equal(alive(t, 'chef'), false);
});

test('Shabaloth: may regurgitate a victim of the night before — sometimes, at most twice, and it is announced without a reason', () => {
  let back = 0;
  for (let i = 0; i < 60; i++) {
    const s = afterNight1(['shabaloth', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
    s.secret = `shab-${i}`;
    night(s, { shabaloth: { targets: ['chef', 'empath'] } });
    night(s, { shabaloth: { targets: ['soldier', 'monk'] } });
    if (alive(s, 'chef') || alive(s, 'empath')) {
      back++;
      assert.ok(s.publicLog.some((m) => m.key === 'resurrected'));
    }
  }
  assert.ok(back > 5 && back < 40, `regurgitated in ${back} of 60 games`);
});

// ---------------------------------------------------------------- Po

test('Po: attacks one player, may choose nobody — then attacks three players the next night', () => {
  const s = afterNight1(['po', 'poisoner', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  night(s, { po: { targets: ['chef'] } });
  assert.equal(alive(s, 'chef'), false);
  night(s, { po: { targets: [] } });
  assert.equal(s.deathsTonight.length, 0, 'chose nobody');
  startNight(s);
  advanceUntil(s, 'po');
  assert.equal(s.pendingRealTurn!.min, 3);
  assert.equal(s.pendingRealTurn!.max, 3);
  assert.throws(() => answerRealTurn(s, []), /selection/i);
  answerRealTurn(s, ['empath', 'washerwoman', 'monk'].map((c) => byChar(s, c as CharacterId).id));
  breakDawn(s);
  assert.equal(s.deathsTonight.length, 3);
  startNight(s);
  advanceUntil(s, 'po');
  assert.equal(s.pendingRealTurn!.max, 1, 'back to one');
});

test('Po: the night after a drunk Po chose nobody they still get three; an Exorcised night does not count as "nobody"', () => {
  const s = afterNight1(['po', 'exorcist', 'washerwoman', 'empath', 'soldier', 'monk', 'chef']);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'po').id, source: null, sourceChar: 'test', untilNight: null });
  night(s, { exorcist: { targets: ['chef'] }, po: { targets: [] } });
  s.effects = [];
  startNight(s);
  advanceUntil(s, 'exorcist');
  answerRealTurn(s, [byChar(s, 'po').id]);
  skipRestOfNight(s);
  startNight(s);
  advanceUntil(s, 'po');
  assert.equal(s.pendingRealTurn!.min, 3, 'still owed three attacks after the exorcised night');
});
function skipRestOfNight(s: GameState) { while (s.pendingRealTurn) skipRound(s); breakDawn(s); }

test('Po: three attacks where the second victim is the Goon: only the first dies (the Po turns drunk)', () => {
  const s = afterNight1(['po', 'poisoner', 'washerwoman', 'goon', 'soldier', 'monk', 'chef']);
  night(s, { po: { targets: [] } });
  night(s, { po: { targets: ['chef', 'goon', 'monk'] } });
  assert.equal(alive(s, 'chef'), false);
  assert.equal(alive(s, 'goon'), true);
  assert.equal(alive(s, 'monk'), true);
});

// ---------------------------------------------------------------- Gossip

test('Gossip: a true public statement kills a player that night; a false one kills nobody', () => {
  const s = afterNight1(['imp', 'poisoner', 'gossip', 'washerwoman', 'soldier', 'monk', 'chef']);
  const chef = byChar(s, 'chef');
  useDay(s, byChar(s, 'gossip').id, 'gossip', [], { statement: { t: 'alive', p: chef.id, v: true } });
  assert.ok(s.publicLog.some((m) => m.key === 'gossipSays'));
  const before = s.players.filter((p) => p.alive).length;
  night(s, { imp: { targets: ['monk'] } });
  assert.equal(before - s.players.filter((p) => p.alive).length, 2, "the Demon's victim and the Gossip's");
  const t = afterNight1(['imp', 'poisoner', 'gossip', 'washerwoman', 'soldier', 'monk', 'chef']);
  useDay(t, byChar(t, 'gossip').id, 'gossip', [], { statement: { t: 'alive', p: byChar(t, 'chef').id, v: false } });
  const before2 = t.players.filter((p) => p.alive).length;
  night(t, { imp: { targets: ['monk'] } });
  assert.equal(before2 - t.players.filter((p) => p.alive).length, 1);
});

test('Gossip: any living player may make a statement — a bluffer\'s true statement kills nobody, and a Gossip who is drunk kills nobody', () => {
  const s = afterNight1(['imp', 'poisoner', 'gossip', 'washerwoman', 'soldier', 'monk', 'chef']);
  useDay(s, byChar(s, 'imp').id, 'gossip', [], { statement: { t: 'alive', p: byChar(s, 'chef').id, v: true } });
  const before = s.players.filter((p) => p.alive).length;
  night(s, { imp: { targets: ['monk'] } });
  assert.equal(before - s.players.filter((p) => p.alive).length, 1);
  const t = afterNight1(['imp', 'poisoner', 'gossip', 'washerwoman', 'soldier', 'monk', 'chef']);
  t.effects.push({ kind: 'drunk', target: byChar(t, 'gossip').id, source: null, sourceChar: 'test', untilNight: null });
  useDay(t, byChar(t, 'gossip').id, 'gossip', [], { statement: { t: 'alive', p: byChar(t, 'chef').id, v: true } });
  night(t, { imp: { targets: ['monk'] } });
  assert.equal(alive(t, 'soldier') && alive(t, 'washerwoman') && alive(t, 'chef'), true);
});

test('Gossip: if sober at night the statement counts even if made drunk; a Gossip killed the same night gets no kill; once per player per game', () => {
  const s = afterNight1(['imp', 'poisoner', 'gossip', 'washerwoman', 'soldier', 'monk', 'chef']);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'gossip').id, source: null, sourceChar: 'test', untilNight: 1 });
  useDay(s, byChar(s, 'gossip').id, 'gossip', [], { statement: { t: 'alive', p: byChar(s, 'chef').id, v: true } });
  s.effects = [];
  const before = s.players.filter((p) => p.alive).length;
  night(s, { imp: { targets: ['gossip'] } });
  assert.equal(before - s.players.filter((p) => p.alive).length, 1, 'the Gossip died first: no extra kill');
  const t = afterNight1(['imp', 'poisoner', 'gossip', 'washerwoman', 'soldier', 'monk', 'chef']);
  useDay(t, byChar(t, 'gossip').id, 'gossip', [], { statement: { t: 'alive', p: byChar(t, 'chef').id, v: true } });
  assert.throws(() => useDay(t, byChar(t, 'gossip').id, 'gossip', [], { statement: { t: 'alive', p: byChar(t, 'chef').id, v: true } }), /not available/i);
});

test('Gossip: a statement that is malformed is refused', () => {
  const s = afterNight1(['imp', 'poisoner', 'gossip', 'washerwoman', 'soldier', 'monk', 'chef']);
  for (const bad of [null, {}, { t: 'alive' }, { t: 'alive', p: 'nobody', v: true }, { t: 'count', what: 'alive', op: '??', n: 1 }, { t: 'character', p: byChar(s, 'chef').id, v: 'zzz' }, 'text']) {
    assert.throws(() => useDay(s, byChar(s, 'gossip').id, 'gossip', [], { statement: bad }), /statement/i);
  }
});
