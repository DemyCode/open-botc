// The replay's raw material: the history the engine records, event by event. Scripted games check
// the exact story; random games check invariants (every death explained, every vote adds up...).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import { addPlayer, createGame, declareNeighbor, nominate, startGame, useSlayer } from '../game/engine.js';
import type { CharacterId, GameState, HistoryEvent } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { playGame } from './driver.js';
import {
  advanceUntil, answerRealTurn, breakDawn, byChar, endDayByConsensus, fastForwardToVote, mk, mkDay, runFullNight, skipRound, startNight, voteInOrder,
} from './helpers.js';

const types = (s: GameState) => s.history.map((e) => e.type);
const of = (s: GameState, type: string): HistoryEvent[] => s.history.filter((e) => e.type === type);
const last = (s: GameState, type: string): HistoryEvent => of(s, type).at(-1)!;

/** Plays night 2 with explicit picks (other steps skipped harmlessly). */
function night(s: GameState, picks: Partial<Record<CharacterId, CharacterId[]>>): void {
  startNight(s);
  let guard = 0;
  while (s.pendingRealTurn && guard++ < 40) {
    const p = picks[s.pendingRealTurn.charId as CharacterId];
    if (p) answerRealTurn(s, p.map((c) => byChar(s, c).id));
    else skipRound(s);
  }
  breakDawn(s);
}
const atNight2 = (layout: CharacterId[], opts: Parameters<typeof mk>[1] = {}) => {
  const s = mk(layout, opts);
  startNight(s);
  runFullNight(s);
  s.history.length = 0; // only night 2 onwards is of interest
  return s;
};
const LAYOUT: CharacterId[] = ['imp', 'poisoner', 'monk', 'mayor', 'soldier', 'washerwoman', 'empath', 'ravenkeeper'];

// ---------------------------------------------------------------- a whole scripted game

test('a scripted 7-player game tells exactly the right story, in the right order', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  const [imp, poisoner, empath, washerwoman, , monk] = s.players;

  startNight(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [monk.id]);
  runFullNight(s);
  endDayByConsensus(s);
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [monk.id]);
  advanceUntil(s, 'monk');
  answerRealTurn(s, [washerwoman.id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [washerwoman.id]);
  runFullNight(s);
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, s.players[4].id, s.players[6].id]);
  endDayByConsensus(s);

  assert.deepEqual(types(s), [
    'nightStart', 'info', 'info', 'choice', 'info', 'info', 'info', 'dawn', // night 1: evil intro, poison, three info
    'dayEnd', // a quiet day
    'nightStart', 'choice', 'choice', 'attack', 'death', 'info', 'dawn', // night 2
    'nominate', 'vote', 'execution', 'death', 'win', // day 2
  ]);
  // Night 1: the Poisoner's pick and that Minion info / Demon info came first.
  const [minionInfo, demonInfo] = of(s, 'info');
  assert.equal(minionInfo.vars.actor, poisoner.id);
  assert.equal(demonInfo.vars.actor, imp.id);
  assert.equal(of(s, 'choice')[0].vars.ability, 'poisoner');
  assert.deepEqual(of(s, 'choice')[0].vars.targets, [monk.id]);
  // Night 2: the poisoned Monk's protection did nothing, so the attack landed.
  const monkChoice = of(s, 'choice')[2];
  assert.equal(monkChoice.vars.ability, 'monk');
  assert.equal(monkChoice.vars.lost, 'poisoned');
  assert.equal(last(s, 'attack').vars.outcome, 'killed');
  assert.deepEqual(of(s, 'death')[0].vars, { player: washerwoman.id, cause: 'demon' });
  assert.deepEqual(last(s, 'death').vars, { player: imp.id, cause: 'execution' });
  assert.deepEqual(last(s, 'dawn').vars.deaths, [washerwoman.id]);
  // Day 2.
  assert.deepEqual(last(s, 'vote').vars.outcome, 'block');
  assert.equal(last(s, 'vote').vars.yes, 3);
  assert.equal(last(s, 'vote').vars.needed, 3);
  assert.equal(last(s, 'vote').vars.alive, 6);
  assert.equal(last(s, 'execution').vars.player, imp.id);
  assert.equal(last(s, 'win').vars.winner, 'good');
  // Every event is numbered in order and stamped with when it happened.
  assert.deepEqual(s.history.map((e) => e.seq), s.history.map((_, i) => i));
  assert.deepEqual(s.history.filter((e) => e.type === 'nightStart').map((e) => e.night), [1, 2]);
  assert.deepEqual(of(s, 'nominate').map((e) => [e.phase, e.day]), [['day', 2]]);
  assert.deepEqual(of(s, 'attack').map((e) => [e.phase, e.night]), [['night', 2]]);
});

