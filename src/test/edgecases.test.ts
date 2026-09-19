import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castVote, nominate, startGame, tick, toggleEndDayRequest, useSlayer } from '../game/engine.js';
import { submitRealResponse } from '../game/night.js';
import { viewFor } from '../game/view.js';
import {
  advanceUntil, answerRealTurn, byChar, endDayByConsensus, fastForwardToVote, mk, mkDay, runFullNight, startNight, voteInOrder,
} from './helpers.js';

// ---------------------------------------------------------------------------------------------
// Pretending to be someone you're not
// ---------------------------------------------------------------------------------------------

test('anyone may bluff a Slayer shot, but only the real Slayer can kill — even aimed at the actual Demon', () => {
  const s = mkDay(['imp', 'soldier', 'empath', 'investigator', 'washerwoman']);
  const [imp, soldier] = s.players;
  useSlayer(s, soldier.id, imp.id);
  assert.equal(imp.alive, true, 'claiming to be the Slayer out loud must never kill anyone');
  assert.equal(s.winner, null);
  assert.equal(s.publicLog.at(-1)!.key, 'slayerMiss', 'a bluff looks exactly like a real Slayer missing');
});

test('a bluffed Slayer shot is indistinguishable from a real Slayer missing', () => {
  const real = mkDay(['imp', 'slayer', 'empath', 'investigator', 'washerwoman']);
  useSlayer(real, real.players[1].id, real.players[2].id);
  const bluff = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  useSlayer(bluff, bluff.players[1].id, bluff.players[2].id);
  assert.deepEqual(real.publicLog.at(-1)!.key, bluff.publicLog.at(-1)!.key);
  assert.equal(real.players[2].alive, true);
  assert.equal(bluff.players[2].alive, true);
});

test('a bluffed Slayer shot is once per game too, and the dead cannot claim one', () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [imp, poisoner, empath, investigator] = s.players;
  useSlayer(s, poisoner.id, empath.id);
  assert.throws(() => useSlayer(s, poisoner.id, empath.id), /already used/);
  investigator.alive = false;
  assert.throws(() => useSlayer(s, investigator.id, imp.id), /Dead players/);
});

test('a Drunk who thinks they are the Soldier still dies to the Demon', () => {
  const s = mk(['imp', 'drunk', 'empath', 'washerwoman', 'poisoner'], { drunkFakeChar: 'soldier' });
  const drunk = byChar(s, 'drunk');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [drunk.id]);
  assert.equal(drunk.alive, false, 'believing you are the Soldier does not make you one');
});

test('a Drunk who thinks they are the Virgin never executes their nominator', () => {
  const s = mk(['imp', 'drunk', 'empath', 'washerwoman', 'soldier'], { drunkFakeChar: 'virgin' });
  s.phase = 'day';
  s.day = 1;
  const [, drunk, empath] = s.players;
  nominate(s, empath.id, drunk.id);
  assert.equal(empath.alive, true);
  assert.ok(s.currentNomination, 'the nomination proceeds normally');
});

// ---------------------------------------------------------------------------------------------
// Slayer
// ---------------------------------------------------------------------------------------------

test('a poisoned Slayer misses the real Demon and still uses up their shot', () => {
  const s = mkDay(['imp', 'slayer', 'poisoner', 'empath', 'soldier']);
  const [imp, slayer] = s.players;
  s.poisonedId = slayer.id;
  useSlayer(s, slayer.id, imp.id);
  assert.equal(imp.alive, true);
  assert.equal(slayer.slayerUsed, true);
  assert.throws(() => useSlayer(s, slayer.id, imp.id), /already used/);
});

test('the Slayer shooting a dead player does nothing but still spends the shot', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'investigator', 'soldier']);
  const [, slayer, empath] = s.players;
  empath.alive = false;
  useSlayer(s, slayer.id, empath.id);
  assert.equal(slayer.slayerUsed, true);
  assert.equal(s.winner, null);
});

