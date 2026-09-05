import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { beginNight, slay, submitNightChoice, tick } from '../game/engine.js';
import { livingNeighbours } from '../game/info.js';
import { playerById } from '../game/types.js';
import { answerNight, byChar, infoText, mk, runNight, seat, toDay } from './helpers.js';

describe('night order', () => {
  it('wakes choosing characters in official order on later nights', () => {
    const g = mk(['monk', 'fortuneteller', 'butler', 'poisoner', 'imp']);
    runNight(g); // night 1
    toDay(g);

    const order: string[] = [];
    beginNight(g.s, g.clock.advance(1000));
    let guard = 0;
    while (g.s.pending && guard++ < 50) {
      order.push(g.s.pending.character!);
      const pending = g.s.pending;
      const targets = pending.choices
        .filter((c) => !c.disabled)
        .slice(0, pending.count)
        .map((c) => c.playerId);
      submitNightChoice(g.s, pending.playerId, pending.id, targets, g.clock.advance(100));
    }

    // Poisoner 7, Monk 12, Imp 32, Fortune Teller 43, Butler 46
    assert.deepEqual(order, ['poisoner', 'monk', 'imp', 'fortuneteller', 'butler']);
  });

  it('does not wake the Imp or Monk on the first night', () => {
    const g = mk(['monk', 'chef', 'butler', 'poisoner', 'imp']);
    const woken: string[] = [];
    beginNight(g.s, g.clock.advance(1000));
    let guard = 0;
    while (g.s.pending && guard++ < 50) {
      woken.push(g.s.pending.character!);
      const pending = g.s.pending;
      submitNightChoice(
        g.s,
        pending.playerId,
        pending.id,
        pending.choices.filter((c) => !c.disabled).slice(0, pending.count).map((c) => c.playerId),
        g.clock.advance(100),
      );
    }
    assert.deepEqual(woken, ['poisoner', 'butler']);
  });

  it('wakes the Drunk on their believed character schedule', () => {
    const g = mk(['soldier', 'chef', 'recluse', 'poisoner', 'imp']);
    const drunk = seat(g.s, 0);
    drunk.character = 'drunk';
    drunk.perceived = 'monk';
    drunk.alignment = 'good';

    runNight(g); // night 1: monk does not act
    toDay(g);

    beginNight(g.s, g.clock.advance(1000));
    const seen: string[] = [];
    let guard = 0;
    while (g.s.pending && guard++ < 50) {
      seen.push(`${g.s.pending.character}:${g.s.pending.playerId}`);
      const p = g.s.pending;
      submitNightChoice(
        g.s,
        p.playerId,
        p.id,
        p.choices.filter((c) => !c.disabled).slice(0, p.count).map((c) => c.playerId),
        g.clock.advance(100),
      );
    }
    assert.ok(
      seen.some((x) => x === `monk:${drunk.id}`),
      'the Drunk should be woken as the Monk',
    );
  });

  it('auto-resolves a night prompt when the player runs out of time', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    beginNight(g.s, g.clock.advance(1000));
    assert.equal(g.s.pending?.character, 'poisoner');

    tick(g.s, g.clock.advance(200_000));
    assert.equal(g.s.pending, null, 'prompt should have been auto-answered');
    assert.equal(g.s.phase, 'dawn');
    assert.ok(g.s.players.some((p) => p.poisoned), 'someone should have been poisoned');
  });
});