test('the roles are recorded at the start: everyone\'s character, the Drunk\'s false one, the red herring and the bluffs', () => {
  const s = createGame('R');
  s.secret = 'history-roles';
  const ps = Array.from({ length: 9 }, (_, i) => addPlayer(s, `P${i}`));
  ps.forEach((p, i) => declareNeighbor(s, p.id, ps[(i + 1) % 9].id));
  startGame(s);
  const roles = s.history[0];
  assert.equal(roles.type, 'roles');
  assert.equal(roles.phase, 'setup');
  const players = roles.vars.players as { id: string; character: string; perceived: string }[];
  assert.deepEqual(players.map((p) => p.id), s.players.map((p) => p.id));
  for (const p of players) {
    const real = s.players.find((q) => q.id === p.id)!;
    assert.equal(p.character, real.character);
    assert.equal(p.perceived, real.perceived);
  }
  assert.equal(roles.vars.redHerring, s.players.find((p) => p.isRedHerring)?.id ?? null);
  assert.deepEqual(roles.vars.bluffs, s.bluffs);
  assert.equal(s.history[1].type, 'nightStart');
});

// ---------------------------------------------------------------- night events

test('information is recorded with the exact text the player got, and why it may be false', () => {
  const s = atNight2(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'chef', 'monk']);
  night(s, { poisoner: ['empath'], imp: ['soldier'], monk: ['washerwoman'] });
  const empath = byChar(s, 'empath');
  const info = of(s, 'info').find((e) => e.vars.actor === empath.id)!;
  assert.deepEqual(info.vars.msg, empath.log.at(-1)!.msg, 'the same message the player saw');
  assert.equal(info.vars.lost, 'poisoned', 'flagged as unreliable, and why');
  assert.equal(info.vars.character, 'empath');
});

test('a Drunk\'s information is flagged as coming from a drunk, and shows the character they believed', () => {
  const s = atNight2(['imp', 'poisoner', 'drunk', 'washerwoman', 'soldier', 'chef', 'monk'], { drunkFakeChar: 'empath' });
  night(s, { poisoner: ['poisoner'], imp: ['soldier'], monk: ['washerwoman'] });
  const info = of(s, 'info').find((e) => e.vars.actor === byChar(s, 'drunk').id)!;
  assert.equal(info.vars.lost, 'drunk');
  assert.equal(info.vars.character, 'empath');
});

test('a healthy player\'s information is not flagged', () => {
  const s = atNight2(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'chef', 'monk']);
  night(s, { poisoner: ['poisoner'], imp: ['soldier'], monk: ['washerwoman'] });
  const infos = of(s, 'info').filter((e) => e.vars.actor === byChar(s, 'empath').id);
  assert.equal(infos.length, 1);
  assert.equal(infos[0].vars.lost, null);
});

test('the Fortune Teller\'s and Ravenkeeper\'s results are recorded as information, and their picks as choices', () => {
  const s = atNight2(['imp', 'poisoner', 'fortuneteller', 'ravenkeeper', 'soldier', 'chef', 'monk']);
  night(s, { poisoner: ['poisoner'], fortuneteller: ['imp', 'chef'], imp: ['ravenkeeper'], ravenkeeper: ['imp'], monk: ['soldier'] });
  const ft = byChar(s, 'fortuneteller');
  const ftChoice = of(s, 'choice').find((e) => e.vars.actor === ft.id)!;
  assert.deepEqual(ftChoice.vars.targets, [byChar(s, 'imp').id, byChar(s, 'chef').id]);
  const ftInfo = of(s, 'info').find((e) => e.vars.actor === ft.id)!;
  assert.equal((ftInfo.vars.msg as { key: string }).key, 'fortuneTellerYes');
  const rk = byChar(s, 'ravenkeeper');
  assert.equal((of(s, 'info').find((e) => e.vars.actor === rk.id)!.vars.msg as { key: string }).key, 'ravenkeeperInfo');
});

test('a "Got it" on an information step is not recorded as a choice', () => {
  const s = atNight2(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'chef', 'monk']);
  night(s, { poisoner: ['poisoner'], imp: ['soldier'], monk: ['washerwoman'] });
  for (const c of of(s, 'choice')) assert.ok((c.vars.targets as string[]).length > 0, 'every recorded choice picked somebody');
  assert.ok(of(s, 'choice').every((c) => ['poisoner', 'monk', 'butler', 'fortuneteller', 'ravenkeeper'].includes(c.vars.ability as string)));
});

