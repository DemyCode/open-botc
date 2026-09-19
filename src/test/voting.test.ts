// Voting, the block, ties, ghost votes and execution — checked against a tiny independent model
// of the official rules over hundreds of random days.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castVote, nominate, tick, toggleEndDayRequest } from '../game/engine.js';
import { mulberry32, seedFromString } from '../game/rng.js';
import type { CharacterId, GameState, PlayerState } from '../game/types.js';
import { endDayByConsensus, fastForwardToVote, mkDay, voteInOrder } from './helpers.js';

// Characters with no interaction with nominations, votes or death — plus the Imp.
const NEUTRAL: CharacterId[] = ['empath', 'chef', 'washerwoman', 'soldier', 'investigator', 'librarian', 'undertaker', 'monk', 'fortuneteller'];

interface Model {
  highest: number;
  block: string | null;
  ghostUsed: Set<string>;
  nominators: Set<string>;
  nominees: Set<string>;
}

/** The official rules, restated as simply as possible. */
function modelVote(m: Model, s: GameState, nominee: PlayerState, yesIds: Set<string>): { yes: number } {
  const alive = s.players.filter((p) => p.alive).length;
  let yes = 0;
  for (const p of s.players) {
    const canVote = p.alive || !m.ghostUsed.has(p.id);
    if (!canVote) continue;
    if (yesIds.has(p.id)) {
      yes++;
      if (!p.alive) m.ghostUsed.add(p.id);
    }
  }
  const need = Math.ceil(alive / 2); // "equals or exceeds half the number of alive players"
  if (yes >= need && yes > m.highest) {
    m.block = nominee.id;
    m.highest = yes;
  } else if (yes > 0 && yes === m.highest) {
    m.block = null; // a tie with the highest so far: nobody is about to die
  }
  return { yes };
}

test('over 400 random days, every block, tie, ghost vote and execution matches the reference model', () => {
  let ties = 0;
  let overtakes = 0;
  let deadVotes = 0;
  let executions = 0;
  for (let i = 0; i < 400; i++) {
    const rand = mulberry32(seedFromString(`vote-model-${i}`));
    const n = 5 + Math.floor(rand() * 8); // 5..12
    const chars: CharacterId[] = ['imp', ...Array.from({ length: n - 1 }, () => NEUTRAL[Math.floor(rand() * NEUTRAL.length)])];
    const s = mkDay(chars);
    // Some players are already dead, some of them already spent their ghost vote.
    const model: Model = { highest: 0, block: null, ghostUsed: new Set(), nominators: new Set(), nominees: new Set() };
    for (const p of s.players.slice(1)) {
      if (rand() < 0.25) {
        p.alive = false;
        if (rand() < 0.4) { p.ghostVoteUsed = true; model.ghostUsed.add(p.id); }
      }
    }
    if (s.players.filter((p) => p.alive).length < 3) continue;

    const rounds = 1 + Math.floor(rand() * 5);
    for (let r = 0; r < rounds; r++) {
      const nominators = s.players.filter((p) => p.alive && !model.nominators.has(p.id));
      const nominees = s.players.filter((p) => !model.nominees.has(p.id));
      if (!nominators.length || !nominees.length) break;
      const nominator = nominators[Math.floor(rand() * nominators.length)];
      const nominee = nominees[Math.floor(rand() * nominees.length)];
      model.nominators.add(nominator.id);
      model.nominees.add(nominee.id);
      nominate(s, nominator.id, nominee.id);
      fastForwardToVote(s);
      const yesIds = new Set(s.players.filter(() => rand() < 0.55).map((p) => p.id));
      // Only players who are actually asked can vote; the engine skips dead players with no vote left.
      voteInOrder(s, [...yesIds]);
      const before = model.block;
      const { yes } = modelVote(model, s, nominee, yesIds);
      assert.equal(s.onBlockId, model.block, `case ${i} round ${r}: the block after ${yes} yes votes`);
      assert.equal(s.highestYesToday, model.highest, `case ${i} round ${r}: the highest count`);
      if (before !== null && model.block === null) ties++;
      if (before !== null && model.block !== null && before !== model.block) overtakes++;
      for (const id of model.ghostUsed) assert.equal(s.players.find((p) => p.id === id)!.ghostVoteUsed, true, 'a spent ghost vote stays spent');
      deadVotes += s.players.filter((p) => !p.alive && p.ghostVoteUsed).length;
      if (s.phase !== 'day') break;
    }
    if (s.phase !== 'day') continue;

    // End the day: whoever is on the block is executed.
    const block = model.block;
    const aliveBefore = s.players.filter((p) => p.alive).length;
    const wasAlive = block ? s.players.find((p) => p.id === block)!.alive : false;
    // Every living connected player agrees.
    for (const p of s.players.filter((q) => q.alive)) if (s.phase === 'day') toggleEndDayRequest(s, p.id);
    if (block) {
      executions++;
      assert.equal(s.lastExecutedId, block, `case ${i}: the block was executed`);
      assert.equal(s.players.find((p) => p.id === block)!.alive, false);
      const aliveAfter = s.players.filter((p) => p.alive).length;
      assert.equal(aliveAfter, aliveBefore - (wasAlive ? 1 : 0));
      const executedImp = s.players.find((p) => p.id === block)!.character === 'imp';
      if (executedImp && wasAlive) assert.equal(s.winner, 'good', `case ${i}: the Demon was executed`);
      else if (aliveAfter <= 2) assert.equal(s.winner, 'evil', `case ${i}: 2 or fewer alive with the Demon alive`);
      else assert.equal(s.winner, null, `case ${i}: the game continues`);
    } else {
      assert.equal(s.lastExecutedId, null, `case ${i}: nobody on the block, nobody executed`);
    }
  }
  assert.ok(ties > 5 && overtakes > 5 && deadVotes > 50 && executions > 100, `the random days must reach the interesting cases (${ties} ties, ${overtakes} overtakes, ${deadVotes} ghost votes, ${executions} executions)`);
});

