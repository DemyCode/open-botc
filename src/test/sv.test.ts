// Sects & Violets, character by character — each rule played out in a real game state, plus the
// ways it can go wrong (drunk, poisoned, protected, dead).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import { dealCharacters } from '../game/setup.js';
import { nominate, useDayAbility } from '../game/engine.js';
import { infoIsFalse } from '../game/info.js';
import { abilityLostReason } from '../game/registration.js';
import { SCRIPTS } from '../game/scripts.js';
import { evaluateWin } from '../game/win.js';
import type { CharacterId, GameState } from '../game/types.js';
import { advanceUntil, answerRealTurn, breakDawn, byChar, endDayByConsensus, fastForwardToVote, mk, mkDay, runFullNight, skipRound, startNight, voteInOrder } from './helpers.js';

type Pick = { targets?: CharacterId[]; character?: string };
/** Plays one night with explicit answers per step (by the character's id; targets by true character). */
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
function afterNight1(chars: CharacterId[]): GameState {
  const s = mk(chars);
  startNight(s);
  runFullNight(s);
  assert.equal(s.phase, 'day');
  return s;
}
const alive = (s: GameState, c: CharacterId) => byChar(s, c).alive;
const woke = (s: GameState, step: string) => !!s.pendingRealTurn && s.pendingRealTurn.charId === step;
function executeByVote(s: GameState, victim: CharacterId): void {
  const nominator = s.players.find((p) => p.alive && p.id !== byChar(s, victim).id)!;
  nominate(s, nominator.id, byChar(s, victim).id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.filter((p) => p.alive || !p.ghostVoteUsed).map((p) => p.id));
  endDayByConsensus(s);
}
function useDay(s: GameState, playerId: string, character: string, targets: string[], payload: Record<string, unknown> = {}): void {
  useDayAbility(s, playerId, character, targets, payload);
}

// ---------------------------------------------------------------- the edition itself

test('Sects & Violets has its 25 characters: 13 Townsfolk, 4 Outsiders, 4 Minions, 4 Demons', () => {
  const chars = SCRIPTS.sv.characters.map((id) => CHARACTERS[id]);
  assert.equal(chars.length, 25);
  const by = (t: string) => chars.filter((c) => c.team === t).length;
  assert.deepEqual([by('townsfolk'), by('outsider'), by('minion'), by('demon')], [13, 4, 4, 4]);
  for (const c of chars) assert.equal(c.edition, 'sv');
});

// ---------------------------------------------------------------- Townsfolk

test('Clockmaker: learns the number of steps from the Demon to its nearest Minion', () => {
  const s = mk(['fanggu', 'witch', 'clockmaker', 'dreamer', 'savant', 'artist', 'juggler']);
  startNight(s);
  advanceUntil(s, 'clockmaker');
  assert.deepEqual(s.pendingRealTurn!.bodyByPlayer[byChar(s, 'clockmaker').id], { key: 'clockmakerInfo', vars: { count: 1 } });
});

test('Dreamer: learns 1 good and 1 evil character, one of which is the chosen player\'s true character', () => {
  const s = afterNight1(['fanggu', 'witch', 'dreamer', 'clockmaker', 'savant', 'artist', 'juggler']);
  night(s, { dreamer: { targets: ['fanggu'] }, fanggu: { targets: ['savant'] } });
  const info = byChar(s, 'dreamer').log.at(-1)!.msg;
  assert.equal(info.key, 'dreamerInfo');
  const { a, b } = info.vars as { a: string; b: string };
  assert.ok([a, b].includes('fanggu'), 'the evil character shown is the target');
  const other = a === 'fanggu' ? b : a;
  assert.ok(CHARACTERS[other].team === 'townsfolk' || CHARACTERS[other].team === 'outsider', 'the other is a good character');
});