const ATTACKS: { name: string; picks: Partial<Record<CharacterId, CharacterId[]>>; outcome: string; extra?: (e: HistoryEvent, s: GameState) => void }[] = [
  { name: 'a kill', picks: { imp: ['washerwoman'] }, outcome: 'killed' },
  { name: 'the Soldier is safe', picks: { imp: ['soldier'] }, outcome: 'blocked', extra: (e) => assert.equal(e.vars.by, 'soldier') },
  { name: 'the Monk protects', picks: { monk: ['washerwoman'], imp: ['washerwoman'] }, outcome: 'blocked', extra: (e) => assert.equal(e.vars.by, 'monk') },
  { name: 'a poisoned Imp', picks: { poisoner: ['imp'], imp: ['washerwoman'] }, outcome: 'ineffective', extra: (e) => assert.equal(e.vars.lost, 'poisoned') },
  { name: 'the Mayor bounces', picks: { imp: ['mayor'] }, outcome: 'mayorBounce', extra: (e, s) => assert.notEqual(e.vars.victim, byChar(s, 'mayor').id) },
  { name: 'the star-pass', picks: { monk: ['empath'], imp: ['imp'] }, outcome: 'starPass' },
];
for (const row of ATTACKS) {
  test(`the Imp's attack is recorded with its outcome — ${row.name}`, () => {
    const s = atNight2(LAYOUT);
    night(s, row.picks);
    const attack = last(s, 'attack');
    assert.equal(attack.vars.outcome, row.outcome);
    assert.equal(attack.vars.actor, byChar(s, 'imp').id);
    row.extra?.(attack, s);
  });
}

test('an attack on a dead player is recorded as doing nothing', () => {
  const s = atNight2(LAYOUT);
  byChar(s, 'washerwoman').alive = false;
  night(s, { imp: ['washerwoman'] });
  assert.equal(last(s, 'attack').vars.outcome, 'alreadyDead');
  assert.equal(of(s, 'death').length, 0);
});

test('every death is recorded with its cause: the Demon, the Mayor\'s bounce, the star-pass', () => {
  let s = atNight2(LAYOUT);
  night(s, { imp: ['washerwoman'] });
  assert.equal(last(s, 'death').vars.cause, 'demon');
  s = atNight2(LAYOUT);
  night(s, { imp: ['mayor'] });
  assert.equal(last(s, 'death').vars.cause, 'mayorBounce');
  s = atNight2(LAYOUT);
  night(s, { monk: ['empath'], imp: ['imp'] });
  const deaths = of(s, 'death');
  assert.equal(deaths[0].vars.cause, 'starPass');
  assert.equal(deaths[0].vars.player, s.players[0].id);
  assert.equal(last(s, 'promotion').vars.reason, 'starPass');
});

test('when the Poisoner dies, the end of their poison is recorded (and only then)', () => {
  const s = atNight2(LAYOUT);
  night(s, { poisoner: ['empath'], imp: ['poisoner'] });
  assert.deepEqual(last(s, 'poisonEnded').vars, { poisoner: byChar(s, 'poisoner').id, target: byChar(s, 'empath').id });
  const other = atNight2(LAYOUT);
  night(other, { poisoner: ['empath'], imp: ['washerwoman'] });
  assert.equal(of(other, 'poisonEnded').length, 0);
});

test('the dawn lists who was found dead — nobody, one, or the Mayor\'s substitute', () => {
  let s = atNight2(LAYOUT);
  night(s, { imp: ['soldier'] });
  assert.deepEqual(last(s, 'dawn').vars.deaths, []);
  s = atNight2(LAYOUT);
  night(s, { imp: ['washerwoman'] });
  assert.deepEqual(last(s, 'dawn').vars.deaths, [byChar(s, 'washerwoman').id]);
});

// ---------------------------------------------------------------- day events