test('the Slayer shooting themselves does nothing', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'investigator', 'soldier']);
  const slayer = s.players[1];
  useSlayer(s, slayer.id, slayer.id);
  assert.equal(slayer.alive, true);
});

test('the Slayer shooting a Spy never kills them — a Spy can look good, never like the Demon', () => {
  for (let seed = 0; seed < 30; seed++) {
    const s = mkDay(['imp', 'slayer', 'spy', 'empath', 'soldier']);
    s.secret = `spy-slayer-${seed}`;
    const [, slayer, spy] = s.players;
    useSlayer(s, slayer.id, spy.id);
    assert.equal(spy.alive, true);
  }
});

test('the Slayer killing the Imp with a Scarlet Woman and 5+ alive promotes her — the game goes on', () => {
  const s = mkDay(['imp', 'slayer', 'scarletwoman', 'empath', 'soldier', 'washerwoman']);
  const [imp, slayer, sw] = s.players;
  useSlayer(s, slayer.id, imp.id);
  assert.equal(imp.alive, false);
  assert.equal(sw.character, 'imp');
  assert.equal(s.winner, null);
});

test('the Slayer cannot shoot at night or after the game has ended', () => {
  const s = mk(['imp', 'slayer', 'empath', 'investigator', 'soldier']);
  startNight(s);
  const [imp, slayer] = s.players;
  assert.throws(() => useSlayer(s, slayer.id, imp.id), /during the day/);
  s.phase = 'ended';
  assert.throws(() => useSlayer(s, slayer.id, imp.id), /during the day/);
});

// ---------------------------------------------------------------------------------------------
// Scarlet Woman threshold
// ---------------------------------------------------------------------------------------------

test('Scarlet Woman: exactly 5 alive when the Demon is executed (counting the Demon) is enough', () => {
  // Official rule: "If there are 5 or more players alive & the Demon dies" — the Demon is still
  // one of those 5 at the moment they die.
  const s = mkDay(['imp', 'scarletwoman', 'empath', 'investigator', 'washerwoman']); // majority = 3
  const [imp, sw, empath, investigator, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id]);
  endDayByConsensus(s);
  assert.equal(imp.alive, false);
  assert.equal(sw.character, 'imp', 'she must become the Demon');
  assert.equal(s.winner, null, 'the game continues with the new Demon');
});

test('Scarlet Woman: only 4 alive when the Demon dies is not enough — good wins', () => {
  const s = mkDay(['imp', 'scarletwoman', 'empath', 'investigator']); // majority = 3
  const [imp, sw, empath, investigator] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, sw.id]);
  endDayByConsensus(s);
  assert.equal(sw.character, 'scarletwoman');
  assert.equal(s.winner, 'good');
});

test('Scarlet Woman: an Imp star-pass with exactly 5 alive (counting the Imp) promotes her, not another Minion', () => {
  const s = mk(['imp', 'scarletwoman', 'poisoner', 'empath', 'soldier']);
  const imp = byChar(s, 'imp');
  const sw = byChar(s, 'scarletwoman');
  const poisoner = byChar(s, 'poisoner');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [imp.id]);
  assert.equal(sw.character, 'imp');
  assert.equal(poisoner.character, 'poisoner');
});

test('a poisoned Scarlet Woman is not promoted — good wins', () => {
  const s = mkDay(['imp', 'scarletwoman', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']); // majority 4
  const [imp, sw, , empath, investigator, washerwoman, soldier] = s.players;
  s.poisonedId = sw.id;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id, soldier.id]);
  endDayByConsensus(s);
  assert.equal(sw.character, 'scarletwoman');
  assert.equal(s.winner, 'good');
});

// ---------------------------------------------------------------------------------------------
// Virgin
// ---------------------------------------------------------------------------------------------

