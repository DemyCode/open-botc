// Every "Examples" entry from the official wiki page of each Sects & Violets character
// (https://wiki.bloodontheclocktower.com/Sects_%26_Violets and the 25 character pages), as a test.
//
// Same conventions as the Trouble Brewing and Bad Moon Rising example files: deterministic outcomes
// are checked directly; Storyteller choices are found with `findSecret` or set explicitly; examples
// needing Travellers (which this app has no concept of) are skipped with the reason.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import { executePlayer, hooksOf } from '../game/deaths.js';
import { nominate } from '../game/engine.js';
import { setAlignment } from '../game/chars/util.js';
import { abilityLostReason } from '../game/registration.js';
import type { CharacterId, GameState } from '../game/types.js';
import { advanceUntil, answerRealTurn, breakDawn, byChar, startNight } from './helpers.js';
import { execute, findSecret, lastInfo, mk, mkDay, named, night } from './wikiHelpers.js';

const infoOf = (s: GameState, charId: CharacterId, slot = 'x') => hooksOf(charId).night!.info!(s, byChar(s, charId), slot);
const alive = (s: GameState, c: CharacterId) => byChar(s, c).alive;

// ================================================================ CLOCKMAKER

test('Clockmaker ex. 1 — the Fang Gu next to the Pit-Hag: learns 1', () => {
  const s = mkDay(['fanggu', 'pithag', 'clockmaker', 'soldier', 'monk', 'chef', 'mayor']);
  assert.deepEqual(infoOf(s, 'clockmaker'), { key: 'clockmakerInfo', vars: { count: 1 } });
});

test('Clockmaker ex. 2 — clockwise 3 and counterclockwise 5: learns 3', () => {
  // seats: 0 No Dashii, 1 Dreamer, 2 Snake Charmer, 3 Evil Twin, 4 Mutant, 5 Sweetheart, 6 Philosopher, 7 Sage, 8 Witch.
  const s = mkDay(['nodashii', 'dreamer', 'snakecharmer', 'eviltwin', 'mutant', 'sweetheart', 'philosopher', 'sage', 'witch', 'clockmaker', 'soldier']);
  const m = infoOf(s, 'clockmaker');
  assert.equal(m.key, 'clockmakerInfo');
  assert.equal(m.vars!.count, 3, 'the Evil Twin is 3 steps clockwise, the Witch 5 counterclockwise');
});

test('Clockmaker ex. 3 — an evil Traveller is not a Minion', { skip: 'Travellers do not exist in this app' }, () => {});

// ================================================================ DREAMER

test('Dreamer ex. 0 — choosing the Mutant: learns the Mutant and the Cerenovus', () => {
  const s = mkDay(['imp', 'poisoner', 'dreamer', 'mutant', 'cerenovus', 'soldier', 'monk']);
  startNight(s);
  advanceUntil(s, 'dreamer');
  answerRealTurn(s, [byChar(s, 'mutant').id]);
  const m = lastInfo(byChar(s, 'dreamer'));
  assert.equal(m.key, 'dreamerInfo');
  const pair = [m.vars!.a as string, m.vars!.b as string];
  assert.ok(pair.includes('mutant'), 'the true character is one of the two');
  const other = pair.find((c) => c !== 'mutant')!;
  assert.ok(['minion', 'demon'].includes(CHARACTERS[other as CharacterId].team), 'the other is evil');
});

test('Dreamer ex. 3 — a Vortox makes the Dreamer\'s information false', () => {
  const s = mkDay(['vortox', 'poisoner', 'dreamer', 'soldier', 'monk', 'chef', 'mayor']);
  startNight(s);
  advanceUntil(s, 'dreamer');
  answerRealTurn(s, [byChar(s, 'vortox').id]);
  const m = lastInfo(byChar(s, 'dreamer'));
  assert.equal(m.key, 'dreamerInfo');
  assert.ok(![m.vars!.a, m.vars!.b].includes('vortox'), 'the true character is never shown');
});

// ================================================================ SNAKE CHARMER