// ---- hand-built cases for the exact boundaries ----

const twelve = (): GameState => mkDay(['imp', ...Array(11).fill('empath')] as CharacterId[]);

for (const alive of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  const need = Math.ceil(alive / 2);
  test(`${alive} alive: exactly ${need} yes votes put someone on the block, ${need - 1} do not (dead voters count too)`, () => {
    for (const withDead of [false, true]) {
      for (const yesCount of [need - 1, need]) {
        const s = twelve();
        const dead = withDead ? 12 - alive : 0;
        // Kill `dead` players (not the nominee/nominator) so exactly `alive` remain when withDead; else use only `alive` players.
        const players = s.players;
        if (!withDead) {
          for (let k = alive; k < 12; k++) players[k].alive = false;
          for (let k = alive; k < 12; k++) players[k].ghostVoteUsed = true; // they can't vote
        } else {
          for (let k = 12 - dead; k < 12; k++) players[k].alive = false;
        }
        const nominee = players[1];
        nominate(s, players[0].id, nominee.id);
        fastForwardToVote(s);
        // Vote yes with `yesCount` of the players who can be asked, living first, then the dead.
        const askable = s.currentNomination!.voteOrder.map((id) => players.find((p) => p.id === id)!).filter((p) => p.alive || !p.ghostVoteUsed);
        const ordered = [...askable.filter((p) => p.alive), ...askable.filter((p) => !p.alive)];
        assert.ok(ordered.length >= yesCount, 'enough voters for this case');
        voteInOrder(s, ordered.slice(0, yesCount).map((p) => p.id));
        assert.equal(s.onBlockId, yesCount >= need ? nominee.id : null, `${alive} alive, ${dead} dead voting, ${yesCount} yes`);
      }
    }
  });
}

test('a dead player who votes yes spends their vote; voting no keeps it', () => {
  const s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman']);
  const ghost = s.players[4];
  ghost.alive = false;
  nominate(s, s.players[1].id, s.players[2].id);
  fastForwardToVote(s);
  voteInOrder(s, []); // votes no
  assert.equal(ghost.ghostVoteUsed, false);
  nominate(s, s.players[3].id, s.players[0].id);
  fastForwardToVote(s);
  voteInOrder(s, [ghost.id]); // votes yes
  assert.equal(ghost.ghostVoteUsed, true);
});