test('Virgin: the execution ends the day at once — nobody on the block is executed as well', () => {
  const s = mkDay(['imp', 'virgin', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, virgin, empath, investigator, washerwoman, soldier] = s.players;
  nominate(s, empath.id, soldier.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id, imp.id]);
  assert.equal(s.onBlockId, soldier.id);

  nominate(s, investigator.id, virgin.id);
  assert.equal(investigator.alive, false, 'the Townsfolk nominator is executed');
  assert.equal(s.phase, 'night', 'only one execution per day — the day is over');
  assert.equal(soldier.alive, true, 'whoever was on the block is not executed too');
  assert.equal(s.lastExecutedId, investigator.id, 'the Undertaker must learn about the Virgin execution');
});

test('Virgin: after the day ends, nobody can nominate again that day', () => {
  const s = mkDay(['imp', 'virgin', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, virgin, empath, investigator] = s.players;
  nominate(s, empath.id, virgin.id);
  assert.throws(() => nominate(s, investigator.id, imp.id));
});

test('Virgin: an execution by the Virgin stops a Mayor win — an execution did happen', () => {
  const s = mkDay(['imp', 'virgin', 'mayor', 'empath']);
  const [, virgin, mayor, empath] = s.players;
  nominate(s, empath.id, virgin.id); // empath executed, 3 left alive: imp, virgin, mayor
  assert.equal(empath.alive, false);
  assert.notEqual(s.winner, 'good', 'the Mayor wins only when no execution happens');
  assert.equal(mayor.alive, true);
});

test('Virgin: a Virgin nominating herself is executed (she is a Townsfolk nominator)', () => {
  const s = mkDay(['imp', 'virgin', 'empath', 'investigator', 'soldier']);
  const virgin = s.players[1];
  nominate(s, virgin.id, virgin.id);
  assert.equal(virgin.alive, false);
});

test('Virgin: a poisoned Virgin does not proc, and that first nomination still uses up her power', () => {
  const s = mkDay(['imp', 'virgin', 'empath', 'investigator', 'poisoner']);
  const [, virgin, empath] = s.players;
  s.poisonedId = virgin.id;
  nominate(s, empath.id, virgin.id);
  assert.equal(empath.alive, true);
  assert.equal(virgin.virginUsed, true);
});

test('Virgin: nominated by the Drunk (an Outsider) does not proc', () => {
  const s = mk(['imp', 'virgin', 'drunk', 'investigator', 'soldier'], { drunkFakeChar: 'empath' });
  s.phase = 'day';
  s.day = 1;
  const [, virgin, drunk] = s.players;
  nominate(s, drunk.id, virgin.id);
  assert.equal(drunk.alive, true);
});

test('Virgin: her first nomination by an evil player uses up her power', () => {
  const s = mkDay(['imp', 'virgin', 'empath', 'investigator', 'soldier']);
  const [imp, virgin] = s.players;
  nominate(s, imp.id, virgin.id);
  assert.equal(virgin.virginUsed, true);
  assert.equal(imp.alive, true);
});

// ---------------------------------------------------------------------------------------------
// Poisoner
// ---------------------------------------------------------------------------------------------

test('Poisoner: poison ends the moment the Poisoner dies', () => {
  const s = mk(['imp', 'poisoner', 'slayer', 'empath', 'soldier', 'washerwoman']);
  const imp = byChar(s, 'imp');
  const poisoner = byChar(s, 'poisoner');
  const slayer = byChar(s, 'slayer');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [slayer.id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [poisoner.id]);
  runFullNight(s);
  assert.equal(s.phase, 'day');
  assert.equal(poisoner.alive, false);
  useSlayer(s, slayer.id, imp.id);
  assert.equal(imp.alive, false, 'with the Poisoner dead, the Slayer is healthy again');
  assert.equal(s.winner, 'good');
});

test('Poisoner: a poisoned Imp kills nobody', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const imp = byChar(s, 'imp');
  const empath = byChar(s, 'empath');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [imp.id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [empath.id]);
  assert.equal(empath.alive, true);
});

