import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  castVote,
  endSpeech,
  nominate,
  openNominations,
  requestEndDay,
  slay,
  tick,
} from '../game/engine.js';
import { alivePlayers } from '../game/types.js';
import { byChar, endDay, logText, mk, runNight, toDay, toNight } from './helpers.js';

/** Get a fresh game to the point where nominations are open. */
function toNominations(chars: Parameters<typeof mk>[0], opts?: Parameters<typeof mk>[1]) {
  const g = mk(chars, opts);
  runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
  toDay(g);
  openNominations(g.s, alivePlayers(g.s)[0].id, g.clock.advance(100));
  return g;
}

/** Run a nomination through both speeches and into voting. */
function nominateAndVote(
  g: ReturnType<typeof mk>,
  nominatorId: string,
  nomineeId: string,
  votes: Record<string, boolean>,
) {
  nominate(g.s, nominatorId, nomineeId, g.clock.advance(100));
  if (g.s.phase === 'dusk' || g.s.phase === 'over') return; // Virgin fired
  endSpeech(g.s, nominatorId, g.clock.advance(100));
  endSpeech(g.s, nomineeId, g.clock.advance(100));
  assert.equal(g.s.phase, 'voting');
  for (const [id, v] of Object.entries(votes)) {
    castVote(g.s, id, v, g.clock.advance(50));
  }
  if (g.s.phase === 'voting') tick(g.s, g.clock.advance(60_000));
}

describe('nominations', () => {
  it('runs accuser then accusee then voting', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const a = byChar(g.s, 'chef');
    const b = byChar(g.s, 'empath');

    nominate(g.s, a.id, b.id, g.clock.advance(100));
    assert.equal(g.s.phase, 'speech');
    assert.equal(g.s.nomination?.stage, 'accuser');

    endSpeech(g.s, a.id, g.clock.advance(100));
    assert.equal(g.s.nomination?.stage, 'accusee');

    endSpeech(g.s, b.id, g.clock.advance(100));
    assert.equal(g.s.phase, 'voting');
    assert.match(logText(g.s), /P0 nominates P1/);
  });

  it('advances speeches automatically when the timer runs out', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    nominate(g.s, byChar(g.s, 'chef').id, byChar(g.s, 'empath').id, g.clock.advance(100));
    tick(g.s, g.clock.advance(60_000));
    assert.equal(g.s.nomination?.stage, 'accusee');
    tick(g.s, g.clock.advance(60_000));
    assert.equal(g.s.phase, 'voting');
  });

  it('only the current speaker or host may cut a speech short', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const a = byChar(g.s, 'chef');
    const b = byChar(g.s, 'empath');
    const bystander = byChar(g.s, 'soldier');
    nominate(g.s, a.id, b.id, g.clock.advance(100));
    assert.throws(() => endSpeech(g.s, bystander.id, g.clock.advance(100)), /speaker/i);
  });

  it('allows one nomination per nominator and one per nominee', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const a = byChar(g.s, 'chef');
    const b = byChar(g.s, 'empath');
    const c = byChar(g.s, 'soldier');
    nominateAndVote(g, a.id, b.id, {});
    assert.throws(() => nominate(g.s, a.id, c.id, g.clock.advance(100)), /already nominated/i);
    assert.throws(
      () => nominate(g.s, c.id, b.id, g.clock.advance(100)),
      /already been nominated/i,
    );
  });

  it('refuses nominations from the dead and of the dead', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const dead = byChar(g.s, 'soldier');
    dead.alive = false;
    assert.throws(
      () => nominate(g.s, dead.id, byChar(g.s, 'chef').id, g.clock.advance(100)),
      /Dead players cannot nominate/i,
    );
    assert.throws(
      () => nominate(g.s, byChar(g.s, 'chef').id, dead.id, g.clock.advance(100)),
      /cannot nominate a dead player/i,
    );
  });
});