test('Snake Charmer: a chosen Demon swaps characters and alignments, then is poisoned', () => {
  const s = mk(['fanggu', 'witch', 'snakecharmer', 'dreamer', 'savant', 'artist', 'juggler']);
  startNight(s);
  const sc = byChar(s, 'snakecharmer');
  const demon = byChar(s, 'fanggu');
  advanceUntil(s, 'snakecharmer');
  answerRealTurn(s, [demon.id]);
  assert.equal(sc.character, 'fanggu', 'the Snake Charmer is now the Demon');
  assert.equal(sc.alignment, 'evil');
  assert.equal(demon.character, 'snakecharmer', 'the Demon is now the Snake Charmer');
  assert.equal(demon.alignment, 'good');
  assert.equal(abilityLostReason(s, demon), 'poisoned');
});

test('Snake Charmer: choosing anyone but the Demon changes nothing', () => {
  const s = mk(['fanggu', 'witch', 'snakecharmer', 'dreamer', 'savant', 'artist', 'juggler']);
  startNight(s);
  const sc = byChar(s, 'snakecharmer');
  advanceUntil(s, 'snakecharmer');
  answerRealTurn(s, [byChar(s, 'witch').id]);
  assert.equal(sc.character, 'snakecharmer');
});

test('Mathematician: counts players whose abilities worked abnormally since dawn', () => {
  const s = afterNight1(['fanggu', 'witch', 'mathematician', 'empath', 'savant', 'artist', 'juggler']);
  s.effects.push({ kind: 'drunk', target: byChar(s, 'empath').id, source: null, sourceChar: 'test', untilNight: null });
  night(s, { fanggu: { targets: ['juggler'] } });
  assert.deepEqual(byChar(s, 'mathematician').log.at(-1)!.msg, { key: 'mathematicianInfo', vars: { count: 1 } });
});

test('Flowergirl: learns if a Demon voted today', () => {
  const s = afterNight1(['fanggu', 'witch', 'flowergirl', 'empath', 'savant', 'artist', 'juggler']);
  nominate(s, byChar(s, 'witch').id, byChar(s, 'empath').id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id)); // everyone votes yes, including the Demon
  assert.equal(s.data.demonVotedToday, true, 'the Demon voted yes');
  endDayByConsensus(s);
  startNight(s);
  advanceUntil(s, 'flowergirl');
  assert.deepEqual(byChar(s, 'flowergirl').log.at(-1)!.msg, { key: 'flowergirlInfo', vars: { yes: 1 } });
});

test('Town Crier: learns if a Minion nominated today', () => {
  const s = afterNight1(['fanggu', 'witch', 'towncrier', 'empath', 'savant', 'artist', 'juggler']);
  nominate(s, byChar(s, 'witch').id, byChar(s, 'empath').id);
  assert.equal(s.data.minionNominatedToday, true);
  fastForwardToVote(s);
  voteInOrder(s, []); // nobody votes yes: no execution, the day simply ends
  endDayByConsensus(s);
  startNight(s);
  advanceUntil(s, 'towncrier');
  assert.deepEqual(byChar(s, 'towncrier').log.at(-1)!.msg, { key: 'towncrierInfo', vars: { yes: 1 } });
});

test('Oracle: learns how many dead players are evil', () => {
  const s = afterNight1(['fanggu', 'witch', 'oracle', 'empath', 'savant', 'artist', 'juggler']);
  byChar(s, 'savant').alive = false;
  byChar(s, 'savant').alignment = 'evil';
  byChar(s, 'artist').alive = false;
  night(s, { fanggu: { targets: ['juggler'] } });
  assert.deepEqual(byChar(s, 'oracle').log.at(-1)!.msg, { key: 'oracleInfo', vars: { count: 1 } });
});

test('Savant: learns two private statements, one true and one false', () => {
  const s = mkDay(['fanggu', 'witch', 'savant', 'empath', 'artist', 'juggler', 'chef']);
  const savant = byChar(s, 'savant');
  useDay(s, savant.id, 'savant', []);
  const info = savant.log.at(-1)!.msg;
  assert.equal(info.key, 'savantInfo');
  assert.ok((info.vars as { a: string }).a && (info.vars as { b: string }).b);
  assert.notEqual((info.vars as { a: string }).a, (info.vars as { b: string }).b);
});