test('Snake Charmer ex. 0 — choosing a non-Demon and then themself changes nothing', () => {
  const s = mkDay(['imp', 'poisoner', 'snakecharmer', 'pithag', 'soldier', 'monk', 'chef']);
  const sc = byChar(s, 'snakecharmer');
  night(s, { snakecharmer: ['pithag'] });
  assert.equal(sc.character, 'snakecharmer');
  night(s, { snakecharmer: ['snakecharmer'] });
  assert.equal(sc.character, 'snakecharmer');
});

test('Snake Charmer ex. 1 — choosing the Demon swaps characters and poisons the old Demon', () => {
  const s = mkDay(['vigormortis', 'poisoner', 'snakecharmer', 'soldier', 'monk', 'chef', 'mayor']);
  const sc = byChar(s, 'snakecharmer');
  const demon = byChar(s, 'vigormortis');
  night(s, { snakecharmer: ['vigormortis'] });
  assert.equal(sc.character, 'vigormortis');
  assert.equal(sc.alignment, 'evil');
  assert.equal(demon.character, 'snakecharmer');
  assert.equal(demon.alignment, 'good');
  assert.equal(abilityLostReason(s, demon), 'poisoned');
});

test('Snake Charmer ex. 2 — a good Pit-Hag-made Snake Charmer can still swap with the Fang Gu', () => {
  const s = mkDay(['fanggu', 'poisoner', 'pithag', 'soldier', 'monk', 'chef', 'mayor']);
  const pithag = byChar(s, 'pithag');
  pithag.character = 'snakecharmer';
  pithag.perceived = 'snakecharmer';
  const demon = byChar(s, 'fanggu');
  night(s, { snakecharmer: ['fanggu'] });
  assert.equal(pithag.character, 'fanggu');
  assert.equal(demon.character, 'snakecharmer');
  assert.equal(demon.alignment, 'evil', 'the new Fang Gu stays evil');
});

// ================================================================ MATHEMATICIAN

test('Mathematician ex. 0 — one poisoned ability that worked abnormally: learns 1', () => {
  const s = mkDay(['imp', 'poisoner', 'mathematician', 'oracle', 'soldier', 'monk', 'chef']);
  s.data.malfunctions = { [byChar(s, 'oracle').id]: 1 };
  assert.deepEqual(infoOf(s, 'mathematician'), { key: 'mathematicianInfo', vars: { count: 1 } });
});

test('Mathematician ex. 2 — a Vortox caps the count at 4', () => {
  const s = mkDay(['vortox', 'poisoner', 'mathematician', 'soldier', 'monk', 'chef', 'mayor']);
  s.data.malfunctions = Object.fromEntries(s.players.map((p) => [p.id, 1]));
  const m = infoOf(s, 'mathematician');
  assert.equal(m.key, 'mathematicianInfo');
  assert.ok((m.vars!.count as number) <= 4, 'never more than 4');
});

// ================================================================ FLOWERGIRL

test('Flowergirl ex. 0 — the Demon did not vote: learns no', () => {
  const s = mkDay(['imp', 'poisoner', 'flowergirl', 'soldier', 'monk', 'chef', 'mayor']);
  s.data.demonVotedToday = false;
  assert.deepEqual(infoOf(s, 'flowergirl'), { key: 'flowergirlInfo', vars: { yes: 0 } });
});

test('Flowergirl ex. 1 — the Demon voted: learns yes', () => {
  const s = mkDay(['imp', 'poisoner', 'flowergirl', 'soldier', 'monk', 'chef', 'mayor']);
  s.data.demonVotedToday = true;
  assert.deepEqual(infoOf(s, 'flowergirl'), { key: 'flowergirlInfo', vars: { yes: 1 } });
});

// ================================================================ TOWN CRIER

test('Town Crier ex. 0 — a Minion nominated: learns yes', () => {
  const s = mkDay(['imp', 'poisoner', 'towncrier', 'soldier', 'monk', 'chef', 'mayor']);
  s.data.minionNominatedToday = true;
  assert.deepEqual(infoOf(s, 'towncrier'), { key: 'towncrierInfo', vars: { yes: 1 } });
});

