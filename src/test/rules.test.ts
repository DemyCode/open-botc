// One test per rule of the official Blood on the Clocktower rulebook (Trouble Brewing), quoted
// where it helps. Rules already covered elsewhere (day/night/characters/edgecases) aren't repeated.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castVote, nominate, useSlayer } from '../game/engine.js';
import { submitRealResponse } from '../game/night.js';
import { registersAs } from '../game/registration.js';
import type { CharacterId } from '../game/types.js';
import {
  advanceUntil, answerRealTurn, byChar, endDayByConsensus, fastForwardToVote, mk, mkDay, runFullNight, skipRound, startNight, voteInOrder,
} from './helpers.js';

const FILLER: CharacterId[] = ['empath', 'investigator', 'washerwoman', 'soldier', 'mayor', 'monk', 'chef', 'librarian', 'undertaker'];

// ---------------------------------------------------------------------------------------------
// "If it is the first night and you are playing with 7 or more players" → Minion & Demon info
// ---------------------------------------------------------------------------------------------

for (const n of [5, 6]) {
  test(`${n} players: the evil team does not learn each other on the first night, and the Imp gets no bluffs`, () => {
    const s = mk(['imp', 'poisoner', ...FILLER].slice(0, n) as CharacterId[]);
    const imp = byChar(s, 'imp');
    const poisoner = byChar(s, 'poisoner');
    startNight(s);
    const seen: string[] = [];
    while (s.phase === 'night') {
      if (s.pendingRealTurn) seen.push(s.pendingRealTurn.charId);
      skipRound(s);
    }
    assert.ok(!seen.includes('minion-info'), 'no Minion info');
    assert.ok(!seen.includes('imp'), 'the Imp has nothing to do on the first night');
    assert.ok(!imp.log.some((e) => e.msg.key === 'demonInfo'));
    assert.ok(!poisoner.log.some((e) => e.msg.key.startsWith('minionInfo')));
  });
}

test('7 players: Minions learn the Demon, and the Demon learns the Minions and 3 bluffs', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier', 'monk']);
  s.bluffs = ['mayor', 'virgin', 'saint'];
  const imp = byChar(s, 'imp');
  const poisoner = byChar(s, 'poisoner');
  startNight(s);
  runFullNight(s);
  assert.ok(poisoner.log.some((e) => e.msg.key.startsWith('minionInfo')));
  const demon = imp.log.find((e) => e.msg.key === 'demonInfo');
  assert.ok(demon);
  assert.deepEqual(demon!.msg.vars!.bluffs, ['mayor', 'virgin', 'saint']);
});

// ---------------------------------------------------------------------------------------------
// "The number of votes equals or exceeds half the number of alive players."
// ---------------------------------------------------------------------------------------------

for (let alive = 3; alive <= 10; alive++) {
  const needed = Math.ceil(alive / 2);
  test(`${alive} alive: ${needed} votes put the nominee on the block, ${needed - 1} do not`, () => {
    const chars = ['imp', ...FILLER].slice(0, alive) as CharacterId[];
    for (const yes of [needed, needed - 1]) {
      const s = mkDay(chars);
      const [imp, nominator] = s.players;
      nominate(s, nominator.id, imp.id);
      fastForwardToVote(s);
      const yesIds = s.currentNomination!.voteOrder.filter((id) => id !== imp.id).slice(0, yes);
      voteInOrder(s, yesIds);
      assert.equal(s.onBlockId, yes === needed ? imp.id : null, `${yes} yes of ${alive} alive`);
    }
  });
}

test('the nominee votes last', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, empath] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  assert.equal(s.currentNomination!.voteOrder.at(-1), imp.id);
  assert.equal(s.currentNomination!.voteOrder.length, s.players.length, 'everyone is asked once');
});

test('the nominee may vote for themselves, and it counts', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']); // needs 3
  const [imp, empath, investigator] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, imp.id]);
  assert.equal(s.onBlockId, imp.id);
});

test('"A nominated player must exceed this tied number of votes" — a later, higher vote wins the block back', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']); // needs 3
  const [imp, empath, investigator, washerwoman, soldier] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id]);
  nominate(s, investigator.id, soldier.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id]);
  assert.equal(s.onBlockId, null);
  nominate(s, washerwoman.id, empath.id);
  fastForwardToVote(s);
  voteInOrder(s, [imp.id, investigator.id, washerwoman.id, soldier.id]);
  assert.equal(s.onBlockId, empath.id);
  endDayByConsensus(s);
  assert.equal(empath.alive, false);
});

test('"Any player who is about to die may still nominate"', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, empath, investigator, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id, washerwoman.id]);
  assert.equal(s.onBlockId, imp.id);
  nominate(s, imp.id, washerwoman.id); // the Imp is about to die, but hasn't nominated today
  assert.equal(s.currentNomination?.nominatorId, imp.id);
});