test('Seamstress: once per game, learns whether two players share an alignment', () => {
  const s = afterNight1(['fanggu', 'witch', 'seamstress', 'empath', 'savant', 'artist', 'juggler']);
  const seamstress = byChar(s, 'seamstress');
  night(s, { seamstress: { targets: ['empath', 'savant'] }, fanggu: { targets: ['juggler'] } });
  assert.deepEqual(seamstress.log.at(-1)!.msg, { key: 'seamstressInfo', vars: { same: 1 } });
  startNight(s);
  let woke2 = false;
  while (s.pendingRealTurn) { if (woke(s, 'seamstress')) woke2 = true; skipRound(s); }
  assert.equal(woke2, false, 'used up');
});

test('Philosopher: gains a good character\'s ability; if that character is in play they are drunk', () => {
  const s = mk(['fanggu', 'witch', 'philosopher', 'empath', 'savant', 'artist', 'juggler']);
  const philosopher = byChar(s, 'philosopher');
  const empath = byChar(s, 'empath');
  startNight(s);
  advanceUntil(s, 'philosopher');
  answerRealTurn(s, [], 'empath');
  assert.equal(philosopher.character, 'empath', 'the Philosopher has the Empath ability');
  assert.equal(abilityLostReason(s, empath), 'drunk', 'the real Empath is drunk');
});

test('Artist: once per game, asks a private yes/no question', () => {
  const s = mkDay(['fanggu', 'witch', 'artist', 'empath', 'savant', 'juggler', 'chef']);
  const artist = byChar(s, 'artist');
  useDay(s, artist.id, 'artist', [], { statement: { t: 'alive', p: byChar(s, 'empath').id, v: true } });
  const info = artist.log.at(-1)!.msg;
  assert.equal(info.key, 'artistAnswer');
  assert.equal((info.vars as { truth: number }).truth, 1);
});

test('Juggler: guesses on day 1, learns how many were right that night', () => {
  const s = mkDay(['fanggu', 'witch', 'juggler', 'empath', 'savant', 'artist', 'chef']);
  const juggler = byChar(s, 'juggler');
  useDay(s, juggler.id, 'juggler', [], { guesses: [{ p: byChar(s, 'empath').id, v: 'empath' }, { p: byChar(s, 'witch').id, v: 'soldier' }] });
  startNight(s);
  advanceUntil(s, 'juggler');
  assert.deepEqual(juggler.log.at(-1)!.msg, { key: 'jugglerInfo', vars: { count: 1 } });
});

test('Sage: killed by the Demon, learns that it is 1 of 2 players', () => {
  const s = afterNight1(['fanggu', 'witch', 'sage', 'empath', 'savant', 'artist', 'juggler']);
  night(s, { fanggu: { targets: ['sage'] } });
  assert.equal(alive(s, 'sage'), false);
  const info = byChar(s, 'sage').log.at(-1)!.msg;
  assert.equal(info.key, 'sageInfo');
  const demon = byChar(s, 'fanggu');
  const { a, b } = info.vars as { a: string; b: string };
  assert.ok([a, b].includes(demon.name), 'one of the two is the Demon');
});

// ---------------------------------------------------------------- Outsiders

test('Mutant: a public claim to be the Mutant gets the real Mutant executed', () => {
  const s = mkDay(['fanggu', 'witch', 'mutant', 'empath', 'savant', 'artist', 'juggler']);
  const mutant = byChar(s, 'mutant');
  useDay(s, mutant.id, 'mutant', []);
  assert.equal(mutant.alive, false);
  assert.equal(s.lastExecutedId, mutant.id);
});

test('Mutant: anyone else claiming is just a bluff', () => {
  const s = mkDay(['fanggu', 'witch', 'mutant', 'empath', 'savant', 'artist', 'juggler']);
  const empath = byChar(s, 'empath');
  useDay(s, empath.id, 'mutant', []);
  assert.equal(empath.alive, true);
  assert.equal(alive(s, 'mutant'), true);
});

test('Sweetheart: when they die, one player is drunk from then on', () => {
  const s = afterNight1(['vigormortis', 'witch', 'sweetheart', 'empath', 'savant', 'artist', 'juggler']);
  night(s, { vigormortis: { targets: ['sweetheart'] } });
  assert.equal(alive(s, 'sweetheart'), false);
  const drunk = s.effects.filter((e) => e.kind === 'drunk' && e.sourceChar === 'sweetheart');
  assert.equal(drunk.length, 1);
  assert.equal(drunk[0].untilNight, null, 'from now on');
});