describe('voting', () => {
  it('puts a player on the block at half the living players', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const [a, b, c, d, e] = alivePlayers(g.s);
    // 5 alive → 3 votes needed.
    nominateAndVote(g, a.id, b.id, { [a.id]: true, [c.id]: true, [d.id]: true, [e.id]: false });
    assert.equal(g.s.nomination?.result?.yes, 3);
    assert.equal(g.s.onTheBlock, b.id);
  });

  it('leaves nobody on the block below the threshold', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const [a, b, c] = alivePlayers(g.s);
    nominateAndVote(g, a.id, b.id, { [a.id]: true, [c.id]: true });
    assert.equal(g.s.onTheBlock, null);
    assert.equal(g.s.voteBar, 0);
  });

  it('a tie on the highest count clears the block', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'monk', 'poisoner', 'imp']);
    const all = alivePlayers(g.s);
    const [a, b, c, d, e, f] = all;
    // 6 alive → 3 needed.
    nominateAndVote(g, a.id, b.id, {
      [a.id]: true, [c.id]: true, [d.id]: true, [e.id]: false, [f.id]: false,
    });
    assert.equal(g.s.onTheBlock, b.id);
    assert.equal(g.s.voteBar, 3);

    nominateAndVote(g, b.id, c.id, {
      [b.id]: true, [d.id]: true, [e.id]: true, [a.id]: false, [f.id]: false,
    });
    assert.equal(g.s.nomination?.result?.tied, true);
    assert.equal(g.s.onTheBlock, null, 'a tie takes everyone off the block');
    assert.equal(g.s.voteBar, 3, 'the bar to beat stays');
  });

  it('a higher count takes over the block', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'monk', 'poisoner', 'imp']);
    const [a, b, c, d, e, f] = alivePlayers(g.s);
    nominateAndVote(g, a.id, b.id, { [a.id]: true, [c.id]: true, [d.id]: true });
    assert.equal(g.s.onTheBlock, b.id);
    nominateAndVote(g, b.id, c.id, {
      [b.id]: true, [d.id]: true, [e.id]: true, [f.id]: true,
    });
    assert.equal(g.s.onTheBlock, c.id);
    assert.equal(g.s.voteBar, 4);
  });

  it('dead players get exactly one ghost vote', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'monk', 'poisoner', 'imp']);
    const all = g.s.players;
    const ghost = byChar(g.s, 'monk');
    ghost.alive = false;

    const [a, b, c] = alivePlayers(g.s);
    nominateAndVote(g, a.id, b.id, { [ghost.id]: true, [c.id]: true });
    assert.equal(ghost.ghostVoteUsed, true);

    assert.throws(
      () => {
        nominate(g.s, b.id, c.id, g.clock.advance(100));
        endSpeech(g.s, b.id, g.clock.advance(100));
        endSpeech(g.s, c.id, g.clock.advance(100));
        castVote(g.s, ghost.id, true, g.clock.advance(100));
      },
      /already used your ghost vote/i,
    );
    void all;
  });

  it('a ghost vote is not spent on a "no"', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'monk', 'poisoner', 'imp']);
    const ghost = byChar(g.s, 'monk');
    ghost.alive = false;
    const [a, b] = alivePlayers(g.s);
    nominateAndVote(g, a.id, b.id, { [ghost.id]: false });
    assert.equal(ghost.ghostVoteUsed, false);
  });

  it("the Butler's vote only counts when their master votes yes", () => {
    const g = toNominations(['butler', 'empath', 'soldier', 'monk', 'poisoner', 'imp'], {
      recluseMisregisterChance: 0,
    });
    const butler = byChar(g.s, 'butler');
    const master = byChar(g.s, 'empath');
    butler.butlerMaster = master.id;

    const soldier = byChar(g.s, 'soldier');
    const monk = byChar(g.s, 'monk');
    // 6 alive → 3 needed. Butler votes yes but the master does not.
    nominateAndVote(g, soldier.id, byChar(g.s, 'imp').id, {
      [butler.id]: true,
      [master.id]: false,
      [soldier.id]: true,
      [monk.id]: true,
    });
    assert.equal(g.s.nomination?.result?.yes, 2, "the Butler's vote must not count");
    assert.match(logText(g.s), /could not vote — Butler/);
    assert.equal(g.s.onTheBlock, null);
  });

  it("the Butler's vote counts when their master votes yes", () => {
    const g = toNominations(['butler', 'empath', 'soldier', 'monk', 'poisoner', 'imp']);
    const butler = byChar(g.s, 'butler');
    const master = byChar(g.s, 'empath');
    butler.butlerMaster = master.id;
    const soldier = byChar(g.s, 'soldier');

    nominateAndVote(g, soldier.id, byChar(g.s, 'imp').id, {
      [butler.id]: true,
      [master.id]: true,
      [soldier.id]: true,
    });
    assert.equal(g.s.nomination?.result?.yes, 3);
  });

  it('a poisoned Butler votes freely', () => {
    const g = toNominations(['butler', 'empath', 'soldier', 'monk', 'poisoner', 'imp']);
    const butler = byChar(g.s, 'butler');
    butler.butlerMaster = byChar(g.s, 'empath').id;
    butler.poisoned = true;
    const soldier = byChar(g.s, 'soldier');

    nominateAndVote(g, soldier.id, byChar(g.s, 'imp').id, {
      [butler.id]: true,
      [byChar(g.s, 'empath').id]: false,
      [soldier.id]: true,
      [byChar(g.s, 'monk').id]: true,
    });
    assert.equal(g.s.nomination?.result?.yes, 3);
  });

  it('sequential voting asks one player at a time, clockwise from the nominee', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'monk', 'poisoner', 'imp'], {
      votingMode: 'sequential',
    });
    const ring = g.s.players.slice().sort((a, b) => a.seat - b.seat);
    const nominee = ring[2];
    nominate(g.s, ring[0].id, nominee.id, g.clock.advance(100));
    endSpeech(g.s, ring[0].id, g.clock.advance(100));
    endSpeech(g.s, nominee.id, g.clock.advance(100));

    assert.equal(g.s.phase, 'voting');
    assert.deepEqual(
      g.s.nomination!.voteOrder,
      [ring[3], ring[4], ring[5], ring[0], ring[1], ring[2]].map((p) => p.id),
      'voting starts to the nominee\'s left and wraps around to them',
    );
    assert.equal(g.s.nomination!.voteOrder[g.s.nomination!.voteIndex], ring[3].id);
    assert.throws(() => castVote(g.s, ring[5].id, true, g.clock.advance(50)), /not your turn/i);
    castVote(g.s, ring[3].id, true, g.clock.advance(50));
    assert.equal(g.s.nomination!.voteOrder[g.s.nomination!.voteIndex], ring[4].id);
  });
});

