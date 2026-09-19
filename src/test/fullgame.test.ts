// Whole games, start to finish, with every action scripted. At every night step the tests assert
// exactly who sees a real turn and who sees a decoy — so "who sees what, when" is pinned down.
import assert from 'node:assert/strict';
import { poisonedId } from './helpers.js';
import { test } from 'node:test';
import { addPlayer, createGame, declareNeighbor, nominate, startGame, tick } from '../game/engine.js';
import { MIN_ANSWER_MS, submitRealResponse } from '../game/night.js';
import { mulberry32, seedFromString } from '../game/rng.js';
import type { CharacterId, GameState, PlayerState } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { endDayByConsensus, fastForwardToVote, mk, startNight, voteInOrder } from './helpers.js';

const names = (ps: PlayerState[]) => ps.map((p) => p.name).sort();

/**
 * Plays one night step exactly as scripted and asserts, at every moment, who sees what:
 *  - the step is the expected character's;
 *  - the real actors (and only they) see a real screen, everyone else the living see a decoy;
 *  - once the real actors have answered, the remaining screens are ALL decoys — the step is still
 *    waiting, so "everybody has a decoy" at that point is normal;
 *  - the step only ends when the last decoy is answered.
 */
function playStep(s: GameState, char: string, real: Record<string, PlayerState[]>, alsoWokenAsDecoys: PlayerState[] = []): void {
  const t = s.pendingRealTurn!;
  assert.ok(t, `expected the ${char} step`);
  assert.equal(t.charId, char, `step order: expected ${char}, got ${t.charId}`);
  const actors = Object.keys(real).map((n) => s.players.find((p) => p.name === n)!);
  assert.deepEqual(names(t.participantIds.map((id) => s.players.find((p) => p.id === id)!)),
    names(s.players), `${char}: everyone is woken (real or decoy)`);
  for (const p of s.players) {
    const turn = viewFor(s, p.id).nightTurn;
    if (actors.includes(p)) assert.equal(turn?.decoy, false, `${char}: ${p.name} has the REAL turn`);
    else assert.equal(turn?.decoy, true, `${char}: ${p.name} has a decoy`);
  }
  for (const p of alsoWokenAsDecoys) assert.equal(viewFor(s, p.id).nightTurn?.decoy, true, `${char}: ${p.name} still gets decoys`);

  const at = t.openedAt + MIN_ANSWER_MS;
  for (const actor of actors) {
    assert.throws(() => submitRealResponse(s, actor.id, real[actor.name].map((p) => p.id), at - 1), /Too early/);
    submitRealResponse(s, actor.id, real[actor.name].map((p) => p.id), at);
  }
  // The real turn is done. Everyone still waiting is on a decoy, and the step has not ended.
  const waiting = t.participantIds.filter((id) => !(id in t.responses));
  if (waiting.length) {
    assert.equal(s.pendingRealTurn, t, `${char}: the step waits for the decoys`);
    for (const id of waiting) assert.equal(viewFor(s, id).nightTurn?.decoy, true, `${char}: every remaining screen is a decoy`);
  }
  for (const id of waiting) {
    const turn = viewFor(s, id).nightTurn!;
    submitRealResponse(s, id, turn.shape === 'choose' ? turn.choices.slice(0, turn.min).map((c) => c.id) : [], at);
  }
}

/** After the last step: nothing more to do until dawn, then the day starts. */
function dawn(s: GameState): void {
  assert.equal(s.pendingRealTurn, null, 'all steps are done');
  assert.equal(s.phase, 'night', 'dawn has not broken yet');
  tick(s, s.dawnAt! - 1);
  assert.equal(s.phase, 'night', 'not a moment early');
  tick(s, s.dawnAt!);
  assert.equal(s.phase, 'day');
}

test('full game 1 (7 players): night 1, a quiet day, a night kill, then the Demon is executed — good wins', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  const [imp, poisoner, empath, washerwoman, soldier, monk, chef] = s.players;

  // ---- Night 1: with 7+ players the evil team learns each other. In-play steps only, in order. ----
  startNight(s);
  playStep(s, 'minion-info', { [poisoner.name]: [] });
  playStep(s, 'imp', { [imp.name]: [] });
  playStep(s, 'poisoner', { [poisoner.name]: [monk] });
  playStep(s, 'washerwoman', { [washerwoman.name]: [] });
  playStep(s, 'chef', { [chef.name]: [] });
  playStep(s, 'empath', { [empath.name]: [] });
  assert.equal(poisonedId(s), monk.id);
  dawn(s);
  assert.equal(s.day, 1);
  for (const p of s.players) assert.equal(viewFor(s, p.id).dawnMessage?.key, 'survivedNight');

  // ---- Day 1: nobody is nominated; everyone agrees to end the day ----
  endDayByConsensus(s);
  assert.equal(s.phase, 'night');
  assert.equal(s.night, 2);

  // ---- Night 2: the poisoned Monk's protection is void, so the Imp's kill on the Washerwoman lands ----
  playStep(s, 'poisoner', { [poisoner.name]: [monk] });
  playStep(s, 'monk', { [monk.name]: [washerwoman] });
  playStep(s, 'imp', { [imp.name]: [washerwoman] });
  assert.equal(washerwoman.alive, false);
  // The victim is still woken (as a decoy) and cannot tell they died: their own view says alive.
  assert.equal(viewFor(s, washerwoman.id).amIAlive, true, 'a night kill stays hidden until dawn');
  playStep(s, 'empath', { [empath.name]: [] });
  dawn(s);
  assert.equal(viewFor(s, washerwoman.id).dawnMessage?.key, 'diedTonight');
  assert.equal(viewFor(s, empath.id).dawnMessage?.key, 'survivedNight');

  // ---- Day 2: the village finds the Imp and executes them ----
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, soldier.id, chef.id]); // 3 yes of 6 alive: exactly half is enough
  assert.equal(s.onBlockId, imp.id);
  endDayByConsensus(s);
  assert.equal(s.winner, 'good');
  assert.equal(s.phase, 'ended');
  assert.equal(s.publicLog.at(-1)!.key, 'goodWinsDemonDead');
});