test('"Each alive player may vote for as many players as they wish per day"', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, empath, investigator, washerwoman, soldier] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id]);
  nominate(s, investigator.id, soldier.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id]);
  nominate(s, washerwoman.id, investigator.id);
  fastForwardToVote(s);
  assert.doesNotThrow(() => voteInOrder(s, [empath.id]));
});

// ---------------------------------------------------------------------------------------------
// "Dead players can be nominated" / "even dead players may be executed again"
// ---------------------------------------------------------------------------------------------

function executeDead(chars: CharacterId[], deadIndex: number) {
  const s = mkDay(chars);
  const dead = s.players[deadIndex];
  dead.alive = false;
  const nominator = s.players.find((p) => p.alive)!;
  nominate(s, nominator.id, dead.id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id)); // everyone living votes yes (the dead may too)
  assert.equal(s.onBlockId, dead.id);
  return { s, dead };
}

test('executing a dead player counts as the day\'s execution: they stay dead, and the Undertaker learns their character', () => {
  const { s, dead } = executeDead(['imp', 'undertaker', 'empath', 'investigator', 'washerwoman', 'poisoner'], 2);
  endDayByConsensus(s);
  assert.equal(s.lastExecutedId, dead.id);
  assert.equal(s.phase, 'night');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'investigator').id]); // keep the Undertaker alive for their turn
  advanceUntil(s, 'undertaker');
  const undertaker = byChar(s, 'undertaker');
  assert.equal(undertaker.log.at(-1)!.msg.vars!.role, 'empath');
});

test('executing a dead Saint does not lose the game — a dead player has no ability', () => {
  const { s } = executeDead(['imp', 'saint', 'empath', 'investigator', 'washerwoman', 'soldier'], 1);
  endDayByConsensus(s);
  assert.equal(s.winner, null);
});

test('executing a dead player with 3 alive stops a Mayor win — an execution did occur', () => {
  const { s } = executeDead(['imp', 'mayor', 'empath', 'investigator'], 3);
  endDayByConsensus(s);
  assert.notEqual(s.winner, 'good');
});

test('a dead Virgin nominated by a Townsfolk does nothing — dead players have no ability', () => {
  const s = mkDay(['imp', 'virgin', 'empath', 'investigator', 'soldier']);
  const [, virgin, empath] = s.players;
  virgin.alive = false;
  nominate(s, empath.id, virgin.id);
  assert.equal(empath.alive, true);
  assert.equal(virgin.virginUsed, false);
});

// ---------------------------------------------------------------------------------------------
// Winning
// ---------------------------------------------------------------------------------------------

test('"If both teams would win at the same time, good wins" — the Demon dies leaving 2 alive', () => {
  const s = mkDay(['imp', 'slayer', 'empath']);
  const [imp, slayer] = s.players;
  useSlayer(s, slayer.id, imp.id);
  assert.equal(s.players.filter((p) => p.alive).length, 2);
  assert.equal(s.winner, 'good');
});

test('the Demon executed with exactly 2 others alive: good wins', () => {
  const s = mkDay(['imp', 'empath', 'investigator']);
  const [imp, empath, investigator] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, investigator.id]);
  endDayByConsensus(s);
  assert.equal(s.winner, 'good');
});

test('dead and alive players win and lose as a team — the game ends for everyone at once', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'investigator', 'soldier']);
  const [imp, slayer, empath] = s.players;
  empath.alive = false;
  useSlayer(s, slayer.id, imp.id);
  assert.equal(s.phase, 'ended');
  assert.equal(s.winner, 'good');
});

// ---------------------------------------------------------------------------------------------
// Night: "Yes, if you get to choose 'any player' at night, you can choose yourself or a dead player."
// ---------------------------------------------------------------------------------------------

test('the Monk may protect a dead player (it just does nothing)', () => {
  const s = mk(['imp', 'monk', 'empath', 'washerwoman', 'soldier']);
  startNight(s);
  runFullNight(s);
  const empath = byChar(s, 'empath');
  empath.alive = false;
  startNight(s);
  advanceUntil(s, 'monk');
  answerRealTurn(s, [empath.id]);
  assert.equal(s.monkProtectedId, empath.id);
});

test('the Fortune Teller may include themselves in their two picks', () => {
  const s = mk(['imp', 'fortuneteller', 'empath', 'washerwoman', 'soldier']);
  const ft = byChar(s, 'fortuneteller');
  const imp = byChar(s, 'imp');
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  submitRealResponse(s, ft.id, [ft.id, imp.id]);
  assert.equal(ft.nightResult?.key, 'fortuneTellerYes');
});