describe('the Virgin', () => {
  it('executes a Townsfolk nominator immediately and ends the day', () => {
    const g = toNominations(['virgin', 'chef', 'soldier', 'poisoner', 'imp']);
    const virgin = byChar(g.s, 'virgin');
    const chef = byChar(g.s, 'chef');

    nominate(g.s, chef.id, virgin.id, g.clock.advance(100));
    assert.equal(chef.alive, false, 'the Townsfolk nominator is executed');
    assert.equal(virgin.alive, true);
    assert.equal(g.s.phase, 'dusk');
    assert.equal(g.s.executionHappened, true);
    assert.equal(g.s.executedToday, chef.id);
    assert.match(logText(g.s), /executed immediately/);
  });

  it('does nothing when the nominator is evil, but is still used up', () => {
    const g = toNominations(['virgin', 'chef', 'soldier', 'poisoner', 'imp']);
    const virgin = byChar(g.s, 'virgin');
    const poisoner = byChar(g.s, 'poisoner');

    nominate(g.s, poisoner.id, virgin.id, g.clock.advance(100));
    assert.equal(poisoner.alive, true);
    assert.equal(virgin.virginUsed, true);
    assert.equal(g.s.phase, 'speech', 'the nomination proceeds normally');
  });

  it('does nothing when the Virgin is poisoned', () => {
    const g = mk(['virgin', 'chef', 'soldier', 'poisoner', 'imp']);
    const virgin = byChar(g.s, 'virgin');
    runNight(g, { poisoner: () => [virgin.id] });
    toDay(g);
    openNominations(g.s, byChar(g.s, 'chef').id, g.clock.advance(100));

    const chef = byChar(g.s, 'chef');
    nominate(g.s, chef.id, virgin.id, g.clock.advance(100));
    assert.equal(chef.alive, true, 'a poisoned Virgin has no ability');
    assert.equal(g.s.phase, 'speech');
  });

  it('only fires once', () => {
    const g = toNominations(['virgin', 'chef', 'soldier', 'monk', 'poisoner', 'imp']);
    const virgin = byChar(g.s, 'virgin');
    const poisoner = byChar(g.s, 'poisoner');
    nominate(g.s, poisoner.id, virgin.id, g.clock.advance(100));
    endSpeech(g.s, poisoner.id, g.clock.advance(100));
    endSpeech(g.s, virgin.id, g.clock.advance(100));
    tick(g.s, g.clock.advance(60_000));

    // A new day, a Townsfolk nominates the Virgin: nothing should happen.
    endDay(g);
    toNight(g);
    runNight(g, { poisoner: () => [poisoner.id], imp: () => [byChar(g.s, 'monk').id] });
    toDay(g);
    openNominations(g.s, byChar(g.s, 'chef').id, g.clock.advance(100));

    const chef = byChar(g.s, 'chef');
    nominate(g.s, chef.id, virgin.id, g.clock.advance(100));
    assert.equal(chef.alive, true);
  });
});