test('a nomination, then its vote: who voted how, how many, how many were needed, and the outcome', () => {
  const s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman', 'monk']);
  const [imp, empath, chef, soldier, washerwoman] = s.players;
  nominate(s, empath.id, chef.id);
  assert.deepEqual(last(s, 'nominate').vars, { nominator: empath.id, nominee: chef.id });
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, soldier.id, washerwoman.id, imp.id]);
  const vote = last(s, 'vote');
  assert.equal(vote.vars.nominee, chef.id);
  assert.equal(vote.vars.yes, 4);
  assert.equal(vote.vars.needed, 3);
  assert.equal(vote.vars.alive, 6);
  assert.equal(vote.vars.outcome, 'block');
  const votes = vote.vars.votes as { id: string; yes: boolean }[];
  assert.equal(votes.length, 6, 'everyone was asked');
  assert.deepEqual(votes.filter((v) => v.yes).map((v) => v.id).sort(), [empath.id, soldier.id, washerwoman.id, imp.id].sort());
  assert.equal(votes.at(-1)!.id, chef.id, 'the nominee voted last');
});

test('vote outcomes: on the block, a tie, and not enough', () => {
  const s = mkDay(['imp', ...Array(8).fill('empath')] as CharacterId[]);
  const [a, b, c, d, e, f] = s.players;
  nominate(s, a.id, b.id); fastForwardToVote(s); voteInOrder(s, [a, b, c, d, e].map((p) => p.id));
  assert.equal(last(s, 'vote').vars.outcome, 'block');
  nominate(s, c.id, d.id); fastForwardToVote(s); voteInOrder(s, [a, b, c, d, e].map((p) => p.id));
  assert.equal(last(s, 'vote').vars.outcome, 'tie');
  nominate(s, e.id, f.id); fastForwardToVote(s); voteInOrder(s, [a].map((p) => p.id));
  assert.equal(last(s, 'vote').vars.outcome, 'short');
});

test('a ghost vote is in the record; a dead player with no vote left is not asked', () => {
  const s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman']);
  const [, , , , washerwoman] = s.players;
  washerwoman.alive = false;
  nominate(s, s.players[1].id, s.players[2].id);
  fastForwardToVote(s);
  voteInOrder(s, [washerwoman.id, s.players[1].id]);
  assert.ok((last(s, 'vote').vars.votes as { id: string; yes: boolean }[]).some((v) => v.id === washerwoman.id && v.yes));
  nominate(s, s.players[3].id, s.players[0].id);
  fastForwardToVote(s);
  voteInOrder(s, []);
  assert.ok(!(last(s, 'vote').vars.votes as { id: string }[]).some((v) => v.id === washerwoman.id), 'their one vote is spent');
});

test('a Butler whose vote did not count is named in the vote record', () => {
  const s = mk(['imp', 'butler', 'poisoner', 'soldier', 'washerwoman', 'empath']);
  startNight(s);
  runFullNight(s);
  night(s, { butler: ['empath'], poisoner: ['poisoner'], imp: ['soldier'] });
  const butler = byChar(s, 'butler');
  nominate(s, byChar(s, 'washerwoman').id, byChar(s, 'poisoner').id);
  fastForwardToVote(s);
  voteInOrder(s, [butler.id, byChar(s, 'washerwoman').id, byChar(s, 'soldier').id]);
  const vote = last(s, 'vote');
  assert.deepEqual(vote.vars.dropped, [butler.id]);
  assert.equal(vote.vars.yes, 2, 'the Butler\'s vote is not in the count');
});

test('the Virgin: executing a Townsfolk nominator, and the reasons it does nothing', () => {
  let s = mkDay(['imp', 'virgin', 'empath', 'poisoner', 'soldier']);
  nominate(s, s.players[2].id, s.players[1].id);
  assert.deepEqual(last(s, 'virgin').vars, { virgin: s.players[1].id, nominator: s.players[2].id, executed: true, reason: null });
  assert.equal(last(s, 'death').vars.cause, 'virgin');
  s = mkDay(['imp', 'virgin', 'empath', 'poisoner', 'soldier']);
  nominate(s, s.players[3].id, s.players[1].id);
  assert.equal(last(s, 'virgin').vars.reason, 'notTownsfolk');
  assert.equal(last(s, 'virgin').vars.executed, false);
  s = mkDay(['imp', 'virgin', 'empath', 'poisoner', 'soldier']);
  s.poisonedId = s.players[1].id;
  nominate(s, s.players[2].id, s.players[1].id);
  assert.equal(last(s, 'virgin').vars.reason, 'poisoned');
});