test('Poisoner: a poisoned Mayor is not redirected — the Mayor dies', () => {
  const s = mk(['imp', 'poisoner', 'mayor', 'washerwoman', 'soldier', 'empath']);
  const mayor = byChar(s, 'mayor');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [mayor.id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [mayor.id]);
  assert.equal(mayor.alive, false);
});

test('Poisoner: a poisoned Saint executed does not lose the game', () => {
  const s = mkDay(['imp', 'saint', 'poisoner', 'empath', 'investigator']);
  const [imp, saint, , empath, investigator] = s.players;
  s.poisonedId = saint.id;
  nominate(s, empath.id, saint.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, imp.id]);
  endDayByConsensus(s);
  assert.equal(saint.alive, false);
  assert.equal(s.winner, null);
});

test('Poisoner: poison with no living Poisoner in play has no effect', () => {
  const s = mkDay(['imp', 'virgin', 'empath', 'investigator', 'poisoner']);
  const [, virgin, empath, , poisoner] = s.players;
  s.poisonedId = virgin.id;
  poisoner.alive = false;
  nominate(s, empath.id, virgin.id);
  assert.equal(empath.alive, false, 'the Virgin works again once the Poisoner is dead');
});

// ---------------------------------------------------------------------------------------------
// Night choices that should be refused
// ---------------------------------------------------------------------------------------------

test('Fortune Teller cannot pick the same player twice', () => {
  const s = mk(['imp', 'fortuneteller', 'empath', 'washerwoman', 'soldier']);
  const ft = byChar(s, 'fortuneteller');
  const empath = byChar(s, 'empath');
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  assert.throws(() => submitRealResponse(s, ft.id, [empath.id, empath.id]));
});

test('Fortune Teller must pick exactly two players', () => {
  const s = mk(['imp', 'fortuneteller', 'empath', 'washerwoman', 'soldier']);
  const [imp, ft, empath, washerwoman] = s.players;
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  assert.throws(() => submitRealResponse(s, ft.id, [empath.id]));
  assert.throws(() => submitRealResponse(s, ft.id, [empath.id, washerwoman.id, imp.id]));
});

test('Monk cannot protect themselves', () => {
  const s = mk(['imp', 'monk', 'empath', 'washerwoman', 'soldier']);
  const monk = byChar(s, 'monk');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'monk');
  assert.throws(() => submitRealResponse(s, monk.id, [monk.id]), /yourself/);
});

test('the Imp may attack a dead player — nothing happens, and nobody is reported dead', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'investigator']);
  const imp = byChar(s, 'imp');
  const empath = byChar(s, 'empath');
  startNight(s);
  runFullNight(s);
  empath.alive = false;
  startNight(s);
  advanceUntil(s, 'imp');
  submitRealResponse(s, imp.id, [empath.id]);
  runFullNight(s);
  assert.equal(s.phase, 'day');
  assert.deepEqual(s.deathsTonight, []);
  assert.equal(s.publicLog.at(-1)!.key, 'nobodyDiedLastNight');
});

test('a player dead from an earlier night is never woken for real, but still gets a decoy screen', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const empath = byChar(s, 'empath');
  empath.alive = false;
  startNight(s);
  advanceUntil(s, 'poisoner');
  assert.ok(s.pendingRealTurn!.participantIds.includes(empath.id), 'the dead still get a screen');
  assert.ok(!s.pendingRealTurn!.playerIds.includes(empath.id), 'but never a real turn');
});

test('a Zombuul that looks dead still acts, and the other dead players get decoys so it blends in', () => {
  const s = mkDay(['zombuul', 'poisoner', 'empath', 'soldier', 'mayor', 'chef', 'butler']);
  const zombuul = byChar(s, 'zombuul');
  const empath = byChar(s, 'empath');
  zombuul.alive = false;
  zombuul.flags.hiddenAlive = true; // the Zombuul's first "death": it looks dead but lives on
  empath.alive = false; // dead for real, several nights ago
  startNight(s);
  advanceUntil(s, 'zombuul');
  assert.ok(s.pendingRealTurn!.playerIds.includes(zombuul.id), 'the hidden Zombuul wakes for real');
  assert.equal(viewFor(s, zombuul.id).nightTurn?.decoy, false, 'and gets the real turn');
  assert.equal(viewFor(s, empath.id).nightTurn?.decoy, true, 'a long-dead player gets a decoy, masking it');
  assert.equal(viewFor(s, byChar(s, 'soldier').id).nightTurn?.decoy, true);
});