describe('the Slayer', () => {
  it('kills the Demon and wins the game for good', () => {
    const g = toNominations(['slayer', 'chef', 'soldier', 'poisoner', 'imp']);
    const imp = byChar(g.s, 'imp');
    slay(g.s, byChar(g.s, 'slayer').id, imp.id, g.clock.advance(100));
    assert.equal(imp.alive, false);
    assert.equal(g.s.winner, 'good');
  });

  it('does nothing to a non-Demon and is used up', () => {
    const g = toNominations(['slayer', 'chef', 'soldier', 'poisoner', 'imp']);
    const slayer = byChar(g.s, 'slayer');
    const poisoner = byChar(g.s, 'poisoner');
    slay(g.s, slayer.id, poisoner.id, g.clock.advance(100));
    assert.equal(poisoner.alive, true);
    assert.equal(slayer.slayerUsed, true);
    assert.match(logText(g.s), /Nothing happens/);
    assert.throws(
      () => slay(g.s, slayer.id, byChar(g.s, 'imp').id, g.clock.advance(100)),
      /already used/i,
    );
  });

  it('a poisoned Slayer cannot kill the Demon', () => {
    const g = mk(['slayer', 'chef', 'soldier', 'poisoner', 'imp']);
    const slayer = byChar(g.s, 'slayer');
    runNight(g, { poisoner: () => [slayer.id] });
    toDay(g);
    const imp = byChar(g.s, 'imp');
    slay(g.s, slayer.id, imp.id, g.clock.advance(100));
    assert.equal(imp.alive, true);
    assert.equal(g.s.winner, null);
  });

  it('a Drunk who thinks they are the Slayer shoots blanks', () => {
    const g = mk(['soldier', 'chef', 'recluse', 'poisoner', 'imp']);
    const drunk = byChar(g.s, 'soldier');
    drunk.character = 'drunk';
    drunk.perceived = 'slayer';
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);

    const imp = byChar(g.s, 'imp');
    slay(g.s, drunk.id, imp.id, g.clock.advance(100));
    assert.equal(imp.alive, true);
    assert.equal(g.s.winner, null);
  });
});

describe('ending the day', () => {
  it('executes whoever is on the block at dusk', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const [a, b, c, d] = alivePlayers(g.s);
    nominateAndVote(g, a.id, b.id, { [a.id]: true, [c.id]: true, [d.id]: true });
    assert.equal(g.s.onTheBlock, b.id);

    endDay(g);
    assert.equal(b.alive, false);
    assert.equal(g.s.executedToday, b.id);
    assert.match(logText(g.s), /is executed/);
  });

  it('ends with no execution when nobody is on the block', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    endDay(g);
    assert.equal(g.s.executionHappened, false);
    assert.match(logText(g.s), /No execution today/);
    assert.equal(alivePlayers(g.s).length, 5);
  });

  it('needs a majority of the living to end the day early', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const alive = alivePlayers(g.s);
    requestEndDay(g.s, alive[0].id, g.clock.advance(100));
    requestEndDay(g.s, alive[1].id, g.clock.advance(100));
    assert.equal(g.s.phase, 'nominations', 'two of five is not a majority');
    requestEndDay(g.s, alive[2].id, g.clock.advance(100));
    assert.equal(g.s.phase, 'dusk');
  });

  it('lets a player take back their request to end the day', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const alive = alivePlayers(g.s);
    requestEndDay(g.s, alive[0].id, g.clock.advance(100));
    assert.equal(g.s.endDayVotes.length, 1);
    requestEndDay(g.s, alive[0].id, g.clock.advance(100));
    assert.equal(g.s.endDayVotes.length, 0);
  });

  it('ends the day once every living player has nominated', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const alive = alivePlayers(g.s).slice();
    // Each of the 5 nominates a different player; after the 5th the day closes.
    for (let i = 0; i < alive.length; i++) {
      const nominee = alive[(i + 1) % alive.length];
      if (g.s.phase !== 'nominations') break;
      nominateAndVote(g, alive[i].id, nominee.id, {});
    }
    assert.ok(
      g.s.phase === 'dusk' || g.s.phase === 'night' || g.s.phase === 'over',
      `expected the day to be over, got ${g.s.phase}`,
    );
  });

  it('rolls into the next night', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    endDay(g);
    toNight(g);
    assert.equal(g.s.night, 2);
    assert.equal(g.s.phase, 'night');
  });
});