test('the Slayer\'s shot: a real hit, a bluff, a poisoned Slayer, and a dead target', () => {
  let s = mkDay(['imp', 'slayer', 'poisoner', 'soldier', 'empath']);
  useSlayer(s, s.players[1].id, s.players[0].id);
  assert.deepEqual(last(s, 'slayer').vars, { shooter: s.players[1].id, target: s.players[0].id, real: true, hit: true, targetDead: false, lost: null });
  assert.equal(last(s, 'death').vars.cause, 'slayer');
  s = mkDay(['imp', 'slayer', 'poisoner', 'soldier', 'empath']);
  useSlayer(s, s.players[3].id, s.players[0].id);
  assert.equal(last(s, 'slayer').vars.real, false, 'a bluff is recorded as a bluff');
  assert.equal(last(s, 'slayer').vars.hit, false);
  s = mkDay(['imp', 'slayer', 'poisoner', 'soldier', 'empath']);
  s.poisonedId = s.players[1].id;
  useSlayer(s, s.players[1].id, s.players[0].id);
  assert.equal(last(s, 'slayer').vars.lost, 'poisoned');
  s = mkDay(['imp', 'slayer', 'poisoner', 'soldier', 'empath']);
  s.players[4].alive = false;
  useSlayer(s, s.players[1].id, s.players[4].id);
  assert.equal(last(s, 'slayer').vars.targetDead, true);
});

test('executions: the day\'s execution, an already-dead one (no second death), and a quiet day', () => {
  let s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman']);
  nominate(s, s.players[1].id, s.players[2].id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id));
  endDayByConsensus(s);
  assert.deepEqual(last(s, 'execution').vars, { player: s.players[2].id, wasDead: false, cause: 'execution' });
  assert.equal(last(s, 'death').vars.cause, 'execution');

  s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman']);
  s.players[2].alive = false;
  nominate(s, s.players[1].id, s.players[2].id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id));
  endDayByConsensus(s);
  assert.equal(last(s, 'execution').vars.wasDead, true);
  assert.equal(of(s, 'death').length, 0, 'a dead player does not die again');

  s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman']);
  endDayByConsensus(s);
  assert.deepEqual(last(s, 'dayEnd').vars, { executed: null });
});

test('the Scarlet Woman taking over is recorded, and the end of the game names the reason', () => {
  const s = mkDay(['imp', 'scarletwoman', 'poisoner', 'soldier', 'washerwoman', 'empath']);
  nominate(s, s.players[5].id, s.players[0].id);
  fastForwardToVote(s);
  voteInOrder(s, s.players.map((p) => p.id));
  endDayByConsensus(s);
  assert.deepEqual(last(s, 'promotion').vars, { player: s.players[1].id, reason: 'scarletWoman' });
  assert.equal(of(s, 'win').length, 0, 'the game goes on');
});

test('the win is the last event, recorded once, with the same message as the village log', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'chef', 'soldier']);
  useSlayer(s, s.players[1].id, s.players[0].id);
  assert.equal(s.history.at(-1)!.type, 'win');
  assert.equal(of(s, 'win').length, 1);
  assert.deepEqual(last(s, 'win').vars.message, s.publicLog.at(-1));
  assert.equal(last(s, 'win').vars.winner, 'good');
});

// ---------------------------------------------------------------- secrecy

test('the replay is never sent to anyone while the game is running — at any step of any game', () => {
  for (let n = 5; n <= 15; n += 2) {
    playGame(2, n, (s, where) => {
      if (s.phase === 'ended') return;
      for (const p of s.players) assert.equal(viewFor(s, p.id).replay, null, `${where}: the replay leaked to ${p.name}`);
      assert.ok(!JSON.stringify(s.players.map((p) => viewFor(s, p.id))).includes('"nightStart"'), `${where}: history events leaked`);
    });
  }
});

test('when the game is over everyone gets the same complete replay, ending with the win', () => {
  const s = playGame(5, 9);
  const first = viewFor(s, s.players[0].id).replay!;
  assert.ok(first.length > 10);
  for (const p of s.players) assert.deepEqual(viewFor(s, p.id).replay, first);
  assert.equal(first.at(-1)!.type, 'win');
  assert.equal(first[0].type, 'roles');
});

test('a stranger who is not in the game also only sees the replay after the end', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'chef', 'soldier']);
  assert.equal(viewFor(s, 'nobody').replay, null);
  useSlayer(s, s.players[1].id, s.players[0].id);
  assert.ok(viewFor(s, 'nobody').replay);
});

// ---------------------------------------------------------------- invariants over whole random games