describe('information roles', () => {
  it('Chef counts adjacent pairs of evil players', () => {
    // Seats: 0 chef, 1 poisoner(evil), 2 imp(evil), 3 soldier, 4 empath
    const g = mk(['chef', 'poisoner', 'imp', 'soldier', 'empath']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    assert.match(infoText(g.s, byChar(g.s, 'chef').id), /Chef: 1 pair/);
  });

  it('Chef reports 0 when evil players are separated', () => {
    const g = mk(['chef', 'poisoner', 'soldier', 'imp', 'empath']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    assert.match(infoText(g.s, byChar(g.s, 'chef').id), /Chef: 0 pairs/);
  });

  it('Chef counts three adjacent evils as two pairs', () => {
    const g = mk(['chef', 'poisoner', 'baron', 'imp', 'soldier', 'empath', 'monk']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    assert.match(infoText(g.s, byChar(g.s, 'chef').id), /Chef: 2 pairs/);
  });

  it('Empath counts evil among the two nearest living neighbours', () => {
    // Seats: 0 poisoner(evil), 1 empath, 2 imp(evil), ...
    const g = mk(['poisoner', 'empath', 'imp', 'soldier', 'chef']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    assert.match(infoText(g.s, byChar(g.s, 'empath').id), /Empath: 2 of your 2/);
  });

  it('Empath skips over the dead when finding neighbours', () => {
    const g = mk(['soldier', 'empath', 'chef', 'imp', 'poisoner']);
    const chef = byChar(g.s, 'chef');
    chef.alive = false;
    const [left, right] = livingNeighbours(g.s, byChar(g.s, 'empath'));
    assert.equal(left!.character, 'soldier');
    assert.equal(right!.character, 'imp', 'should skip the dead Chef');
  });

  it('Washerwoman points at a real Townsfolk', () => {
    const g = mk(['washerwoman', 'chef', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    const ww = byChar(g.s, 'washerwoman');
    const entry = ww.log.find((e) => e.title === 'Washerwoman')!;
    assert.ok(entry, 'washerwoman got no info');
    assert.ok(['chef', 'soldier'].includes(entry.character!), `saw ${entry.character}`);
    assert.equal(entry.players!.length, 2);
    const real = entry.players!.map((id) => playerById(g.s, id)!.character);
    assert.ok(real.includes(entry.character!), 'one of the two must really be that character');
  });

  it('Investigator points at a real Minion', () => {
    const g = mk(['investigator', 'chef', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    const entry = byChar(g.s, 'investigator').log.find((e) => e.title === 'Investigator')!;
    assert.equal(entry.character, 'poisoner');
    assert.ok(entry.players!.includes(byChar(g.s, 'poisoner').id));
  });

  it('Librarian reports zero when there are no Outsiders', () => {
    const g = mk(['librarian', 'chef', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    assert.match(infoText(g.s, byChar(g.s, 'librarian').id), /no Outsiders in play/);
  });

  it('Librarian points at a real Outsider when one exists', () => {
    const g = mk(['librarian', 'saint', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    const entry = byChar(g.s, 'librarian').log.find((e) => e.title === 'Librarian')!;
    assert.equal(entry.character, 'saint');
  });

  it('Fortune Teller says yes for the Demon and for the red herring', () => {
    const g = mk(['fortuneteller', 'chef', 'soldier', 'poisoner', 'imp']);
    const ft = byChar(g.s, 'fortuneteller');
    const imp = byChar(g.s, 'imp');
    const chef = byChar(g.s, 'chef');
    const soldier = byChar(g.s, 'soldier');
    chef.redHerring = true;

    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      fortuneteller: () => [imp.id, soldier.id],
    });
    assert.match(infoText(g.s, ft.id), /YES/);

    toDay(g);
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      fortuneteller: () => [chef.id, soldier.id],
      imp: () => [soldier.id],
    });
    const lines = ft.log.filter((e) => e.title === 'Fortune Teller');
    assert.match(lines[1].body, /YES/, 'the red herring must register as the Demon');
  });

  it('Fortune Teller says no for two ordinary good players', () => {
    const g = mk(['fortuneteller', 'chef', 'soldier', 'poisoner', 'imp']);
    const chef = byChar(g.s, 'chef');
    const soldier = byChar(g.s, 'soldier');
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      fortuneteller: () => [chef.id, soldier.id],
    });
    assert.match(infoText(g.s, byChar(g.s, 'fortuneteller').id), /NO/);
  });

  it('the Spy sees every character in the grimoire', () => {
    const g = mk(['chef', 'saint', 'soldier', 'spy', 'imp']);
    runNight(g);
    const text = infoText(g.s, byChar(g.s, 'spy').id);
    for (const name of ['Chef', 'Saint', 'Soldier', 'Spy', 'Imp']) {
      assert.match(text, new RegExp(name), `grimoire missing ${name}`);
    }
  });

  it('Minions learn the Demon and the Demon learns their Minions plus bluffs', () => {
    const g = mk(['chef', 'soldier', 'poisoner', 'baron', 'imp', 'empath', 'monk']);
    runNight(g, { poisoner: () => [byChar(g.s, 'chef').id] });

    const poisonerInfo = infoText(g.s, byChar(g.s, 'poisoner').id);
    assert.match(poisonerInfo, /Your Demon is/);
    assert.match(poisonerInfo, /Baron/);

    const demonInfo = infoText(g.s, byChar(g.s, 'imp').id);
    assert.match(demonInfo, /Minions are|Minion is/);
    assert.match(demonInfo, /safe bluffs/);
  });
});

describe('night actions', () => {
  it('the Imp kills its target', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    const chef = byChar(g.s, 'chef');
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      imp: () => [chef.id],
    });
    assert.equal(chef.alive, false);
    assert.ok(g.s.pendingDeaths.includes(chef.id));
  });

  it('the Soldier survives the Imp', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    const soldier = byChar(g.s, 'soldier');
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      imp: () => [soldier.id],
    });
    assert.equal(soldier.alive, true);
  });

  it('a poisoned Soldier dies to the Imp', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    const soldier = byChar(g.s, 'soldier');
    runNight(g, {
      poisoner: () => [soldier.id],
      imp: () => [soldier.id],
    });
    assert.equal(soldier.alive, false);
  });

  it('the Monk protects its target from the Imp', () => {
    const g = mk(['monk', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    const empath = byChar(g.s, 'empath');
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      monk: () => [empath.id],
      imp: () => [empath.id],
    });
    assert.equal(empath.alive, true);
  });

  it('a poisoned Monk protects nobody', () => {
    const g = mk(['monk', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    const monk = byChar(g.s, 'monk');
    const empath = byChar(g.s, 'empath');
    runNight(g, {
      poisoner: () => [monk.id],
      monk: () => [empath.id],
      imp: () => [empath.id],
    });
    assert.equal(empath.alive, false);
  });

  it('a poisoned Imp fails to kill', () => {
    const g = mk(['monk', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    const imp = byChar(g.s, 'imp');
    const empath = byChar(g.s, 'empath');
    runNight(g, {
      poisoner: () => [imp.id],
      monk: () => [byChar(g.s, 'soldier').id],
      imp: () => [empath.id],
    });
    assert.equal(empath.alive, true);
  });

  it('poison lasts through the next day and clears at the following dusk', () => {
    const g = mk(['monk', 'empath', 'soldier', 'poisoner', 'imp']);
    const empath = byChar(g.s, 'empath');
    runNight(g, { poisoner: () => [empath.id] });
    assert.equal(empath.poisoned, true, 'poisoned during the night');
    toDay(g);
    assert.equal(empath.poisoned, true, 'still poisoned through the day');

    beginNight(g.s, g.clock.advance(1000));
    assert.equal(empath.poisoned, false, 'poison clears as the next night begins');
    answerNight(g, { poisoner: () => [byChar(g.s, 'soldier').id] });
  });

  it('the Ravenkeeper wakes only when killed at night, and learns a character', () => {
    const g = mk(['ravenkeeper', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    const rk = byChar(g.s, 'ravenkeeper');
    assert.equal(rk.log.length, 0, 'no Ravenkeeper wake on night 1');

    toDay(g);
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      imp: () => [rk.id],
      ravenkeeper: () => [byChar(g.s, 'imp').id],
    });
    assert.equal(rk.alive, false);
    assert.match(infoText(g.s, rk.id), /is the Imp/);
  });

  it('a Ravenkeeper killed by execution does not wake', () => {
    const g = mk(['ravenkeeper', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    const rk = byChar(g.s, 'ravenkeeper');
    rk.alive = false; // as if executed during the day
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      imp: () => [byChar(g.s, 'empath').id],
    });
    assert.equal(rk.log.length, 0);
  });

  it('the Undertaker learns the executed player and nothing on a quiet day', () => {
    const g = mk(['undertaker', 'empath', 'saint', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);

    const ut = byChar(g.s, 'undertaker');
    g.s.executedToday = byChar(g.s, 'poisoner').id;
    byChar(g.s, 'poisoner').alive = false;

    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      imp: () => [byChar(g.s, 'empath').id],
    });
    assert.match(infoText(g.s, ut.id), /was executed today. They were the Poisoner/);
  });

  it('the Mayor can bounce a night death onto someone else', () => {
    const g = mk(['mayor', 'empath', 'soldier', 'poisoner', 'imp'], {
      mayorBounceChance: 1,
    });
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    const mayor = byChar(g.s, 'mayor');
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      imp: () => [mayor.id],
    });
    assert.equal(mayor.alive, true, 'the Mayor should have bounced the kill');
    assert.equal(g.s.pendingDeaths.length, 1, 'somebody else died instead');
    assert.notEqual(g.s.pendingDeaths[0], mayor.id);
  });

  it('the Butler records their master each night', () => {
    const g = mk(['butler', 'empath', 'soldier', 'poisoner', 'imp']);
    const empath = byChar(g.s, 'empath');
    runNight(g, {
      poisoner: () => [byChar(g.s, 'poisoner').id],
      butler: () => [empath.id],
    });
    assert.equal(byChar(g.s, 'butler').butlerMaster, empath.id);
  });

  it('the Butler cannot pick themselves', () => {
    const g = mk(['butler', 'empath', 'soldier', 'poisoner', 'imp']);
    beginNight(g.s, g.clock.advance(1000));
    // Poisoner first
    submitNightChoice(
      g.s,
      g.s.pending!.playerId,
      g.s.pending!.id,
      [byChar(g.s, 'poisoner').id],
      g.clock.advance(100),
    );
    const butler = byChar(g.s, 'butler');
    assert.equal(g.s.pending?.playerId, butler.id);
    const selfChoice = g.s.pending!.choices.find((c) => c.playerId === butler.id)!;
    assert.equal(selfChoice.disabled, true);
    assert.throws(
      () => submitNightChoice(g.s, butler.id, g.s.pending!.id, [butler.id]),
      /not a valid choice/i,
    );
  });
});