describe('win conditions', () => {
  it('good wins when the Demon is executed', () => {
    const g = toNominations(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const [a] = alivePlayers(g.s);
    const imp = byChar(g.s, 'imp');
    const voters = alivePlayers(g.s).filter((p) => p.id !== imp.id);
    nominateAndVote(
      g,
      a.id,
      imp.id,
      Object.fromEntries(voters.map((p) => [p.id, true])),
    );
    endDay(g);
    assert.equal(g.s.winner, 'good');
    assert.match(g.s.winReason!, /Demon is dead/);
  });

  it('evil wins when the Saint is executed', () => {
    const g = toNominations(['saint', 'empath', 'soldier', 'poisoner', 'imp']);
    const saint = byChar(g.s, 'saint');
    const voters = alivePlayers(g.s).filter((p) => p.id !== saint.id);
    nominateAndVote(
      g,
      voters[0].id,
      saint.id,
      Object.fromEntries(voters.map((p) => [p.id, true])),
    );
    endDay(g);
    assert.equal(g.s.winner, 'evil');
    assert.match(g.s.winReason!, /Saint/);
  });

  it('a poisoned Saint does not lose the game', () => {
    const g = mk(['saint', 'empath', 'soldier', 'poisoner', 'imp']);
    const saint = byChar(g.s, 'saint');
    runNight(g, { poisoner: () => [saint.id] });
    toDay(g);
    openNominations(g.s, byChar(g.s, 'empath').id, g.clock.advance(100));

    const voters = alivePlayers(g.s).filter((p) => p.id !== saint.id);
    nominateAndVote(
      g,
      voters[0].id,
      saint.id,
      Object.fromEntries(voters.map((p) => [p.id, true])),
    );
    endDay(g);
    assert.equal(saint.alive, false);
    assert.equal(g.s.winner, null);
  });

  it('a Saint killed at night does not lose the game', () => {
    const g = mk(['saint', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    const saint = byChar(g.s, 'saint');
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      imp: () => [saint.id],
    });
    assert.equal(saint.alive, false);
    assert.equal(g.s.winner, null, 'only execution triggers the Saint');
  });

  it('evil wins when two players remain', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    byChar(g.s, 'chef').alive = false;
    byChar(g.s, 'empath').alive = false;
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    // 3 alive; the Imp kills the Soldier's neighbour to get to 2.
    const soldier = byChar(g.s, 'soldier');
    soldier.character = 'chef'; // drop the immunity for this test
    soldier.perceived = 'chef';
    toDay(g);
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      imp: () => [soldier.id],
    });
    assert.equal(g.s.winner, 'evil');
    assert.match(g.s.winReason!, /two players remain/i);
  });

  it('the Mayor wins with three alive and no execution', () => {
    const g = mk(['mayor', 'empath', 'soldier', 'poisoner', 'imp']);
    byChar(g.s, 'empath').alive = false;
    byChar(g.s, 'soldier').alive = false;
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    openNominations(g.s, byChar(g.s, 'mayor').id, g.clock.advance(100));
    endDay(g);
    assert.equal(g.s.winner, 'good');
    assert.match(g.s.winReason!, /Mayor/);
  });

  it('a poisoned Mayor does not win on three alive', () => {
    const g = mk(['mayor', 'empath', 'soldier', 'poisoner', 'imp']);
    byChar(g.s, 'empath').alive = false;
    byChar(g.s, 'soldier').alive = false;
    runNight(g, { poisoner: () => [byChar(g.s, 'mayor').id] });
    toDay(g);
    openNominations(g.s, byChar(g.s, 'mayor').id, g.clock.advance(100));
    endDay(g);
    assert.equal(g.s.winner, null);
  });

  it('the Mayor does not win if an execution happened', () => {
    const g = mk(['mayor', 'empath', 'soldier', 'poisoner', 'imp']);
    const soldier = byChar(g.s, 'soldier');
    byChar(g.s, 'empath').alive = false;
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    openNominations(g.s, byChar(g.s, 'mayor').id, g.clock.advance(100));

    // 4 alive → 2 votes needed; execute the Soldier to reach 3 alive *with* an execution.
    const mayor = byChar(g.s, 'mayor');
    nominateAndVote(g, mayor.id, soldier.id, {
      [mayor.id]: true,
      [byChar(g.s, 'poisoner').id]: true,
      [byChar(g.s, 'imp').id]: true,
    });
    assert.equal(g.s.onTheBlock, soldier.id);
    endDay(g);
    assert.equal(soldier.alive, false);
    assert.equal(alivePlayers(g.s).length, 3);
    assert.equal(g.s.winner, null, 'an execution blocks the Mayor win');
  });
});
