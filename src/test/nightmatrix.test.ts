// Night interactions as tables: every kill / protection / poison combination and what it must
// do, then the multi-night rules (poison lifetime, Butler, Undertaker, Monk, Ravenkeeper,
// Scarlet Woman, Mayor). Each row plays a real night through the engine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castVote, nominate, useSlayer } from '../game/engine.js';
import { abilityWorks } from '../game/registration.js';
import type { CharacterId, GameState, PlayerState } from '../game/types.js';
import { viewFor } from '../game/view.js';
import {
  advanceUntil, answerRealTurn, breakDawn, byChar, endDayByConsensus, fastForwardToVote, mk, runFullNight, skipRound, startNight, voteInOrder,
} from './helpers.js';

const LAYOUT: CharacterId[] = ['imp', 'poisoner', 'monk', 'mayor', 'soldier', 'washerwoman', 'empath', 'ravenkeeper'];

/** A game whose NIGHT 2 is about to start (night 1 has been played out harmlessly). */
function atNight2(layout: CharacterId[] = LAYOUT, opts: Parameters<typeof mk>[1] = {}): GameState {
  const s = mk(layout, opts);
  startNight(s);
  runFullNight(s);
  return s;
}

type Picks = Partial<Record<CharacterId | 'minion-info', CharacterId[]>>;

/** Plays night 2: the named steps are answered with the named characters; any other step is skipped. */
function playNight(s: GameState, picks: Picks): void {
  startNight(s);
  let guard = 0;
  while (s.pendingRealTurn && guard++ < 40) {
    const t = s.pendingRealTurn;
    const p = picks[t.charId];
    if (p) answerRealTurn(s, p.map((c) => byChar(s, c).id));
    else skipRound(s);
  }
  breakDawn(s);
}

const who = (s: GameState, dead: boolean): string[] => s.players.filter((p) => p.alive !== dead).map((p) => p.character).sort();

// ---------------------------------------------------------------- the Imp's attack, every combination

const ATTACKS: { name: string; picks: Picks; dead: CharacterId[] }[] = [
  { name: 'plain kill', picks: { imp: ['washerwoman'] }, dead: ['washerwoman'] },
  { name: 'kill the Soldier: immune', picks: { imp: ['soldier'] }, dead: [] },
  { name: 'kill a poisoned Soldier: dies', picks: { poisoner: ['soldier'], imp: ['soldier'] }, dead: ['soldier'] },
  { name: 'Monk protects the target: nobody dies', picks: { monk: ['washerwoman'], imp: ['washerwoman'] }, dead: [] },
  { name: 'Monk protects the wrong player: the target dies', picks: { monk: ['empath'], imp: ['washerwoman'] }, dead: ['washerwoman'] },
  { name: 'a poisoned Monk protects nobody', picks: { poisoner: ['monk'], monk: ['washerwoman'], imp: ['washerwoman'] }, dead: ['washerwoman'] },
  { name: 'kill the Monk', picks: { imp: ['monk'] }, dead: ['monk'] },
  { name: 'kill the Poisoner', picks: { imp: ['poisoner'] }, dead: ['poisoner'] },
  { name: 'kill the Mayor while poisoned: the Mayor dies', picks: { poisoner: ['mayor'], imp: ['mayor'] }, dead: ['mayor'] },
  { name: 'kill the Mayor while protected: nobody dies', picks: { monk: ['mayor'], imp: ['mayor'] }, dead: [] },
  { name: 'a poisoned Imp kills nobody', picks: { poisoner: ['imp'], imp: ['washerwoman'] }, dead: [] },
  { name: 'Monk-protected Imp attacking itself survives (the star-pass is blocked)', picks: { monk: ['imp'], imp: ['imp'] }, dead: [] },
  { name: 'a poisoned Imp attacking itself survives too', picks: { poisoner: ['imp'], imp: ['imp'] }, dead: [] },
  { name: 'attack the Ravenkeeper', picks: { imp: ['ravenkeeper'] }, dead: ['ravenkeeper'] },
];