test('a player cannot answer the same night turn twice', () => {
  const s = mk(['imp', 'poisoner', 'scarletwoman', 'empath', 'washerwoman', 'soldier', 'monk']); // 7+: Minion info happens
  startNight(s);
  advanceUntil(s, 'minion-info');
  const [first] = s.pendingRealTurn!.playerIds;
  submitRealResponse(s, first, []);
  assert.throws(() => submitRealResponse(s, first, []), /Already responded/);
});

test('an unknown player id is refused as a night target', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const poisoner = byChar(s, 'poisoner');
  startNight(s);
  advanceUntil(s, 'poisoner');
  assert.throws(() => submitRealResponse(s, poisoner.id, ['not-a-player']));
});

test('the Monk protecting the Imp stops a star-pass', () => {
  const s = mk(['imp', 'monk', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  const imp = byChar(s, 'imp');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'monk');
  answerRealTurn(s, [imp.id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [imp.id]);
  assert.equal(imp.alive, true);
  assert.equal(imp.character, 'imp');
});

// ---------------------------------------------------------------------------------------------
// Nominations and votes
// ---------------------------------------------------------------------------------------------

test('a player may nominate themselves', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const empath = s.players[1];
  nominate(s, empath.id, empath.id);
  assert.equal(s.currentNomination?.nomineeId, empath.id);
});

test('nobody can nominate at night', () => {
  const s = mk(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  startNight(s);
  const [imp, empath] = s.players;
  assert.throws(() => nominate(s, empath.id, imp.id), /Not day/);
});

test('a dead player cannot nominate, but a dead player can be nominated', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, empath, investigator] = s.players;
  empath.alive = false;
  assert.throws(() => nominate(s, empath.id, imp.id), /Dead players cannot nominate/);
  nominate(s, investigator.id, empath.id);
  assert.equal(s.currentNomination?.nomineeId, empath.id);
});

test('each player nominates at most once a day and is nominated at most once a day — both reset the next day', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  startNight(s);
  runFullNight(s);
  const imp = byChar(s, 'imp');
  const empath = byChar(s, 'empath');
  const investigator = byChar(s, 'investigator');
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, []);
  assert.throws(() => nominate(s, empath.id, investigator.id), /Already nominated/);
  assert.throws(() => nominate(s, investigator.id, imp.id), /Already nominated/);
  endDayByConsensus(s);
  runFullNight(s);
  assert.equal(s.phase, 'day');
  nominate(s, empath.id, imp.id); // a new day — both are allowed again
});

test('only one nomination runs at a time', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, empath, investigator, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  assert.throws(() => nominate(s, investigator.id, washerwoman.id), /already in progress/);
});

test('voting out of turn or before the vote opens is refused', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, empath, investigator] = s.players;
  nominate(s, empath.id, imp.id);
  assert.throws(() => castVote(s, investigator.id, true), /Not voting yet/);
  fastForwardToVote(s);
  const notCurrent = s.players.find((p) => p.id !== s.currentNomination!.currentVoterId)!;
  assert.throws(() => castVote(s, notCurrent.id, true), /Not your turn/);
});

test("a dead player's no vote does not use up their ghost vote", () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier', 'mayor']);
  const [imp, empath, investigator] = s.players;
  empath.alive = false;
  nominate(s, investigator.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, []);
  assert.equal(empath.ghostVoteUsed, false);
});