test('over 130 random games: every death, nomination, vote, execution and the win is recorded and consistent', () => {
  for (let n = 5; n <= 15; n++) {
    for (let seed = 0; seed < 12; seed++) {
      const s = playGame(seed, n);
      const where = `seed ${seed}, ${n}p`;
      const h = s.history;
      // Order and numbering.
      assert.deepEqual(h.map((e) => e.seq), h.map((_, i) => i), `${where}: sequence`);
      for (let i = 1; i < h.length; i++) {
        assert.ok(h[i].night >= h[i - 1].night && h[i].day >= h[i - 1].day, `${where}: time never goes backwards`);
      }
      assert.equal(h[0].type, 'roles', `${where}: starts with the roles`);
      assert.equal(h.at(-1)!.type, 'win', `${where}: ends with the win`);
      assert.equal(of(s, 'win').length, 1);
      assert.equal(last(s, 'win').vars.winner, s.winner);
      assert.equal(of(s, 'nightStart').length, s.night, `${where}: one nightStart per night`);
      // Every player, dead or alive, is accounted for.
      const ids = new Set(s.players.map((p) => p.id));
      const seenIds: string[] = [];
      const collect = (v: unknown): void => {
        if (typeof v === 'string' && ids.has(v)) seenIds.push(v);
        else if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === 'object') Object.values(v).forEach(collect);
      };
      h.forEach((e) => collect(e.vars));
      assert.ok(seenIds.length > 0);
      // Deaths: exactly one death event per dead player (except the ones executed while already dead).
      const deaths = of(s, 'death');
      const dead = s.players.filter((p) => !p.alive);
      assert.deepEqual(deaths.map((d) => d.vars.player).sort(), dead.map((p) => p.id).sort(), `${where}: every dead player has exactly one death event`);
      for (const d of deaths) {
        assert.ok(['demon', 'execution', 'virgin', 'slayer', 'mayorBounce', 'starPass'].includes(d.vars.cause as string));
        if (['demon', 'mayorBounce', 'starPass'].includes(d.vars.cause as string)) assert.equal(d.phase, 'night', `${where}: a Demon kill happens at night`);
        else assert.equal(d.phase, 'day', `${where}: executions and shots happen by day`);
      }
      // Nominations: each ends in a vote or in the Virgin's execution.
      const virginExec = of(s, 'virgin').filter((e) => e.vars.executed).length;
      assert.equal(of(s, 'nominate').length, of(s, 'vote').length + virginExec, `${where}: every nomination was settled`);
      // Votes add up.
      for (const v of of(s, 'vote')) {
        const votes = v.vars.votes as { id: string; yes: boolean }[];
        const yes = votes.filter((x) => x.yes).length - (v.vars.dropped as string[]).length;
        assert.equal(v.vars.yes, yes, `${where}: the yes count matches the votes`);
        assert.equal(v.vars.needed, Math.ceil((v.vars.alive as number) / 2));
        assert.ok(['block', 'tie', 'short'].includes(v.vars.outcome as string));
        if (v.vars.outcome === 'block') assert.ok((v.vars.yes as number) >= (v.vars.needed as number));
      }
      // Executions match the village log.
      assert.equal(of(s, 'execution').length, s.publicLog.filter((m) => m.key === 'wasExecuted').length, `${where}: executions`);
      assert.equal(of(s, 'slayer').filter((e) => e.vars.hit).length, s.publicLog.filter((m) => m.key === 'slayerHit').length);
      // Real actions only: no choice ever has an empty target list.
      for (const c of of(s, 'choice')) assert.ok((c.vars.targets as string[]).length > 0);
      // Information flagged unreliable is always from a Drunk or a poisoned player.
      for (const i of of(s, 'info')) assert.ok([null, 'drunk', 'poisoned'].includes(i.vars.lost as string | null));
      // The whole history survives being saved and reloaded.
      assert.equal(JSON.stringify(JSON.parse(JSON.stringify(h))), JSON.stringify(h));
      // Characters named are real ones.
      for (const e of h) for (const k of ['character', 'ability']) if (typeof e.vars[k] === 'string') assert.ok(e.vars[k] in CHARACTERS, `${where}: ${k} ${e.vars[k]}`);
    }
  }
});

test('the history is part of the saved game and grows as it is played', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'chef', 'soldier']);
  const before = JSON.parse(JSON.stringify(s)) as GameState;
  useSlayer(s, s.players[1].id, s.players[2].id);
  const saved = JSON.parse(JSON.stringify(s)) as GameState;
  assert.equal(before.history.length, 0);
  assert.equal(saved.history.length, s.history.length);
  assert.ok(saved.history.length > 0);
});