for (const row of ATTACKS) {
  test(`Imp attack — ${row.name}`, () => {
    const s = atNight2();
    playNight(s, row.picks);
    assert.deepEqual(who(s, true), [...row.dead].sort());
    assert.equal(s.winner, null);
    assert.equal(byChar(s, 'imp').alive, true);
  });
}

test('Imp attack — the Mayor is attacked: somebody ELSE dies (not the Mayor, the Imp or the immune Soldier)', () => {
  const dies = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const s = atNight2();
    s.secret = `mayor-${i}`;
    const realRandom = Math.random;
    let k = i;
    Math.random = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
    try {
      playNight(s, { imp: ['mayor'] });
    } finally {
      Math.random = realRandom;
    }
    const dead = s.players.filter((p) => !p.alive);
    assert.equal(dead.length, 1, 'exactly one death');
    assert.ok(!['mayor', 'imp', 'soldier'].includes(dead[0].character), `${dead[0].character} should not be the one who dies`);
    dead.forEach((p) => dies.add(p.character));
  }
  assert.ok(dies.size >= 3, `the death should be spread across several players (${[...dies]})`);
});

test('Imp attack — a Mayor whose only other option is a protected player dies instead of bouncing to a protected one', () => {
  const s = atNight2(['imp', 'mayor', 'soldier', 'monk', 'washerwoman']);
  playNight(s, { monk: ['washerwoman'], imp: ['mayor'] });
  // Candidates: Monk (unprotected) only — the Soldier is immune and the Washerwoman is protected.
  assert.equal(byChar(s, 'monk').alive, false);
  assert.equal(byChar(s, 'mayor').alive, true);
  assert.equal(byChar(s, 'washerwoman').alive, true);
});

test('Imp attack — a Mayor with nobody to bounce to dies themselves', () => {
  const s = atNight2(['imp', 'mayor', 'soldier', 'washerwoman', 'empath']);
  const [, , , washerwoman, empath] = s.players;
  washerwoman.alive = false;
  empath.alive = false;
  playNight(s, { imp: ['mayor'] });
  assert.equal(byChar(s, 'mayor').alive, false);
});

test('Imp attack — a Mayor bounce that hits the Ravenkeeper wakes them', () => {
  const s = atNight2(['imp', 'mayor', 'soldier', 'ravenkeeper']);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'mayor').id]);
  assert.equal(byChar(s, 'ravenkeeper').alive, false);
  assert.equal(s.pendingRealTurn?.charId, 'ravenkeeper');
});

test('Imp attack — a dead target: nothing happens, nobody is reported dead', () => {
  const s = atNight2();
  byChar(s, 'washerwoman').alive = false;
  playNight(s, { imp: ['washerwoman'] });
  assert.deepEqual(s.deathsTonight, []);
  assert.equal(s.publicLog.at(-1)!.key, 'nobodyDiedLastNight');
});

test('Imp attack — the star-pass with a Minion alive: the Imp dies and the Minion becomes the Imp, who is told', () => {
  const s = atNight2();
  playNight(s, { monk: ['empath'], imp: ['imp'] }); // (a skipped Monk would protect the first player: the Imp)
  const poisoner = s.players.find((p) => p.name === s.players[1].name)!;
  assert.equal(s.players.filter((p) => p.character === 'imp' && p.alive).length, 1);
  assert.equal(poisoner.character, 'imp');
  assert.equal(poisoner.perceived, 'imp');
  assert.equal(s.players[0].alive, false, 'the old Imp is dead');
  assert.ok(poisoner.log.some((e) => e.msg.key === 'becameImp'));
  assert.ok(poisoner.log.some((e) => e.msg.key === 'demonInfo'));
  assert.equal(s.winner, null);
});

test('Imp attack — after a star-pass the new Imp really acts as the Imp the next night', () => {
  const s = atNight2(['imp', 'poisoner', 'monk', 'soldier', 'washerwoman', 'empath', 'chef']);
  playNight(s, { monk: ['empath'], imp: ['imp'] });
  const newImp = s.players.find((p) => p.character === 'imp' && p.alive)!;
  assert.notEqual(newImp.name, s.players[0].name);
  endDayByConsensus(s);
  assert.equal(s.phase, 'night');
  advanceUntil(s, 'imp');
  assert.deepEqual(s.pendingRealTurn!.playerIds, [newImp.id]);
});

