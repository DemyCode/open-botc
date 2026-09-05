import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BUZZ } from '../game/buzz.js';
import { addPlayer, beginNight, createGame, startGame } from '../game/engine.js';
import { registersAs } from '../game/registration.js';
import { viewFor } from '../game/view.js';
import { byChar, mk, runNight, toDay } from './helpers.js';

describe('view isolation', () => {
  it('never reveals another player\'s character while the game runs', () => {
    const s = createGame('TEST');
    for (let i = 0; i < 10; i++) addPlayer(s, `P${i}`);
    startGame(s, s.hostId);

    for (const viewer of s.players) {
      const view = viewFor(s, viewer.id);
      for (const row of view.players) {
        if (row.id === viewer.id) continue;
        assert.equal(row.character, undefined, 'leaked a character');
        assert.equal(row.perceived, undefined, 'leaked a perceived character');
        assert.equal(row.alignment, undefined, 'leaked an alignment');
      }
      assert.equal(view.grimoire, null, 'grimoire must stay hidden mid-game');
    }
  });

  it('shows a player only their own believed character', () => {
    const g = mk(['soldier', 'chef', 'recluse', 'poisoner', 'imp']);
    const drunk = byChar(g.s, 'soldier');
    drunk.character = 'drunk';
    drunk.perceived = 'empath';

    const view = viewFor(g.s, drunk.id);
    assert.equal(view.self.character, 'empath', 'the Drunk must believe the lie');
    assert.equal(view.self.team, 'townsfolk');
    assert.ok(!JSON.stringify(view).includes('"drunk"'), 'the view leaks the Drunk');
  });

  it('does not reveal who is being woken during the night', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    const poisoner = byChar(g.s, 'poisoner');
    runNightUntilFirstPrompt(g);
    assert.equal(g.s.pending?.playerId, poisoner.id);

    for (const viewer of g.s.players) {
      const view = viewFor(g.s, viewer.id);
      if (viewer.id === poisoner.id) {
        assert.ok(view.prompt, 'the acting player must get their prompt');
        assert.equal(view.nightWaiting, false);
      } else {
        assert.equal(view.prompt, null, 'leaked a prompt to a bystander');
        assert.equal(view.nightWaiting, true);
      }
    }
  });

  it('hides private information logs from everyone else', () => {
    const g = mk(['washerwoman', 'chef', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    const ww = byChar(g.s, 'washerwoman');
    assert.ok(ww.log.length > 0);

    const otherView = viewFor(g.s, byChar(g.s, 'chef').id);
    assert.ok(
      !otherView.self.log.some((e) => e.title === 'Washerwoman'),
      "another player can read the Washerwoman's info",
    );
  });

  it('hides vote values until the vote resolves', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    g.s.phase = 'voting';
    g.s.nomination = {
      nominatorId: g.s.players[0].id,
      nomineeId: g.s.players[1].id,
      stage: 'voting',
      votes: { [g.s.players[0].id]: true },
      voteOrder: g.s.players.map((p) => p.id),
      voteIndex: -1,
    };
    const view = viewFor(g.s, g.s.players[2].id);
    const voter = view.players.find((p) => p.id === g.s.players[0].id)!;
    assert.equal(voter.hasVoted, true, 'a raised hand is visible');
    assert.equal(voter.vote, undefined, 'but the value is not, until the count');
  });

  it('reveals the full grimoire once the game is over', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    byChar(g.s, 'imp').alive = false;
    // Force the end state the way a win would.
    g.s.finalGrimoire = true;
    g.s.phase = 'over';
    g.s.winner = 'good';

    const view = viewFor(g.s, byChar(g.s, 'chef').id);
    assert.ok(view.grimoire);
    assert.equal(view.grimoire!.length, 5);
    assert.ok(view.grimoire!.some((r) => r.character === 'imp'));
    assert.ok(view.players.every((p) => p.character));
  });
});

/** beginNight runs the night until it needs an answer. */
function runNightUntilFirstPrompt(g: ReturnType<typeof mk>) {
  beginNight(g.s, g.clock.advance(1000));
}