test('a dead player who already used their ghost vote is skipped in later votes', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier', 'mayor']);
  const [imp, empath, investigator, washerwoman] = s.players;
  empath.alive = false;
  nominate(s, investigator.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id]);
  assert.equal(empath.ghostVoteUsed, true);

  nominate(s, washerwoman.id, investigator.id);
  fastForwardToVote(s);
  const seen: string[] = [];
  while (s.currentNomination?.state === 'voting') {
    seen.push(s.currentNomination.currentVoterId!);
    castVote(s, s.currentNomination.currentVoterId!, false);
  }
  assert.ok(!seen.includes(empath.id), 'a dead player with no vote left is never asked again');
});

test('ghost votes count toward the yes total, but the majority is based on living players only', () => {
  // 7 players, 2 dead → 5 alive → majority 3. Two dead yes + one living yes = 3.
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier', 'mayor', 'monk']);
  const [imp, empath, investigator, washerwoman] = s.players;
  empath.alive = false;
  investigator.alive = false;
  nominate(s, washerwoman.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id]);
  assert.equal(s.onBlockId, imp.id);
});

test('a tie with the current leader clears the block, and a later equal count cannot retake it', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']); // majority 3
  const [imp, empath, investigator, washerwoman, soldier] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id]);
  assert.equal(s.onBlockId, imp.id);

  nominate(s, investigator.id, soldier.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id]);
  assert.equal(s.onBlockId, null, 'tie → nobody on the block');

  nominate(s, washerwoman.id, empath.id);
  fastForwardToVote(s);
  voteInOrder(s, [imp.id, investigator.id, washerwoman.id]);
  assert.equal(s.onBlockId, null, 'matching the tied count again does not put anyone on the block');

  endDayByConsensus(s);
  assert.ok(s.players.every((p) => p.alive), 'a tied day ends with no execution');
});

test('exactly half the living players voting yes is enough (3 of 6)', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier', 'mayor']); // 6 alive → need 3
  const [imp, empath, investigator, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id]);
  assert.equal(s.onBlockId, imp.id);
});

test('one vote short of half the living players is not enough (2 of 6)', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier', 'mayor']);
  const [imp, empath, investigator] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id]);
  assert.equal(s.onBlockId, null);
});

test('the per-voter timeout counts a silent voter as a no — it never votes yes for them', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, empath] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  // Nobody touches their phone: every voter times out one after another.
  let guard = 0;
  while (s.currentNomination?.state === 'voting' && guard++ < 20) {
    tick(s, s.currentNomination.voterDeadline! + 1);
  }
  assert.equal(s.onBlockId, null);
  assert.ok(s.players.every((p) => p.alive));
});

// ---------------------------------------------------------------------------------------------
// Ending the day / winning
// ---------------------------------------------------------------------------------------------

test('a poisoned Mayor does not win with 3 alive and no execution', () => {
  const s = mkDay(['imp', 'mayor', 'poisoner']);
  const mayor = s.players[1];
  s.poisonedId = mayor.id;
  endDayByConsensus(s);
  assert.notEqual(s.winner, 'good');
});

test('executing a non-Demon down to 2 alive gives evil the win', () => {
  const s = mkDay(['imp', 'empath', 'investigator']); // majority 2
  const [imp, empath, investigator] = s.players;
  nominate(s, imp.id, empath.id);
  fastForwardToVote(s);
  voteInOrder(s, [imp.id, investigator.id]);
  endDayByConsensus(s);
  assert.equal(s.winner, 'evil');
});

test('nothing more can happen once the game has ended', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'investigator', 'soldier']);
  const [imp, slayer, empath, investigator] = s.players;
  useSlayer(s, slayer.id, imp.id);
  assert.equal(s.winner, 'good');
  assert.throws(() => nominate(s, empath.id, investigator.id));
  assert.throws(() => toggleEndDayRequest(s, empath.id));
});

test('the game cannot be started twice', () => {
  const s = mk(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  s.phase = 'night';
  assert.throws(() => startGame(s), /already started/);
});