test('Imp attack — killing the Poisoner ends their poison at once, so a later step that night is healthy', () => {
  const s = atNight2();
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [byChar(s, 'empath').id]);
  assert.equal(abilityWorks(s, byChar(s, 'empath')), false, 'poisoned while the Poisoner lives');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'poisoner').id]);
  assert.equal(abilityWorks(s, byChar(s, 'empath')), true, 'healthy again the moment the Poisoner dies');
});

test('Imp attack — the Saint dying at night does NOT lose the game (only execution does)', () => {
  const s = atNight2(['imp', 'saint', 'poisoner', 'washerwoman', 'empath']);
  playNight(s, { imp: ['saint'] });
  assert.equal(byChar(s, 'saint').alive, false);
  assert.equal(s.winner, null);
});

// ---------------------------------------------------------------- Drunk

test('a Drunk who believes they are the Monk wakes as the Monk, but protects nobody', () => {
  const s = atNight2(['imp', 'poisoner', 'drunk', 'soldier', 'washerwoman', 'empath', 'chef', 'mayor'], { drunkFakeChar: 'monk' });
  startNight(s);
  advanceUntil(s, 'monk');
  assert.deepEqual(s.pendingRealTurn!.playerIds, [byChar(s, 'drunk').id]);
  answerRealTurn(s, [byChar(s, 'washerwoman').id]);
  assert.equal(s.monkProtectedId, null);
});

test('a Drunk who believes they are the Poisoner (impossible in the real deal, but the rule holds) poisons nobody', () => {
  const s = atNight2(['imp', 'drunk', 'soldier', 'washerwoman', 'empath', 'chef', 'mayor', 'monk'], { drunkFakeChar: 'poisoner' });
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [byChar(s, 'soldier').id]);
  assert.equal(s.poisonedId, null);
});

// ---------------------------------------------------------------- poison lifetime

test('poison lasts through the next day, then the Poisoner\'s new choice replaces it', () => {
  const s = atNight2(['imp', 'poisoner', 'slayer', 'soldier', 'washerwoman', 'empath', 'chef']);
  playNight(s, { poisoner: ['slayer'], imp: ['soldier'] });
  const slayer = byChar(s, 'slayer');
  assert.equal(abilityWorks(s, slayer), false, 'still poisoned during the day');
  endDayByConsensus(s);
  playNightFromHere(s, { poisoner: ['washerwoman'], imp: ['soldier'] });
  assert.equal(abilityWorks(s, slayer), true, 'the old poison is gone');
  assert.equal(abilityWorks(s, byChar(s, 'washerwoman')), false);
});

/** Continues with the night that endDay already started. */
function playNightFromHere(s: GameState, picks: Picks): void {
  let guard = 0;
  while (s.pendingRealTurn && guard++ < 40) {
    const t = s.pendingRealTurn;
    const p = picks[t.charId];
    if (p) answerRealTurn(s, p.map((c) => byChar(s, c).id));
    else skipRound(s);
  }
  breakDawn(s);
}

test('a poisoned Slayer\'s shot fails during the day, and the shot is still spent', () => {
  const s = atNight2(['imp', 'poisoner', 'slayer', 'soldier', 'washerwoman', 'empath', 'chef']);
  playNight(s, { poisoner: ['slayer'], imp: ['soldier'] });
  useSlayer(s, byChar(s, 'slayer').id, byChar(s, 'imp').id);
  assert.equal(byChar(s, 'imp').alive, true);
  assert.equal(byChar(s, 'slayer').slayerUsed, true);
});

test('when the Poisoner dies during the day, everyone they poisoned is healthy at once', () => {
  const s = atNight2(['imp', 'poisoner', 'slayer', 'soldier', 'washerwoman', 'empath', 'chef']);
  playNight(s, { poisoner: ['slayer'], imp: ['soldier'] });
  byChar(s, 'poisoner').alive = false;
  assert.equal(abilityWorks(s, byChar(s, 'slayer')), true);
});