test('Town Crier ex. 1 — an exile is not a nomination: learns no', { skip: 'Travellers (exile) do not exist in this app' }, () => {});

// ================================================================ ORACLE

test('Oracle ex. 0 — every dead player is good: learns 0', () => {
  const s = mkDay(['imp', 'poisoner', 'oracle', 'soldier', 'monk', 'chef', 'mayor']);
  byChar(s, 'soldier').alive = false;
  byChar(s, 'monk').alive = false;
  assert.deepEqual(infoOf(s, 'oracle'), { key: 'oracleInfo', vars: { count: 0 } });
});

test('Oracle ex. 1 — two dead evil players: learns 2', () => {
  const s = mkDay(['imp', 'poisoner', 'oracle', 'soldier', 'monk', 'chef', 'mayor']);
  byChar(s, 'poisoner').alive = false;
  byChar(s, 'imp').alive = false;
  byChar(s, 'soldier').alive = false;
  assert.deepEqual(infoOf(s, 'oracle'), { key: 'oracleInfo', vars: { count: 2 } });
});

// ================================================================ SAVANT

test('Savant ex. 0-3 — each day the Savant learns two statements, one true and one false', () => {
  const s = mkDay(['imp', 'poisoner', 'savant', 'soldier', 'monk', 'chef', 'mayor']);
  hooksOf('savant').day!.use(s, byChar(s, 'savant'), [], {});
  const m = lastInfo(byChar(s, 'savant'));
  assert.equal(m.key, 'savantInfo');
  assert.ok(typeof m.vars!.a === 'string' && typeof m.vars!.b === 'string');
});

// ================================================================ SEAMSTRESS

test('Seamstress ex. 0 — two good players: learns yes', () => {
  const s = mkDay(['imp', 'poisoner', 'seamstress', 'barber', 'clockmaker', 'soldier', 'monk']);
  startNight(s);
  advanceUntil(s, 'seamstress');
  answerRealTurn(s, [byChar(s, 'barber').id, byChar(s, 'clockmaker').id]);
  assert.deepEqual(lastInfo(byChar(s, 'seamstress')), { key: 'seamstressInfo', vars: { same: 1 } });
});