describe('demon succession', () => {
  it('star-passing hands the Imp to a Minion regardless of player count', () => {
    const g = mk(['chef', 'empath', 'soldier', 'scarletwoman', 'imp']);
    runNight(g);
    toDay(g);
    const imp = byChar(g.s, 'imp');
    const sw = byChar(g.s, 'scarletwoman');

    runNight(g, { imp: () => [imp.id] });
    assert.equal(imp.alive, false);
    assert.equal(sw.character, 'imp', 'the Minion should have become the Imp');
    assert.equal(g.s.winner, null, 'good must not win while a Demon lives');
  });

  it('the Scarlet Woman takes over when the Demon is killed with 5+ alive', () => {
    const g = mk(['slayer', 'empath', 'soldier', 'scarletwoman', 'imp', 'monk']);
    runNight(g);
    toDay(g);
    assert.equal(g.s.phase, 'day');

    const sw = byChar(g.s, 'scarletwoman');
    const imp = byChar(g.s, 'imp');
    slay(g.s, byChar(g.s, 'slayer').id, imp.id, g.clock.advance(100));

    assert.equal(imp.alive, false);
    assert.equal(sw.character, 'imp', 'Scarlet Woman should inherit the Demon');
    assert.equal(g.s.winner, null, 'good must not win — a Demon still lives');
  });

  it('the Scarlet Woman does not take over below 5 alive', () => {
    const g = mk(['slayer', 'empath', 'soldier', 'scarletwoman', 'imp', 'monk']);
    byChar(g.s, 'empath').alive = false;
    byChar(g.s, 'soldier').alive = false;
    byChar(g.s, 'monk').alive = false; // 3 alive
    runNight(g);
    toDay(g);

    const sw = byChar(g.s, 'scarletwoman');
    slay(g.s, byChar(g.s, 'slayer').id, byChar(g.s, 'imp').id, g.clock.advance(100));

    assert.equal(sw.character, 'scarletwoman');
    assert.equal(g.s.winner, 'good');
  });

  it('a poisoned Scarlet Woman does not take over', () => {
    const g = mk(['slayer', 'empath', 'poisoner', 'scarletwoman', 'imp', 'monk']);
    const sw = byChar(g.s, 'scarletwoman');
    runNight(g, { poisoner: () => [sw.id] });
    toDay(g);
    assert.equal(sw.poisoned, true, 'poison must still be active during the day');

    slay(g.s, byChar(g.s, 'slayer').id, byChar(g.s, 'imp').id, g.clock.advance(100));
    assert.equal(sw.character, 'scarletwoman');
    assert.equal(g.s.winner, 'good');
  });

  it('the Imp dies for good when it star-passes with no Minions left', () => {
    const g = mk(['chef', 'empath', 'soldier', 'poisoner', 'imp']);
    runNight(g, { poisoner: () => [byChar(g.s, 'poisoner').id] });
    toDay(g);
    byChar(g.s, 'poisoner').alive = false;
    const imp = byChar(g.s, 'imp');
    runNight(g, { imp: () => [imp.id] });
    assert.equal(imp.alive, false);
    assert.equal(g.s.winner, 'good');
  });
});