test('Barber: if they died today, the Demon may swap two players\' characters that night', () => {
  const s = afterNight1(['fanggu', 'witch', 'barber', 'empath', 'savant', 'artist', 'juggler']);
  s.data.witchTarget = null; // (the Witch may otherwise curse whoever nominates)
  executeByVote(s, 'barber');
  const empath = byChar(s, 'empath');
  const artist = byChar(s, 'artist');
  night(s, { barber: { targets: ['empath', 'artist'] }, fanggu: { targets: ['savant'] } });
  assert.equal(empath.character, 'artist');
  assert.equal(artist.character, 'empath');
});

test('Klutz: choosing an evil player when they die loses the game; a good one does not', () => {
  const s = afterNight1(['vigormortis', 'witch', 'klutz', 'empath', 'savant', 'artist', 'juggler']);
  night(s, { vigormortis: { targets: ['klutz'] } });
  useDay(s, byChar(s, 'klutz').id, 'klutz', [byChar(s, 'witch').id]);
  assert.equal(s.winner, 'evil');
  const t = afterNight1(['vigormortis', 'witch', 'klutz', 'empath', 'savant', 'artist', 'juggler']);
  night(t, { vigormortis: { targets: ['klutz'] } });
  useDay(t, byChar(t, 'klutz').id, 'klutz', [byChar(t, 'empath').id]);
  assert.equal(t.winner, null);
});

// ---------------------------------------------------------------- Minions

test('Evil Twin: setup pairs them with a good player', () => {
  const deal = dealCharacters(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'twin-secret', ['eviltwin', 'fanggu', 'soldier', 'empath', 'chef', 'mayor', 'librarian', 'saint', 'butler']);
  const twinId = Object.keys(deal.characters).find((id) => deal.characters[id] === 'eviltwin')!;
  const partner = deal.twins[twinId];
  assert.ok(partner, 'the Evil Twin has a partner');
  const team = CHARACTERS[deal.characters[partner]].team;
  assert.ok(team === 'townsfolk' || team === 'outsider', 'the partner is good');
});

test('Evil Twin: if the good twin is executed, evil wins; good cannot win while both live', () => {
  const s = mkDay(['fanggu', 'witch', 'eviltwin', 'soldier', 'empath', 'chef', 'mayor']);
  const twin = byChar(s, 'eviltwin');
  const good = byChar(s, 'soldier');
  twin.flags.twinId = good.id;
  good.flags.evilTwinId = twin.id;
  byChar(s, 'fanggu').alive = false; // no Demon left
  evaluateWin(s);
  assert.equal(s.winner, null, 'good cannot win while both twins live');
  executeByVote(s, 'soldier');
  assert.equal(s.winner, 'evil');
});