describe('misregistration', () => {
  it('the Recluse can look like the Demon but never like a Townsfolk', () => {
    const g = mk(['recluse', 'chef', 'soldier', 'poisoner', 'imp'], {
      recluseMisregisterChance: 1,
    });
    const recluse = byChar(g.s, 'recluse');
    const ctx = { asker: 'x', night: 1 };
    assert.equal(registersAs(g.s, recluse, 'demon', ctx), true);
    assert.equal(registersAs(g.s, recluse, 'minion', ctx), true);
    assert.equal(registersAs(g.s, recluse, 'evil', ctx), true);
    assert.equal(registersAs(g.s, recluse, 'townsfolk', ctx), false);
  });

  it('the Recluse registers honestly when the roll says so', () => {
    const g = mk(['recluse', 'chef', 'soldier', 'poisoner', 'imp'], {
      recluseMisregisterChance: 0,
    });
    const recluse = byChar(g.s, 'recluse');
    const ctx = { asker: 'x', night: 1 };
    assert.equal(registersAs(g.s, recluse, 'demon', ctx), false);
    assert.equal(registersAs(g.s, recluse, 'outsider', ctx), true);
    assert.equal(registersAs(g.s, recluse, 'good', ctx), true);
  });

  it('the Spy can look good but never like the Demon', () => {
    const g = mk(['spy', 'chef', 'soldier', 'poisoner', 'imp'], {
      spyMisregisterChance: 1,
    });
    const spy = byChar(g.s, 'spy');
    const ctx = { asker: 'x', night: 1 };
    assert.equal(registersAs(g.s, spy, 'townsfolk', ctx), true);
    assert.equal(registersAs(g.s, spy, 'good', ctx), true);
    assert.equal(registersAs(g.s, spy, 'minion', ctx), false);
    assert.equal(registersAs(g.s, spy, 'demon', ctx), false, 'the Spy is never the Demon');
  });

  it('gives the same answer to the same question twice in one night', () => {
    const g = mk(['recluse', 'chef', 'soldier', 'poisoner', 'imp'], {
      recluseMisregisterChance: 0.5,
    });
    const recluse = byChar(g.s, 'recluse');
    const ctx = { asker: 'ft1', night: 3, slot: 'a' };
    const first = registersAs(g.s, recluse, 'demon', ctx);
    for (let i = 0; i < 20; i++) {
      assert.equal(registersAs(g.s, recluse, 'demon', ctx), first);
    }
  });

  it('an ordinary player is unaffected by the misregistration dials', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp'], {
      recluseMisregisterChance: 1,
      spyMisregisterChance: 1,
    });
    const chef = byChar(g.s, 'chef');
    const imp = byChar(g.s, 'imp');
    const ctx = { asker: 'x', night: 1 };
    assert.equal(registersAs(g.s, chef, 'townsfolk', ctx), true);
    assert.equal(registersAs(g.s, chef, 'evil', ctx), false);
    assert.equal(registersAs(g.s, imp, 'demon', ctx), true);
  });
});

describe('buzzing discipline', () => {
  it('vibrates only to wake someone who cannot otherwise be reached', () => {
    const waking = (Object.keys(BUZZ) as (keyof typeof BUZZ)[]).filter((k) => BUZZ[k].wake);
    assert.deepEqual(
      waking.sort(),
      ['dawn', 'info', 'transform', 'turn'],
      'the set of waking events changed — is the new one really waking someone?',
    );
  });

  it('stays silent through the whole day, when everyone is awake', () => {
    for (const k of ['nomination', 'vote', 'speech', 'voteresult', 'death'] as const) {
      assert.equal(BUZZ[k].wake, false, `${k} happens in daylight and must not buzz`);
    }
  });

  it('emits no buzz at all for silent events', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);

    const kinds = g.s.outbox
      .filter((e): e is Extract<typeof e, { k: 'buzz' }> => e.k === 'buzz')
      .map((e) => e.tag);
    assert.ok(kinds.length > 0, 'a night should buzz somebody');
    for (const k of kinds) {
      assert.ok(
        BUZZ[k as keyof typeof BUZZ]?.wake,
        `"${k}" reached a phone but is marked silent`,
      );
    }
  });

  it('does not buzz for the reveal, nightfall or the game ending', () => {
    for (const k of ['reveal', 'night', 'gameover'] as const) {
      assert.equal(BUZZ[k].wake, false, `${k} should not disturb a phone`);
    }
  });

  it('every waking pattern is distinct, so they can be told apart blind', () => {
    const shapes = Object.values(BUZZ)
      .filter((b) => b.wake)
      .map((b) => JSON.stringify(b.pattern));
    assert.equal(new Set(shapes).size, shapes.length, 'two waking buzzes feel the same');
  });
});