test('the Butler may not choose themselves as their Master', () => {
  const s = mk(['imp', 'butler', 'empath', 'washerwoman', 'soldier']);
  const butler = byChar(s, 'butler');
  startNight(s);
  advanceUntil(s, 'butler');
  assert.throws(() => submitRealResponse(s, butler.id, [butler.id]), /yourself/);
});

test('"If a character dies at night before they would wake up, that character won\'t wake up"', () => {
  const s = mk(['imp', 'empath', 'fortuneteller', 'washerwoman', 'soldier', 'poisoner']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  const empath = byChar(s, 'empath');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [empath.id]);
  const woke: string[] = [];
  while (s.phase === 'night') {
    if (s.pendingRealTurn) woke.push(...s.pendingRealTurn.playerIds);
    skipRound(s);
  }
  assert.ok(!woke.includes(empath.id), 'the Empath died before their turn and never wakes');
});

test('a Ravenkeeper killed by a Mayor\'s redirected kill still wakes', () => {
  // Two Soldiers leave the Ravenkeeper as the only possible redirect target.
  const s = mk(['imp', 'mayor', 'ravenkeeper', 'soldier', 'soldier']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  const mayor = byChar(s, 'mayor');
  const rk = byChar(s, 'ravenkeeper');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [mayor.id]);
  assert.equal(mayor.alive, true);
  assert.equal(rk.alive, false);
  assert.equal(s.pendingRealTurn?.charId, 'ravenkeeper');
});

test('"A poisoned Demon still wakes to attack a player, but nobody dies" — including a star-pass', () => {
  const s = mk(['imp', 'poisoner', 'scarletwoman', 'empath', 'washerwoman', 'soldier']);
  const imp = byChar(s, 'imp');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [imp.id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [imp.id]);
  assert.equal(imp.alive, true);
  assert.equal(imp.character, 'imp');
});

test('"If a Poisoner poisons the Slayer at night, then the Poisoner dies later that same night, the Slayer is no longer poisoned"', () => {
  const s = mk(['imp', 'poisoner', 'slayer', 'empath', 'washerwoman', 'soldier']);
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
  useSlayer(s, slayer.id, imp.id);
  assert.equal(s.winner, 'good');
});

// ---------------------------------------------------------------------------------------------
// Registration: "the Spy can register as a Townsfolk to the Virgin"
// ---------------------------------------------------------------------------------------------

test('a Spy nominating the Virgin is sometimes executed (registering as a Townsfolk), sometimes not', () => {
  let procs = 0;
  let misses = 0;
  for (let seed = 0; seed < 60; seed++) {
    const s = mkDay(['imp', 'virgin', 'spy', 'empath', 'soldier']);
    s.secret = `spy-virgin-${seed}`;
    const [, virgin, spy] = s.players;
    nominate(s, spy.id, virgin.id);
    if (spy.alive) misses++;
    else procs++;
  }
  assert.ok(procs > 0 && misses > 0, `expected both outcomes (procs=${procs}, misses=${misses})`);
});

test('a Recluse nominating the Virgin is never executed — the Recluse is an Outsider, never a Townsfolk', () => {
  for (let seed = 0; seed < 30; seed++) {
    const s = mkDay(['imp', 'virgin', 'recluse', 'empath', 'soldier']);
    s.secret = `recluse-virgin-${seed}`;
    const [, virgin, recluse] = s.players;
    nominate(s, recluse.id, virgin.id);
    assert.equal(recluse.alive, true, 'the Recluse is an Outsider, never a Townsfolk');
  }
});

test('registration is only a disguise: a Spy registering as good is still evil, and still wins with evil', () => {
  const s = mkDay(['imp', 'spy', 'empath', 'investigator', 'soldier']);
  const spy = s.players[1];
  assert.equal(spy.alignment, 'evil');
  // Whatever the Spy registers as to any single question, their real alignment never changes.
  for (let i = 0; i < 20; i++) registersAs(s, spy, 'good', { asker: s.players[2].id, slot: `q${i}` });
  assert.equal(spy.alignment, 'evil');
});

// ---------------------------------------------------------------------------------------------
// Dead players' votes
// ---------------------------------------------------------------------------------------------

test('"Dead players without a vote token cannot vote" — a dead player with no vote left is skipped', () => {
  const s = mkDay(['imp', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [imp, empath, investigator] = s.players;
  empath.alive = false;
  empath.ghostVoteUsed = true;
  nominate(s, investigator.id, imp.id);
  fastForwardToVote(s);
  let asked = false;
  while (s.currentNomination?.state === 'voting') {
    if (s.currentNomination.currentVoterId === empath.id) asked = true;
    castVote(s, s.currentNomination.currentVoterId!, false);
  }
  assert.equal(asked, false);
});