test('Witch: a cursed player who nominates the next day dies', () => {
  const s = afterNight1(['fanggu', 'witch', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  const empath = byChar(s, 'empath');
  night(s, { witch: { targets: ['empath'] }, fanggu: { targets: ['savant'] } });
  nominate(s, empath.id, byChar(s, 'chef').id);
  assert.equal(empath.alive, false);
  assert.ok(s.history.some((e) => e.type === 'witchCurse'));
});

test('Witch: with only three players alive the ability stops working', () => {
  const s = afterNight1(['fanggu', 'witch', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  for (const c of ['savant', 'artist', 'juggler', 'chef']) byChar(s, c as CharacterId).alive = false;
  startNight(s);
  advanceUntil(s, 'witch');
  answerRealTurn(s, [byChar(s, 'empath').id]);
  assert.equal(s.data.witchTarget, null);
});

test('Cerenovus: the mad player is told; claiming saves them, staying silent gets them executed', () => {
  const s = afterNight1(['fanggu', 'cerenovus', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  const empath = byChar(s, 'empath');
  night(s, { cerenovus: { targets: ['empath'], character: 'chef' }, fanggu: { targets: ['savant'] } });
  assert.equal((s.data.mad as { player: string }).player, empath.id);
  assert.ok(empath.log.some((e) => e.msg.key === 'cerenovusMad'));
  endDayByConsensus(s);
  assert.equal(empath.alive, false, 'silence is punished');
  assert.ok(s.history.some((e) => e.type === 'madnessExecuted'));

  const t = afterNight1(['fanggu', 'cerenovus', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  const e2 = byChar(t, 'empath');
  night(t, { cerenovus: { targets: ['empath'], character: 'chef' }, fanggu: { targets: ['savant'] } });
  useDay(t, e2.id, 'cerenovus', []);
  assert.equal(t.data.madClaimed, true);
  endDayByConsensus(t);
  assert.equal(e2.alive, true, 'claiming keeps them alive');
});

test('Pit-Hag: turns a player into a character not in play', () => {
  const s = afterNight1(['fanggu', 'pithag', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  const empath = byChar(s, 'empath');
  night(s, { pithag: { targets: ['empath'], character: 'mayor' }, fanggu: { targets: ['savant'] } });
  assert.equal(empath.character, 'mayor');
});

test('Pit-Hag: may only name a character that is not already in play', () => {
  const s = afterNight1(['fanggu', 'pithag', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  startNight(s);
  advanceUntil(s, 'pithag');
  assert.throws(() => answerRealTurn(s, [byChar(s, 'empath').id], 'chef'), /valid character/i);
});

// ---------------------------------------------------------------- Demons

test('Fang Gu: the first Outsider it kills becomes an evil Fang Gu and the original dies', () => {
  const s = afterNight1(['fanggu', 'witch', 'recluse', 'empath', 'savant', 'artist', 'juggler']);
  const fanggu = byChar(s, 'fanggu');
  const recluse = byChar(s, 'recluse');
  night(s, { fanggu: { targets: ['recluse'] } });
  assert.equal(recluse.character, 'fanggu');
  assert.equal(recluse.alignment, 'evil');
  assert.equal(fanggu.alive, false, 'the original Fang Gu dies');
});

test('Fang Gu: killing a Townsfolk is an ordinary kill; the jump only happens on an Outsider', () => {
  const s = afterNight1(['fanggu', 'witch', 'recluse', 'empath', 'savant', 'artist', 'juggler']);
  night(s, { fanggu: { targets: ['empath'] } });
  assert.equal(alive(s, 'empath'), false);
  assert.equal(byChar(s, 'fanggu').alive, true);
  assert.equal(byChar(s, 'recluse').character, 'recluse');
});

test('Vigormortis: a killed Minion keeps their ability and poisons a Townsfolk neighbour', () => {
  const s = afterNight1(['vigormortis', 'poisoner', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  night(s, { vigormortis: { targets: ['poisoner'] } });
  const poisoner = byChar(s, 'poisoner');
  assert.equal(poisoner.alive, false);
  assert.equal(poisoner.flags.keepsAbility, true);
  assert.ok(s.effects.some((e) => e.kind === 'poisoned' && e.sourceChar === 'vigormortis'));
});

test('No Dashii: its two Townsfolk neighbours are poisoned', () => {
  const s = afterNight1(['nodashii', 'witch', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  night(s, { nodashii: { targets: ['savant'] } });
  assert.equal(abilityLostReason(s, byChar(s, 'empath')), 'poisoned');
  assert.equal(abilityLostReason(s, byChar(s, 'chef')), 'poisoned');
  assert.equal(abilityLostReason(s, byChar(s, 'witch')), null, 'a Minion neighbour is not poisoned');
});

test('Vortox: Townsfolk information is false, and no execution in a day means evil wins', () => {
  const s = mkDay(['vortox', 'witch', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  assert.equal(infoIsFalse(s, byChar(s, 'empath')), true, 'a Townsfolk is fed false info');
  assert.equal(infoIsFalse(s, byChar(s, 'witch')), false, 'a Minion is not');
  endDayByConsensus(s);
  assert.equal(s.winner, 'evil');
});


// ---------------------------------------------------------------- Fang Gu: the jump only happens if the Outsider really dies

const fangGuTable = () => afterNight1(['fanggu', 'witch', 'saint', 'monk', 'innkeeper', 'artist', 'juggler']);
/** The Monk and Innkeeper guard the Witch and the Artist by default — never the Saint unless a test says so. */
const calm = (extra: Record<string, Pick>): Record<string, Pick> => ({ monk: { targets: ['witch'] }, innkeeper: { targets: ['witch', 'artist'] }, ...extra });

test('Fang Gu: an unprotected Outsider is jumped into — they become the evil Fang Gu and the old one dies', () => {
  const s = fangGuTable();
  night(s, calm({ fanggu: { targets: ['saint'] } }));
  const [oldDemon, , saint] = s.players;
  assert.equal(saint.character, 'fanggu', 'the Saint is now the Fang Gu');
  assert.equal(saint.alignment, 'evil');
  assert.equal(saint.alive, true);
  assert.equal(oldDemon.alive, false, 'the old Fang Gu died instead');
});

test('Fang Gu: a Monk-protected Outsider is not killed, so there is no jump and the Fang Gu lives', () => {
  const s = fangGuTable();
  night(s, calm({ monk: { targets: ['saint'] }, fanggu: { targets: ['saint'] } }));
  const [demon, , saint] = s.players;
  assert.equal(saint.alive, true);
  assert.equal(saint.character, 'saint', 'still the Saint');
  assert.equal(demon.alive, true, 'the Fang Gu did not die');
  assert.ok(!demon.flags.fangguJumped, 'the jump is not used up');
});

test('Fang Gu: an Outsider made safe by the Innkeeper is not jumped into either', () => {
  const s = fangGuTable();
  night(s, calm({ innkeeper: { targets: ['saint', 'artist'] }, fanggu: { targets: ['saint'] } }));
  assert.equal(s.players[2].character, 'saint');
  assert.equal(s.players[0].alive, true);
});

test('Fang Gu: a blocked jump is not lost — the next night the Outsider is unprotected and the Fang Gu jumps', () => {
  const s = fangGuTable();
  night(s, calm({ monk: { targets: ['saint'] }, fanggu: { targets: ['saint'] } }));
  assert.equal(s.players[2].character, 'saint', 'blocked the first night');
  night(s, calm({ fanggu: { targets: ['saint'] } }));
  assert.equal(s.players[2].character, 'fanggu', 'the Saint became the Fang Gu on the second night');
  assert.equal(s.players[0].alive, false);
});

test('Fang Gu: choosing an already dead Outsider does not jump', () => {
  const s = fangGuTable();
  byChar(s, 'saint').alive = false;
  night(s, calm({ fanggu: { targets: ['saint'] } }));
  assert.equal(s.players[0].alive, true);
  assert.equal(s.players[2].character, 'saint');
});

// ---------------------------------------------------------------- No Dashii / Vigormortis: neighbours regardless of alive or dead (wiki)

// seats: 0 No Dashii, 1 Witch (a Minion: skipped), 2 Empath, 3 Savant, 4 Artist, 5 Juggler, 6 Chef.
const noDashiiTable = () => mk(['nodashii', 'witch', 'empath', 'savant', 'artist', 'juggler', 'chef']);
const poisoned = (s: GameState, c: CharacterId) => abilityLostReason(s, byChar(s, c)) === 'poisoned';

test('No Dashii: its two nearest Townsfolk are poisoned from the moment the game is set up — before any night step', () => {
  const s = noDashiiTable();
  assert.equal(poisoned(s, 'empath'), true, 'clockwise, skipping the Minion');
  assert.equal(poisoned(s, 'chef'), true, 'anticlockwise');
  for (const c of ['savant', 'artist', 'juggler', 'witch'] as const) assert.equal(poisoned(s, c), false, c);
});

test('No Dashii: a DEAD nearest Townsfolk is still the poisoned one — the next living Townsfolk is not poisoned in their place', () => {
  const s = noDashiiTable();
  byChar(s, 'empath').alive = false;
  assert.equal(poisoned(s, 'empath'), true, 'dead, still poisoned');
  assert.equal(poisoned(s, 'savant'), false, 'not poisoned instead');
});

test('No Dashii: the neighbours become healthy when it dies, or when its own ability stops working', () => {
  const dead = noDashiiTable();
  byChar(dead, 'nodashii').alive = false;
  assert.equal(poisoned(dead, 'empath'), false);
  assert.equal(poisoned(dead, 'chef'), false);
  const drunk = noDashiiTable();
  drunk.effects.push({ kind: 'drunk', target: byChar(drunk, 'nodashii').id, source: null, sourceChar: 'test', untilNight: null });
  assert.equal(poisoned(drunk, 'empath'), false);
});

test('No Dashii: when a poisoned Townsfolk stops being a Townsfolk, the next Townsfolk becomes the neighbour and the old one is healthy', () => {
  const s = noDashiiTable();
  const empath = byChar(s, 'empath');
  empath.character = 'saint';
  empath.perceived = 'saint';
  assert.equal(abilityLostReason(s, empath), null, 'the old neighbour is healthy');
  assert.equal(poisoned(s, 'savant'), true, 'the next Townsfolk is now the neighbour');
});

test('No Dashii: two No Dashii poisoning each other does not loop forever', () => {
  const s = mk(['nodashii', 'empath', 'savant', 'artist', 'nodashii', 'chef', 'juggler']);
  assert.doesNotThrow(() => abilityLostReason(s, s.players[1]));
});

test('Vigormortis: the dead Minion\'s nearest Townsfolk is poisoned even if that Townsfolk is dead', () => {
  const s = afterNight1(['vigormortis', 'witch', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  byChar(s, 'empath').alive = false; // both of the Witch's nearest Townsfolk (clockwise: Empath, anticlockwise: Chef) are dead
  byChar(s, 'chef').alive = false;
  night(s, { vigormortis: { targets: ['witch'] } });
  const poisonedChars = s.effects.filter((e) => e.sourceChar === 'vigormortis').map((e) => s.players.find((p) => p.id === e.target)!.character);
  assert.equal(poisonedChars.length, 1);
  assert.ok(poisonedChars[0] === 'empath' || poisonedChars[0] === 'chef', `the dead nearest Townsfolk is poisoned, not ${poisonedChars[0]}`);
});

// ---------------------------------------------------------------- Cerenovus: the Storyteller does not execute when it would hand evil the win (wiki)

/** A day in which the Cerenovus made `mad` mad about being `as`, nobody claimed anything, and the day is over. */
function madDayEnds(chars: CharacterId[], mad: CharacterId, as: string): GameState {
  const s = afterNight1(chars);
  night(s, { cerenovus: { targets: [mad], character: as }, fanggu: { targets: ['juggler'] } }); // (the Fang Gu kills someone harmless)
  endDayByConsensus(s);
  return s;
}

test('Cerenovus: a mad Saint who says nothing is NOT executed — that would make evil win, which the Storyteller avoids', () => {
  const s = madDayEnds(['fanggu', 'cerenovus', 'saint', 'savant', 'artist', 'juggler', 'chef'], 'saint', 'chef');
  assert.equal(byChar(s, 'saint').alive, true);
  assert.equal(s.winner, null, 'the game goes on');
  assert.ok(!s.history.some((e) => e.type === 'madnessExecuted'));
});

test('Cerenovus: with 3 players left, executing the mad player would leave 2 (an evil win) — so they are spared', () => {
  const s = afterNight1(['fanggu', 'cerenovus', 'empath', 'savant', 'artist', 'juggler', 'chef']);
  for (const c of ['savant', 'artist', 'juggler', 'chef'] as const) byChar(s, c).alive = false;
  night(s, { cerenovus: { targets: ['empath'], character: 'chef' }, fanggu: { targets: ['savant'] } }); // (savant is already dead)
  endDayByConsensus(s);
  assert.equal(byChar(s, 'empath').alive, true);
  assert.equal(s.winner, null);
});

test('Cerenovus: an ordinary mad player who says nothing is still executed (unchanged)', () => {
  const s = madDayEnds(['fanggu', 'cerenovus', 'empath', 'savant', 'artist', 'juggler', 'chef'], 'empath', 'chef');
  assert.equal(byChar(s, 'empath').alive, false);
  assert.ok(s.history.some((e) => e.type === 'madnessExecuted'));
});