test('a dead player is asked to vote until they spend it, then never again', () => {
  const s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman', 'monk']);
  const ghost = s.players[5];
  ghost.alive = false;
  const asked: boolean[] = [];
  for (const [nominator, nominee, votesYes] of [[1, 2, false], [2, 3, true], [3, 4, false], [4, 0, false]] as const) {
    nominate(s, s.players[nominator].id, s.players[nominee].id);
    fastForwardToVote(s);
    asked.push(s.currentNomination!.voteOrder.some((id) => id === ghost.id) && (() => {
      // is the ghost actually asked at some point?
      let found = false;
      let guard = 0;
      while (s.currentNomination?.state === 'voting' && guard++ < 30) {
        const v = s.currentNomination.currentVoterId!;
        if (v === ghost.id) found = true;
        castVote(s, v, v === ghost.id ? votesYes : false);
      }
      return found;
    })());
  }
  assert.deepEqual(asked, [true, true, false, false], 'asked until the yes vote spent it');
});

test('a tie between two nominees clears the block, and a third with more takes it', () => {
  const s = mkDay(['imp', ...Array(8).fill('empath')] as CharacterId[]); // 9 alive: need 5
  const [a, b, c, d, e, f, g] = s.players;
  nominate(s, a.id, b.id); fastForwardToVote(s); voteInOrder(s, [a, b, c, d, e].map((p) => p.id));
  assert.equal(s.onBlockId, b.id);
  nominate(s, c.id, d.id); fastForwardToVote(s); voteInOrder(s, [a, b, c, d, e].map((p) => p.id));
  assert.equal(s.onBlockId, null, 'tie at 5');
  nominate(s, e.id, f.id); fastForwardToVote(s); voteInOrder(s, [a, b, c, d, e, g].map((p) => p.id));
  assert.equal(s.onBlockId, f.id, '6 beats the tied 5');
});

test('a lower vote after a tie does not change anything', () => {
  const s = mkDay(['imp', ...Array(8).fill('empath')] as CharacterId[]);
  const [a, b, c, d, e, f] = s.players;
  nominate(s, a.id, b.id); fastForwardToVote(s); voteInOrder(s, [a, b, c, d, e].map((p) => p.id));
  nominate(s, c.id, d.id); fastForwardToVote(s); voteInOrder(s, [a, b, c, d, e].map((p) => p.id));
  nominate(s, e.id, f.id); fastForwardToVote(s); voteInOrder(s, [a, b].map((p) => p.id));
  assert.equal(s.onBlockId, null);
});

test('no execution on a day with no successful vote, and the Undertaker is told nobody', () => {
  const s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman']);
  nominate(s, s.players[1].id, s.players[2].id);
  fastForwardToVote(s);
  voteInOrder(s, []);
  endDayByConsensus(s);
  assert.equal(s.lastExecutedId, null);
  assert.ok(s.players.every((p) => p.alive));
  assert.equal(s.publicLog.some((m) => m.key === 'noExecutionToday'), true);
});

test('you can vote for yourself as the nominee, and it counts', () => {
  const s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman']);
  const nominee = s.players[1];
  nominate(s, s.players[2].id, nominee.id);
  fastForwardToVote(s);
  voteInOrder(s, [nominee.id, s.players[2].id, s.players[3].id]);
  assert.equal(s.onBlockId, nominee.id);
  assert.equal(s.currentNomination, null);
});

test('the vote goes round in seat order, ending on the nominee, for every possible nominee seat', () => {
  for (let seat = 0; seat < 7; seat++) {
    const s = mkDay(['imp', ...Array(6).fill('empath')] as CharacterId[]);
    const nominee = s.players[seat];
    const nominator = s.players[(seat + 1) % 7];
    nominate(s, nominator.id, nominee.id);
    fastForwardToVote(s);
    const order = s.currentNomination!.voteOrder.map((id) => s.players.find((p) => p.id === id)!.seat);
    assert.deepEqual(order, Array.from({ length: 7 }, (_, k) => (seat + 1 + k) % 7), `nominee at seat ${seat}`);
  }
});

test('a vote that is timed out for everybody still ends properly', () => {
  const s = mkDay(['imp', 'empath', 'chef', 'soldier', 'washerwoman']);
  nominate(s, s.players[1].id, s.players[2].id);
  fastForwardToVote(s);
  for (let k = 0; k < 10 && s.currentNomination; k++) tick(s, s.currentNomination.voterDeadline!);
  assert.equal(s.currentNomination, null);
});