test('full game 2 (5 players): a dead Empath gets no step, a wrong execution, then the last kill — evil wins', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const [imp, poisoner, empath, washerwoman, soldier] = s.players;

  // ---- Night 1 (5 players: no Minion info, and the Imp has nothing to do) ----
  startNight(s);
  playStep(s, 'poisoner', { [poisoner.name]: [poisoner] });
  playStep(s, 'washerwoman', { [washerwoman.name]: [] });
  playStep(s, 'empath', { [empath.name]: [] });
  dawn(s);
  endDayByConsensus(s);

  // ---- Night 2: the Imp kills the Empath BEFORE the Empath's turn, so that step never happens ----
  playStep(s, 'poisoner', { [poisoner.name]: [poisoner] });
  playStep(s, 'imp', { [imp.name]: [empath] });
  assert.equal(empath.alive, false);
  assert.equal(s.pendingRealTurn, null, 'no Empath step: the Empath is dead');
  dawn(s);

  // ---- Day 2: the village executes the (innocent) Soldier ----
  nominate(s, poisoner.id, soldier.id);
  fastForwardToVote(s);
  voteInOrder(s, [poisoner.id, washerwoman.id]); // 2 yes of 4 alive
  assert.equal(s.onBlockId, soldier.id);
  endDayByConsensus(s);
  assert.equal(soldier.alive, false);
  assert.equal(s.winner, null);
  assert.equal(s.night, 3);

  // ---- Night 3: 3 alive; the Imp's kill leaves 2 — evil wins on the spot, no dawn wait ----
  playStep(s, 'poisoner', { [poisoner.name]: [poisoner] });
  const t = s.pendingRealTurn!;
  assert.equal(t.charId, 'imp');
  submitRealResponse(s, imp.id, [washerwoman.id], t.openedAt + MIN_ANSWER_MS);
  assert.equal(s.winner, 'evil');
  assert.equal(s.phase, 'ended');
  assert.equal(s.pendingRealTurn, null, 'the game is over: no more steps');
});

test('a step where the real actor answered fast: everybody still waiting shows a decoy — that is normal', () => {
  // This is the situation that looks like "everybody has a decoy": the real turn is already
  // done, the step just waits for the others' decoys.
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const poisoner = s.players[1];
  startNight(s);
  const t = s.pendingRealTurn!;
  assert.equal(t.charId, 'poisoner');
  const real = s.players.filter((p) => viewFor(s, p.id).nightTurn?.decoy === false);
  assert.deepEqual(names(real), [poisoner.name], 'at the start of the step, exactly one player has the real turn');

  submitRealResponse(s, poisoner.id, [poisoner.id], t.openedAt + MIN_ANSWER_MS);
  const stillOnScreen = s.players.filter((p) => viewFor(s, p.id).nightTurn);
  assert.equal(stillOnScreen.length, 4, 'the four others are still answering');
  assert.ok(stillOnScreen.every((p) => viewFor(s, p.id).nightTurn!.decoy), 'and all of them show a decoy');
  assert.equal(s.pendingRealTurn, t, 'the step has not moved on');
  assert.equal(viewFor(s, poisoner.id).nightTurn, null, 'the real actor is done and just waits');
});