test('a Poisoner may poison themselves, and then their own information is unreliable too', () => {
  const s = atNight2();
  playNight(s, { poisoner: ['poisoner'], imp: ['soldier'] });
  assert.equal(s.poisonedId, byChar(s, 'poisoner').id);
  assert.equal(abilityWorks(s, byChar(s, 'poisoner')), false, 'a Poisoner who poisoned themselves is poisoned');
});

// ---------------------------------------------------------------- Monk

test('the Monk\'s protection lasts one night only', () => {
  const s = atNight2(['imp', 'monk', 'washerwoman', 'empath', 'chef', 'soldier', 'mayor']);
  playNight(s, { monk: ['washerwoman'], imp: ['washerwoman'] });
  assert.equal(byChar(s, 'washerwoman').alive, true);
  endDayByConsensus(s);
  playNightFromHere(s, { monk: ['empath'], imp: ['washerwoman'] });
  assert.equal(byChar(s, 'washerwoman').alive, false, 'protected last night, not tonight');
});

test('the Monk may protect a dead player or the Imp, but never themselves', () => {
  const s = atNight2(['imp', 'monk', 'washerwoman', 'empath', 'chef', 'soldier', 'mayor']);
  byChar(s, 'chef').alive = false;
  startNight(s);
  advanceUntil(s, 'monk');
  assert.throws(() => answerRealTurn(s, [byChar(s, 'monk').id]), /yourself/);
  answerRealTurn(s, [byChar(s, 'chef').id]);
  assert.equal(s.monkProtectedId, byChar(s, 'chef').id);
});

// ---------------------------------------------------------------- Ravenkeeper

test('the Ravenkeeper is woken only if the Demon killed them — not when executed', () => {
  const s = atNight2(['imp', 'ravenkeeper', 'poisoner', 'soldier', 'washerwoman', 'empath', 'chef']);
  const rk = byChar(s, 'ravenkeeper');
  nominate(s, byChar(s, 'empath').id, rk.id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id));
  endDayByConsensus(s);
  assert.equal(rk.alive, false);
  const steps: string[] = [];
  while (s.pendingRealTurn) {
    steps.push(s.pendingRealTurn.charId);
    skipRound(s);
  }
  assert.ok(!steps.includes('ravenkeeper'));
});

test('a poisoned Ravenkeeper is woken all the same and told a (possibly false) character', () => {
  const s = atNight2(['imp', 'ravenkeeper', 'poisoner', 'soldier', 'washerwoman', 'empath', 'chef']);
  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [byChar(s, 'ravenkeeper').id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'ravenkeeper').id]);
  advanceUntil(s, 'ravenkeeper');
  answerRealTurn(s, [byChar(s, 'imp').id]);
  assert.equal(byChar(s, 'ravenkeeper').nightResult?.key, 'ravenkeeperInfo');
});

test('the Ravenkeeper picking themselves learns their own character', () => {
  const s = atNight2(['imp', 'ravenkeeper', 'soldier', 'washerwoman', 'empath']);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'ravenkeeper').id]);
  advanceUntil(s, 'ravenkeeper');
  answerRealTurn(s, [byChar(s, 'ravenkeeper').id]);
  assert.equal(byChar(s, 'ravenkeeper').nightResult?.vars?.role, 'ravenkeeper');
});

// ---------------------------------------------------------------- Undertaker

test('Undertaker: learns each day\'s executed character the next night, and "nobody" after a quiet day', () => {
  const s = atNight2(['imp', 'undertaker', 'poisoner', 'soldier', 'washerwoman', 'empath', 'chef']);
  const under = byChar(s, 'undertaker');
  const chef = byChar(s, 'chef');
  playNight(s, { imp: ['soldier'] });
  nominate(s, byChar(s, 'empath').id, chef.id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id));
  endDayByConsensus(s);
  playNightFromHere(s, { imp: ['soldier'] });
  assert.equal(under.log.at(-1)!.msg.vars!.role, 'chef', 'the executed Chef');
  endDayByConsensus(s); // a quiet day
  playNightFromHere(s, { imp: ['soldier'] });
  assert.equal(under.log.at(-1)!.msg.key, 'undertakerNone');
});