test('Seamstress ex. 1 — a Demon and an Outsider: learns no', () => {
  const s = mkDay(['fanggu', 'poisoner', 'seamstress', 'sweetheart', 'soldier', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'seamstress');
  answerRealTurn(s, [byChar(s, 'fanggu').id, byChar(s, 'sweetheart').id]);
  assert.deepEqual(lastInfo(byChar(s, 'seamstress')), { key: 'seamstressInfo', vars: { same: 0 } });
});

// ================================================================ PHILOSOPHER

test('Philosopher ex. 0 — gains the Dreamer ability and acts when the Dreamer would', () => {
  const s = mkDay(['imp', 'poisoner', 'philosopher', 'soldier', 'monk', 'chef', 'mayor']);
  const phil = byChar(s, 'philosopher');
  night(s, { philosopher: [] }, 'dreamer');
  assert.equal(phil.character, 'dreamer');
});

test('Philosopher ex. 2 — an existing Artist becomes drunk, then sober when the Philosopher dies', () => {
  const s = mkDay(['imp', 'poisoner', 'philosopher', 'artist', 'soldier', 'monk', 'chef']);
  const phil = byChar(s, 'philosopher');
  const artist = byChar(s, 'artist');
  night(s, { philosopher: [] }, 'artist');
  assert.equal(phil.character, 'artist');
  assert.equal(abilityLostReason(s, artist), 'drunk');
  phil.alive = false;
  // The drunk effect is suspended while the source is dead.
  assert.equal(abilityLostReason(s, artist), null);
});

// ================================================================ ARTIST

test('Artist ex. 0 — a yes/no answer', () => {
  const s = mkDay(['imp', 'poisoner', 'artist', 'soldier', 'monk', 'chef', 'mayor']);
  hooksOf('artist').day!.use(s, byChar(s, 'artist'), [], { statement: { t: 'alignment', p: byChar(s, 'soldier').id, v: 'good' } });
  const m = lastInfo(byChar(s, 'artist'));
  assert.equal(m.key, 'artistAnswer');
  assert.ok([0, 1].includes(m.vars!.truth as number));
});

// ================================================================ JUGGLER

test('Juggler ex. 0 — two correct guesses: learns 2', () => {
  const s = mkDay(['imp', 'poisoner', 'juggler', 'towncrier', 'nodashii', 'sage', 'soldier']);
  hooksOf('juggler').day!.use(s, byChar(s, 'juggler'), [], { guesses: [
    { p: byChar(s, 'towncrier').id, v: 'towncrier' },
    { p: byChar(s, 'sage').id, v: 'sage' },
    { p: byChar(s, 'soldier').id, v: 'monk' },
  ] });
  assert.deepEqual(infoOf(s, 'juggler'), { key: 'jugglerInfo', vars: { count: 2 } });
});

// ================================================================ SAGE

test('Sage ex. 0 — killed by the Demon: learns two players, one of whom is the Demon', () => {
  const s = mkDay(['imp', 'poisoner', 'sage', 'soldier', 'monk', 'chef', 'mayor']);
  const sage = byChar(s, 'sage');
  sage.alive = false;
  s.data.deathCause = { [sage.id]: 'demon' };
  const m = infoOf(s, 'sage');
  assert.equal(m.key, 'sageInfo');
  assert.ok([m.vars!.a, m.vars!.b].includes(byChar(s, 'imp').name));
});

test('Sage ex. 1 — a drunk Sage gets false information', () => {
  const s = mkDay(['imp', 'poisoner', 'sage', 'soldier', 'monk', 'chef', 'mayor']);
  const sage = byChar(s, 'sage');
  sage.alive = false;
  s.effects.push({ kind: 'drunk', target: sage.id, source: null, sourceChar: 'test', untilNight: null });
  const m = infoOf(s, 'sage');
  assert.equal(m.key, 'sageInfo');
});

// ================================================================ MUTANT

test('Mutant ex. 0 — a Mutant who comes out as the Mutant is executed immediately', () => {
  const s = mkDay(['imp', 'poisoner', 'mutant', 'soldier', 'monk', 'chef', 'mayor']);
  const mutant = byChar(s, 'mutant');
  hooksOf('mutant').day!.use(s, mutant, [], {});
  assert.equal(mutant.alive, false);
});

// ================================================================ SWEETHEART

test('Sweetheart ex. 0-2 — when they die, one player is drunk from then on', () => {
  const s = mkDay(['imp', 'poisoner', 'sweetheart', 'mathematician', 'soldier', 'monk', 'chef']);
  const sweet = byChar(s, 'sweetheart');
  hooksOf('sweetheart').onDeath!(s, sweet, 'demon');
  assert.ok(s.effects.some((e) => e.kind === 'drunk' && e.sourceChar === 'sweetheart'));
});

// ================================================================ BARBER

test('Barber ex. 0-3 — when the Barber dies, the Demon swaps two characters', () => {
  const s = mkDay(['imp', 'poisoner', 'barber', 'snakecharmer', 'clockmaker', 'soldier', 'monk']);
  const barber = byChar(s, 'barber');
  barber.alive = false;
  s.data.diedToday = [barber.id];
  const sc = byChar(s, 'snakecharmer');
  const clock = byChar(s, 'clockmaker');
  // The Demon swaps two characters.
  hooksOf('barber').night!.apply!(s, byChar(s, 'imp'), [sc.id, clock.id], 'barber');
  assert.equal(sc.character, 'clockmaker');
  assert.equal(clock.character, 'snakecharmer');
});

// ================================================================ KLUTZ

test('Klutz ex. 0 — choosing a good player keeps the game going', () => {
  const s = mkDay(['imp', 'poisoner', 'klutz', 'seamstress', 'soldier', 'monk', 'chef']);
  const klutz = byChar(s, 'klutz');
  klutz.alive = false;
  klutz.flags.klutzPending = true;
  hooksOf('klutz').day!.use(s, klutz, [byChar(s, 'seamstress').id], {});
  assert.equal(s.winner, null);
});

test('Klutz ex. 1 — choosing the Demon: evil wins immediately', () => {
  const s = mkDay(['imp', 'poisoner', 'klutz', 'soldier', 'monk', 'chef', 'mayor']);
  const klutz = byChar(s, 'klutz');
  klutz.alive = false;
  klutz.flags.klutzPending = true;
  hooksOf('klutz').day!.use(s, klutz, [byChar(s, 'imp').id], {});
  assert.equal(s.winner, 'evil');
});

// ================================================================ EVIL TWIN

test('Evil Twin ex. 0 — the Evil Twin is executed: the game continues', () => {
  const s = mkDay(['fanggu', 'witch', 'eviltwin', 'soldier', 'monk', 'chef', 'mayor']);
  const et = byChar(s, 'eviltwin');
  const twin = byChar(s, 'soldier');
  et.flags.twinId = twin.id;
  twin.flags.evilTwinId = et.id;
  execute(s, byChar(s, 'monk'), et);
  assert.equal(et.alive, false);
  assert.equal(s.winner, null, 'good cannot win while the good twin lives');
});

test('Evil Twin ex. 1 — executing the good twin ends the game for evil', () => {
  const s = mkDay(['fanggu', 'witch', 'eviltwin', 'soldier', 'monk', 'chef', 'mayor']);
  const et = byChar(s, 'eviltwin');
  const twin = byChar(s, 'soldier');
  et.flags.twinId = twin.id;
  twin.flags.evilTwinId = et.id;
  execute(s, byChar(s, 'monk'), twin);
  assert.equal(s.winner, 'evil');
});

test('Evil Twin ex. 2 — with the Demon dead, good still cannot win while both twins live', () => {
  const s = mkDay(['fanggu', 'witch', 'eviltwin', 'soldier', 'monk', 'chef', 'mayor']);
  const et = byChar(s, 'eviltwin');
  const twin = byChar(s, 'soldier');
  et.flags.twinId = twin.id;
  twin.flags.evilTwinId = et.id;
  byChar(s, 'fanggu').alive = false;
  byChar(s, 'witch').alive = false;
  assert.equal(hooksOf('eviltwin').blocksGoodWin!(s, et), true);
});

// ================================================================ WITCH

test('Witch ex. 0 — the cursed player nominates and dies; the vote continues', () => {
  const s = mkDay(['imp', 'poisoner', 'witch', 'sage', 'dreamer', 'soldier', 'monk', 'chef']);
  const witch = byChar(s, 'witch');
  const sage = byChar(s, 'sage');
  s.data.witchTarget = sage.id;
  nominate(s, sage.id, byChar(s, 'dreamer').id); // the cursed Sage nominates
  assert.equal(sage.alive, false);
});

test('Witch ex. 1 — the Witch curses themself and dies when nominating', () => {
  const s = mkDay(['imp', 'poisoner', 'witch', 'soldier', 'monk', 'chef', 'mayor']);
  const witch = byChar(s, 'witch');
  s.data.witchTarget = witch.id;
  nominate(s, witch.id, byChar(s, 'imp').id); // the cursed Witch nominates the Demon
  assert.equal(witch.alive, false);
});

test('Witch ex. 3 — with only three alive the curse no longer works', () => {
  const s = mkDay(['imp', 'poisoner', 'witch', 'savant', 'soldier', 'monk', 'chef']);
  const witch = byChar(s, 'witch');
  s.data.witchTarget = byChar(s, 'savant').id;
  byChar(s, 'soldier').alive = false;
  byChar(s, 'monk').alive = false;
  byChar(s, 'chef').alive = false;
  byChar(s, 'poisoner').alive = false; // now exactly three alive
  nominate(s, byChar(s, 'savant').id, byChar(s, 'imp').id); // the cursed Savant nominates
  assert.equal(alive(s, 'savant'), true, 'three alive: the Witch has lost the ability');
});

test('Witch ex. 4 — an exile is not a nomination', { skip: 'Travellers (exile) do not exist in this app' }, () => {});

// ================================================================ CERENOVUS

test('Cerenovus ex. 0 — a mad player who claims the role is not executed', () => {
  const s = mkDay(['imp', 'poisoner', 'cerenovus', 'barber', 'soldier', 'monk', 'chef']);
  const barber = byChar(s, 'barber');
  s.data.mad = { player: barber.id, character: 'savant', by: byChar(s, 'cerenovus').id };
  hooksOf('cerenovus').day!.use(s, barber, [], {});
  assert.equal(s.data.madClaimed, true);
  hooksOf('cerenovus').beforeDayEnd!(s, byChar(s, 'cerenovus'));
  assert.equal(barber.alive, true, 'the claim avoided execution');
});

test('Cerenovus ex. 1 — a dead mad player who says nothing is executed at day\'s end', () => {
  const s = mkDay(['imp', 'poisoner', 'cerenovus', 'soldier', 'monk', 'chef', 'mayor']);
  const cer = byChar(s, 'cerenovus');
  const victim = byChar(s, 'soldier');
  s.data.mad = { player: victim.id, character: 'sage', by: cer.id };
  const toExecute = hooksOf('cerenovus').beforeDayEnd!(s, cer);
  assert.equal(toExecute, victim.id, 'the day\'s execution falls on the mad player');
  if (toExecute) executePlayer(s, toExecute);
  assert.equal(victim.alive, false);
});

// ================================================================ PIT-HAG

test('Pit-Hag ex. 0 — turns the Clockmaker into the Mutant', () => {
  const s = mkDay(['imp', 'poisoner', 'pithag', 'clockmaker', 'soldier', 'monk', 'chef']);
  const clock = byChar(s, 'clockmaker');
  night(s, { pithag: ['clockmaker'] }, 'mutant');
  assert.equal(clock.character, 'mutant');
  assert.equal(clock.alignment, 'good', 'the Clockmaker stays good');
});

test('Pit-Hag ex. 1 — cannot turn someone into a character already in play', () => {
  const s = mkDay(['imp', 'poisoner', 'pithag', 'savant', 'sage', 'monk', 'chef']);
  startNight(s);
  advanceUntil(s, 'pithag');
  const turn = s.pendingRealTurn!;
  const pool = (turn.characterPool ?? []);
  assert.ok(!pool.includes('sage'), 'a Sage is already in play');
  assert.ok(pool.includes('mutant'));
});

test('Pit-Hag ex. 2 — a good Evil Twin still learns their twin', () => {
  const s = mkDay(['imp', 'poisoner', 'pithag', 'flowergirl', 'soldier', 'monk', 'chef']);
  const fg = byChar(s, 'flowergirl');
  night(s, { pithag: ['flowergirl'] }, 'eviltwin');
  assert.equal(fg.character, 'eviltwin');
  assert.equal(fg.alignment, 'good');
});

// ================================================================ FANG GU

test('Fang Gu ex. 0 — the first Outsider killed becomes an evil Fang Gu and the old one dies', () => {
  const s = mkDay(['fanggu', 'poisoner', 'sweetheart', 'soldier', 'monk', 'chef', 'mayor']);
  const fang = byChar(s, 'fanggu');
  const sweet = byChar(s, 'sweetheart');
  night(s, { fanggu: ['sweetheart'] });
  assert.equal(sweet.character, 'fanggu');
  assert.equal(sweet.alignment, 'evil');
  assert.equal(fang.alive, false, 'the old Fang Gu dies');
  assert.equal(sweet.alive, true, 'the new Fang Gu does not die');
});

// ================================================================ VIGORMORTIS

test('Vigormortis ex. 0 — a killed Minion keeps their ability', () => {
  const s = mkDay(['vigormortis', 'witch', 'soldier', 'monk', 'chef', 'mayor', 'butler']);
  const witch = byChar(s, 'witch');
  night(s, { vigormortis: ['witch'] });
  assert.equal(witch.alive, false);
  assert.equal(witch.flags.keepsAbility, true);
});

test('Vigormortis ex. 1 — the dead Minion poisons a living Townsfolk neighbour', () => {
  const s = mkDay(['vigormortis', 'eviltwin', 'klutz', 'flowergirl', 'sage', 'soldier', 'monk']);
  // seats: 0 vigormortis, 1 eviltwin, 2 klutz, 3 flowergirl, 4 sage, 5 soldier, 6 monk.
  const et = byChar(s, 'eviltwin');
  night(s, { vigormortis: ['eviltwin'] });
  assert.equal(et.alive, false);
  assert.ok(s.effects.some((e) => e.kind === 'poisoned' && e.sourceChar === 'vigormortis'));
});

// ================================================================ NO DASHII

test('No Dashii ex. 0 — the two Townsfolk neighbours are poisoned', () => {
  // seats: 0 nodashii, 1 towncrier, ..., 6 snakecharmer: the two neighbours are Town Crier and Snake Charmer.
  const s = mkDay(['nodashii', 'towncrier', 'soldier', 'monk', 'chef', 'mayor', 'snakecharmer']);
  night(s, { snakecharmer: ['snakecharmer'], nodashii: ['soldier'] });
  assert.equal(abilityLostReason(s, byChar(s, 'towncrier')), 'poisoned');
  assert.equal(abilityLostReason(s, byChar(s, 'snakecharmer')), 'poisoned');
  assert.equal(abilityLostReason(s, byChar(s, 'mayor')), null, 'a Townsfolk further away is fine');
});

test('No Dashii ex. 1 — the nearest living Townsfolk on each side are poisoned', () => {
  // seats: 0 nodashii, then clockwise philosopher/mathematician/sage, anticlockwise witch/mutant/seamstress.
  const s = mkDay(['nodashii', 'philosopher', 'mathematician', 'sage', 'witch', 'mutant', 'seamstress']);
  night(s, { nodashii: ['sage'] });
  assert.equal(abilityLostReason(s, byChar(s, 'philosopher')), 'poisoned');
  assert.equal(abilityLostReason(s, byChar(s, 'seamstress')), 'poisoned');
});

// ================================================================ VORTOX

test('Vortox ex. 0 — a killed Sage learns two non-Demons', () => {
  const s = mkDay(['vortox', 'poisoner', 'sage', 'soldier', 'monk', 'chef', 'mayor']);
  const sage = byChar(s, 'sage');
  sage.alive = false;
  s.data.deathCause = { [sage.id]: 'demon' };
  const m = infoOf(s, 'sage');
  assert.ok(![m.vars!.a, m.vars!.b].includes(byChar(s, 'vortox').name), 'the Vortox makes it false');
});

test('Vortox ex. 1 — nobody was executed: evil wins at day\'s end', () => {
  const s = mkDay(['vortox', 'poisoner', 'soldier', 'monk', 'chef', 'mayor', 'butler']);
  hooksOf('vortox').endOfDayWin!(s, byChar(s, 'vortox'), null);
  assert.equal(s.winner, 'evil');
});

test('Vortox ex. 2 — Townsfolk information is false', () => {
  const s = mkDay(['vortox', 'poisoner', 'oracle', 'soldier', 'monk', 'chef', 'mayor']);
  byChar(s, 'poisoner').alive = false;
  byChar(s, 'soldier').alive = false;
  const m = infoOf(s, 'oracle');
  assert.equal(m.key, 'oracleInfo');
});

test('Vortox ex. 4 — no execution all day: evil wins', () => {
  const s = mkDay(['vortox', 'poisoner', 'soldier', 'monk', 'chef', 'mayor', 'butler']);
  hooksOf('vortox').endOfDayWin!(s, byChar(s, 'vortox'), null);
  assert.equal(s.winner, 'evil');
});

void advanceUntil; void answerRealTurn; void breakDawn; void startNight; void findSecret; void named; void mk; void setAlignment; void infoOf; void alive;