test('the same game replayed gives the exact same transcript (a full game from the lobby, every action scripted)', () => {
  const play = (): string[] => {
    const rand = mulberry32(seedFromString('replay'));
    const realRandom = Math.random;
    Math.random = rand;
    try {
      const s = createGame('REPLAY');
      s.secret = 'replay-secret';
      const ps = Array.from({ length: 8 }, (_, i) => addPlayer(s, `P${i}`));
      ps.forEach((p, i) => declareNeighbor(s, p.id, ps[(i + 1) % ps.length].id));
      startGame(s);
      const log: string[] = [`roles: ${s.players.map((p) => p.character).join(',')}`];
      for (let round = 0; round < 40 && s.phase !== 'ended'; round++) {
        if (s.phase === 'night') {
          while (s.pendingRealTurn) {
            const t = s.pendingRealTurn;
            const actors = t.playerIds.map((id) => s.players.find((p) => p.id === id)!.name);
            const decoys = t.participantIds.filter((id) => !t.playerIds.includes(id)).map((id) => s.players.find((p) => p.id === id)!.name);
            log.push(`night ${s.night} ${t.charId}: real=${actors.join('+')} decoys=${decoys.length}`);
            const at = t.openedAt + MIN_ANSWER_MS;
            for (const id of t.participantIds.slice()) {
              if (s.pendingRealTurn !== t) break;
              const turn = viewFor(s, id).nightTurn;
              if (!turn) continue;
              const self = id;
              const picks = turn.shape === 'choose'
                ? turn.choices.filter((c) => (c.id !== self || t.max > 1)).slice(0, turn.min).map((c) => c.id)
                : [];
              submitRealResponse(s, id, picks, at);
            }
          }
          if (s.phase === 'night') {
            tick(s, s.dawnAt!);
            log.push(`dawn ${s.day}: dead=${s.players.filter((p) => !p.alive).map((p) => p.name).join('+') || '-'}`);
          }
        }
        if (s.phase === 'day') {
          const alive = s.players.filter((p) => p.alive);
          nominate(s, alive[0].id, alive[1].id);
          if (s.currentNomination) {
            fastForwardToVote(s);
            voteInOrder(s, alive.map((p) => p.id));
            log.push(`day ${s.day}: block=${s.players.find((p) => p.id === s.onBlockId)?.name ?? '-'}`);
          } else {
            log.push(`day ${s.day}: the nominator was executed at once (Virgin)`);
          }
          if (s.phase === 'day') endDayByConsensus(s);
          log.push(`after day ${s.day}: alive=${s.players.filter((p) => p.alive).length}`);
        }
      }
      log.push(`winner: ${s.winner}`);
      return log;
    } finally {
      Math.random = realRandom;
    }
  };
  const first = play();
  const second = play();
  assert.deepEqual(second, first, 'identical inputs must give an identical game');
  assert.ok(first.at(-1)!.startsWith('winner: good') || first.at(-1)!.startsWith('winner: evil'), `the game must end: ${first.at(-1)}`);
  assert.ok(first.some((l) => l.includes('minion-info')), 'with 8 players the evil team is introduced on night 1');
});

test('every scripted step of every character in Trouble Brewing: who is real, who is decoy, in the official order', () => {
  // One game with a character for each night step, so the order and the "real vs decoy" split of
  // EVERY step is asserted. Night 2 adds the Ravenkeeper (killed by the Imp) and the Undertaker.
  const chars: CharacterId[] = ['imp', 'poisoner', 'spy', 'washerwoman', 'librarian', 'investigator', 'chef', 'empath', 'fortuneteller', 'butler', 'ravenkeeper', 'undertaker'];
  const s = mk(chars);
  const by = Object.fromEntries(s.players.map((p) => [p.character, p]));
  startNight(s);
  playStep(s, 'minion-info', { [by.poisoner.name]: [], [by.spy.name]: [] });
  playStep(s, 'imp', { [by.imp.name]: [] });
  playStep(s, 'poisoner', { [by.poisoner.name]: [by.chef] });
  playStep(s, 'washerwoman', { [by.washerwoman.name]: [] });
  playStep(s, 'librarian', { [by.librarian.name]: [] });
  playStep(s, 'investigator', { [by.investigator.name]: [] });
  playStep(s, 'chef', { [by.chef.name]: [] });
  playStep(s, 'empath', { [by.empath.name]: [] });
  playStep(s, 'fortuneteller', { [by.fortuneteller.name]: [by.imp, by.empath] });
  playStep(s, 'butler', { [by.butler.name]: [by.empath] });
  playStep(s, 'spy', { [by.spy.name]: [] });
  dawn(s);
  endDayByConsensus(s);

  // Night 2: the Imp kills the Ravenkeeper, who is then woken (dead, but still seen as alive by all).
  playStep(s, 'poisoner', { [by.poisoner.name]: [by.chef] });
  playStep(s, 'imp', { [by.imp.name]: [by.ravenkeeper] });
  playStep(s, 'ravenkeeper', { [by.ravenkeeper.name]: [by.imp] });
  assert.equal(by.ravenkeeper.nightResult?.key, 'ravenkeeperInfo');
  playStep(s, 'empath', { [by.empath.name]: [] });
  playStep(s, 'fortuneteller', { [by.fortuneteller.name]: [by.imp, by.empath] });
  playStep(s, 'butler', { [by.butler.name]: [by.empath] });
  // (No Undertaker step: nobody was executed on day 1, so they are not woken.)
  playStep(s, 'spy', { [by.spy.name]: [] });
  dawn(s);
});