test('Undertaker: is not told about a NIGHT death, only an execution', () => {
  const s = atNight2(['imp', 'undertaker', 'poisoner', 'soldier', 'washerwoman', 'empath', 'chef']);
  playNight(s, { imp: ['washerwoman'] });
  endDayByConsensus(s);
  playNightFromHere(s, { imp: ['soldier'] });
  assert.equal(byChar(s, 'undertaker').log.at(-1)!.msg.key, 'undertakerNone');
});

// ---------------------------------------------------------------- Butler

/**
 * 6 players, so 3 votes are needed. The Butler, the nominator and the Soldier vote yes (3 = enough
 * if the Butler counts); the Master (Empath) adds a 4th. If the Butler is restricted and their
 * Master did not vote, the Butler's vote is dropped and only 2 remain — so the outcome shows
 * exactly whether the restriction applied.
 */
function butlerDay(masterVotes: boolean, opts: { butlerDead?: boolean; poisoned?: boolean; drunk?: boolean; masterDead?: boolean } = {}): GameState {
  const s = opts.drunk
    ? atNight2(['imp', 'drunk', 'poisoner', 'soldier', 'washerwoman', 'empath'], { drunkFakeChar: 'butler' })
    : atNight2(['imp', 'butler', 'poisoner', 'soldier', 'washerwoman', 'empath']);
  playNight(s, { butler: ['empath'], poisoner: [opts.poisoned ? 'butler' : 'poisoner'], imp: ['soldier'] } as Picks);
  const butler = opts.drunk ? byChar(s, 'drunk') : byChar(s, 'butler');
  const master = byChar(s, 'empath');
  if (opts.masterDead) master.alive = false;
  if (opts.butlerDead) butler.alive = false;
  const nominator = byChar(s, 'washerwoman');
  nominate(s, nominator.id, byChar(s, 'poisoner').id);
  fastForwardToVote(s);
  const yes = [butler.id, nominator.id, byChar(s, 'soldier').id];
  if (masterVotes) yes.push(master.id);
  voteInOrder(s, yes);
  return s;
}

test('Butler: their yes only counts if their Master also voted yes', () => {
  assert.equal(butlerDay(false).onBlockId, null, 'the Butler\'s vote is dropped: only 2 of the 3 needed');
  const withMaster = butlerDay(true);
  assert.equal(withMaster.onBlockId, byChar(withMaster, 'poisoner').id, 'with the Master\'s vote all 4 count');
});

test('Butler: a poisoned Butler is not restricted', () => {
  const s = butlerDay(false, { poisoned: true });
  assert.equal(s.onBlockId, byChar(s, 'poisoner').id);
});

test('Butler: a Drunk who thinks they are the Butler is not restricted either', () => {
  const s = butlerDay(false, { drunk: true });
  assert.equal(s.onBlockId, byChar(s, 'poisoner').id);
});

test('Butler: a DEAD Butler\'s ghost vote is not restricted', () => {
  const s = butlerDay(false, { butlerDead: true });
  assert.equal(s.onBlockId, byChar(s, 'poisoner').id);
});

test('Butler: a dead Master who cast a ghost vote yes still counts as having voted', () => {
  const s = butlerDay(true, { masterDead: true });
  assert.equal(s.onBlockId, byChar(s, 'poisoner').id);
});

test('Butler: the Master is chosen fresh every night — last night\'s Master no longer binds', () => {
  const s = atNight2(['imp', 'butler', 'poisoner', 'soldier', 'washerwoman', 'empath', 'chef']);
  playNight(s, { butler: ['empath'], imp: ['soldier'] });
  assert.equal(s.butlerMasterId, byChar(s, 'empath').id);
  endDayByConsensus(s);
  playNightFromHere(s, { butler: ['chef'], imp: ['soldier'] });
  assert.equal(s.butlerMasterId, byChar(s, 'chef').id);
});

test('Butler: with no Master chosen (the Butler was poisoned when choosing), their yes votes are unrestricted; a working Butler with none set never counts', () => {
  const s = atNight2(['imp', 'butler', 'poisoner', 'soldier', 'washerwoman', 'empath']);
  s.phase = 'day';
  s.butlerMasterId = null; // a healthy Butler somehow without a Master: their vote can never be confirmed
  const nominator = byChar(s, 'washerwoman');
  nominate(s, nominator.id, byChar(s, 'poisoner').id);
  fastForwardToVote(s);
  voteInOrder(s, [byChar(s, 'butler').id, byChar(s, 'soldier').id, nominator.id]);
  assert.equal(s.onBlockId, null, 'only 2 of the 3 needed count');
});

// ---------------------------------------------------------------- Scarlet Woman

test('Scarlet Woman: promoted by an execution of the Demon with 5+ alive, and then acts as the Imp next night', () => {
  const s = atNight2(['imp', 'scarletwoman', 'poisoner', 'soldier', 'washerwoman', 'empath', 'chef']);
  playNight(s, { imp: ['soldier'] });
  nominate(s, byChar(s, 'empath').id, byChar(s, 'imp').id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id));
  endDayByConsensus(s);
  const sw = s.players.find((p) => p.character === 'imp' && p.alive)!;
  assert.equal(sw.name, s.players[1].name, 'the Scarlet Woman is now the Imp');
  assert.equal(s.winner, null);
  advanceUntil(s, 'imp');
  assert.deepEqual(s.pendingRealTurn!.playerIds, [sw.id]);
  assert.ok(sw.log.some((e) => e.msg.key === 'scarletWomanPromoted'));
});

test('Scarlet Woman: a Slayer kill with fewer than 5 alive ends the game for good', () => {
  const s = atNight2(['imp', 'scarletwoman', 'slayer', 'soldier', 'washerwoman']);
  playNight(s, { imp: ['soldier'] });
  byChar(s, 'washerwoman').alive = false;
  byChar(s, 'soldier').alive = false;
  useSlayer(s, byChar(s, 'slayer').id, byChar(s, 'imp').id);
  assert.equal(s.winner, 'good');
});

// ---------------------------------------------------------------- Mayor

for (const [alive, executed, expected] of [[3, false, 'good'], [4, false, null], [3, true, null], [5, false, null]] as const) {
  test(`Mayor: ${alive} alive and ${executed ? 'an' : 'no'} execution → ${expected ?? 'the game goes on'}`, () => {
    const chars: CharacterId[] = ['imp', 'mayor', 'washerwoman', 'empath', 'soldier'].slice(0, alive) as CharacterId[];
    const s = mk(chars);
    s.phase = 'day';
    s.day = 1;
    s.night = 1;
    if (executed) {
      s.onBlockId = s.players[2].id;
      endDayByConsensus(s);
      assert.notEqual(s.winner, 'good');
    } else {
      endDayByConsensus(s);
      assert.equal(s.winner, expected);
    }
  });
}

test('Mayor: a dead Mayor does not win it', () => {
  const s = mk(['imp', 'mayor', 'poisoner', 'empath']);
  s.phase = 'day';
  s.day = 1;
  s.night = 1;
  byChar(s, 'mayor').alive = false; // 3 alive: imp, poisoner, empath
  endDayByConsensus(s);
  assert.notEqual(s.winner, 'good');
});

test('Mayor: a poisoned Mayor does not win it', () => {
  const s = mk(['imp', 'mayor', 'poisoner', 'empath']);
  s.phase = 'day';
  s.day = 1;
  s.night = 1;
  byChar(s, 'empath').alive = false; // 3 alive: imp, mayor, poisoner
  s.poisonedId = byChar(s, 'mayor').id;
  endDayByConsensus(s);
  assert.notEqual(s.winner, 'good');
});

void viewFor;
void ([] as PlayerState[]);
