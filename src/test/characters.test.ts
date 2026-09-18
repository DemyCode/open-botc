import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allCharactersSummary, CHARACTERS, TEAM_DISPLAY_ORDER } from '../game/characters.js';
import { useSlayer } from '../game/engine.js';
import {
  chefInfo, demonInfo, empathInfo, fortuneTellerInfo, investigativeInfo,
  minionInfo, ravenkeeperInfo, spyInfo, undertakerInfo,
} from '../game/info.js';
import type { Msg } from '../game/types.js';
import { advanceUntil, answerRealTurn, byChar, mk, mkDay, runFullNight, startNight } from './helpers.js';

// This file covers every Trouble Brewing character's core ability at least once. Several
// characters (Virgin, Slayer's hit/miss, Butler's vote restriction, Scarlet Woman's promotion,
// Saint, Baron's setup split, Drunk's fake turn, Recluse/Spy misregistration in general) already
// have dedicated coverage in day.test.ts / night.test.ts / win.test.ts / setup.test.ts /
// registration.test.ts — this file fills in what those didn't touch, and is organized one
// character at a time for easy scanning.

function assertInvestigativeInfoIsGrounded(state: ReturnType<typeof mk>, m: Msg, team: 'townsfolk' | 'outsider' | 'minion') {
  assert.equal(m.key, 'investigativeInfo', `unexpected message key: ${m.key}`);
  const { a: nameA, b: nameB, role } = m.vars as { a: string; b: string; role: string };
  const candidates = [nameA, nameB].map((n) => state.players.find((p) => p.name === n));
  const real = candidates.find((p) => p && CHARACTERS[p.character].team === team && p.character === role);
  assert.ok(real, `expected one of ${nameA}/${nameB} to really be the ${role}`);
}

test('Washerwoman: names two players, one of whom really is a Townsfolk of the stated character', () => {
  const s = mk(['imp', 'washerwoman', 'chef', 'soldier', 'poisoner']);
  const ww = byChar(s, 'washerwoman');
  assertInvestigativeInfoIsGrounded(s, investigativeInfo(s, ww, 'townsfolk', 'ww-slot'), 'townsfolk');
});

test('Librarian: names a real Outsider when one is in play', () => {
  const s = mk(['imp', 'librarian', 'butler', 'chef', 'poisoner']);
  const lib = byChar(s, 'librarian');
  assertInvestigativeInfoIsGrounded(s, investigativeInfo(s, lib, 'outsider', 'lib-slot'), 'outsider');
});

test('Librarian: truthfully reports no Outsiders when none are in play', () => {
  const s = mk(['imp', 'librarian', 'chef', 'soldier', 'poisoner']);
  const lib = byChar(s, 'librarian');
  const m = investigativeInfo(s, lib, 'outsider', 'lib-slot-2');
  assert.equal(m.key, 'noTeamInPlay');
  assert.equal(m.vars?.team, 'outsider');
});

test('Investigator: names two players, one of whom really is the stated Minion', () => {
  const s = mk(['imp', 'investigator', 'poisoner', 'chef', 'soldier']);
  const inv = byChar(s, 'investigator');
  assertInvestigativeInfoIsGrounded(s, investigativeInfo(s, inv, 'minion', 'inv-slot'), 'minion');
});

test('Chef: correctly counts adjacent evil pairs around the table', () => {
  // Seat order: imp, poisoner, chef, empath, soldier, washerwoman — imp/poisoner sit together (1 pair).
  const s = mk(['imp', 'poisoner', 'chef', 'empath', 'soldier', 'washerwoman']);
  const chef = byChar(s, 'chef');
  assert.deepEqual(chefInfo(s, chef, 'chef-slot'), { key: 'chefInfo', vars: { count: 1 } });
});

test('Chef: counts zero pairs when no two evil players are adjacent', () => {
  const s = mk(['chef', 'imp', 'empath', 'poisoner', 'soldier']); // evils (imp, poisoner) separated by goods
  const chef = byChar(s, 'chef');
  assert.deepEqual(chefInfo(s, chef, 'chef-slot-2'), { key: 'chefInfo', vars: { count: 0 } });
});

test('Empath: counts evil among living neighbours, skipping a dead seat for the next living one', () => {
  const s = mk(['empath', 'imp', 'soldier', 'poisoner', 'washerwoman']); // seats 0..4
  const empath = byChar(s, 'empath');
  const imp = byChar(s, 'imp');
  assert.deepEqual(empathInfo(s, empath, 'empath-slot-1'), { key: 'empathInfo', vars: { count: 1 } });

  imp.alive = false; // empath's right-hand neighbour dies; soldier (good) is next living
  assert.deepEqual(empathInfo(s, empath, 'empath-slot-2'), { key: 'empathInfo', vars: { count: 0 } });
});

test('Fortune Teller: detects the real Demon, and the red herring always reads as one too', () => {
  const s = mk(['imp', 'fortuneteller', 'empath', 'soldier', 'washerwoman']);
  const ft = byChar(s, 'fortuneteller');
  const imp = byChar(s, 'imp');
  const empath = byChar(s, 'empath');
  const soldier = byChar(s, 'soldier');

  assert.equal(fortuneTellerInfo(s, ft, [imp.id, empath.id], 'ft-1').key, 'fortuneTellerYes');
  assert.equal(fortuneTellerInfo(s, ft, [empath.id, soldier.id], 'ft-2').key, 'fortuneTellerNo');

  empath.isRedHerring = true;
  assert.equal(fortuneTellerInfo(s, ft, [empath.id, soldier.id], 'ft-3').key, 'fortuneTellerYes');
});

test('Undertaker: learns the true character of whoever was executed', () => {
  const s = mk(['imp', 'undertaker', 'chef', 'soldier', 'washerwoman']);
  const undertaker = byChar(s, 'undertaker');
  const chef = byChar(s, 'chef');
  assert.deepEqual(undertakerInfo(s, undertaker, chef, 'ut-slot'), { key: 'undertakerInfo', vars: { name: chef.name, role: 'chef' } });
});

test('Ravenkeeper: learns the true character of whoever they choose', () => {
  const s = mk(['imp', 'ravenkeeper', 'chef', 'soldier', 'washerwoman']);
  const rk = byChar(s, 'ravenkeeper');
  const chef = byChar(s, 'chef');
  assert.deepEqual(ravenkeeperInfo(s, rk, chef.id, 'rk-slot'), { key: 'ravenkeeperInfo', vars: { name: chef.name, role: 'chef' } });
});

test('Monk: a working protection fully blocks the Demon, and no death is registered at all', () => {
  const s = mk(['imp', 'monk', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  startNight(s); // night 1 — Monk has no first-night action
  runFullNight(s);
  startNight(s); // night 2
  const monk = byChar(s, 'monk');
  const empath = byChar(s, 'empath');
  advanceUntil(s, 'monk');
  answerRealTurn(s, [empath.id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [empath.id]);
  assert.equal(empath.alive, true, 'a Monk-protected player should survive the Demon');
  assert.equal(s.deathsTonight.length, 0, 'a blocked kill should not register as a death at all');
});

test('Soldier: immune to a healthy Demon kill', () => {
  const s = mk(['imp', 'soldier', 'poisoner', 'empath', 'washerwoman']);
  startNight(s);
  runFullNight(s);
  startNight(s); // night 2 — the Imp can actually kill
  const soldier = byChar(s, 'soldier');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [soldier.id]);
  assert.equal(soldier.alive, true, 'a healthy Soldier should survive a Demon kill');
});

test('Soldier: a poisoned Soldier is not immune', () => {
  const s = mk(['imp', 'soldier', 'poisoner', 'empath', 'washerwoman']);
  startNight(s);
  runFullNight(s);
  startNight(s); // night 2
  const soldier = byChar(s, 'soldier');
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [soldier.id]);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [soldier.id]);
  assert.equal(soldier.alive, false, 'a poisoned Soldier should not be immune');
});

test('Mayor: the Demon\'s kill redirects to someone else instead', () => {
  const s = mk(['imp', 'mayor', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  startNight(s);
  runFullNight(s);
  startNight(s); // night 2
  const mayor = byChar(s, 'mayor');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [mayor.id]);
  assert.equal(mayor.alive, true, 'a working Mayor should not die directly from the Demon');
  assert.equal(s.deathsTonight.length, 1, 'someone else should die instead');
  assert.notEqual(s.deathsTonight[0], mayor.id);
});

test('Poisoner: may target themselves', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  startNight(s);
  const poisoner = byChar(s, 'poisoner');
  advanceUntil(s, 'poisoner');
  answerRealTurn(s, [poisoner.id]);
  assert.equal(s.poisonedId, poisoner.id);
});

test("Butler: their night choice sets who their vote depends on the next day", () => {
  const s = mk(['imp', 'butler', 'empath', 'soldier', 'washerwoman']);
  startNight(s);
  const butler = byChar(s, 'butler');
  const empath = byChar(s, 'empath');
  advanceUntil(s, 'butler');
  answerRealTurn(s, [empath.id]);
  assert.equal(s.butlerMasterId, empath.id);
});

test('Spy: sees the true, full grimoire when unpoisoned', () => {
  const s = mk(['imp', 'spy', 'chef', 'soldier']);
  const spy = byChar(s, 'spy');
  const m = spyInfo(s, spy, 'spy-slot');
  assert.equal(m.key, 'spyGrimoire');
  assert.deepEqual(m.vars?.names, s.players.map((p) => p.name));
  assert.deepEqual(m.vars?.roles, s.players.map((p) => p.character));
});

test('Minions: learn their fellow Minions and the Demon', () => {
  const s = mk(['imp', 'poisoner', 'spy', 'empath', 'soldier']);
  const poisoner = byChar(s, 'poisoner');
  const spy = byChar(s, 'spy');
  const imp = byChar(s, 'imp');
  const m = minionInfo(s, poisoner);
  assert.equal(m.key, 'minionInfoGroup');
  assert.ok((m.vars?.names as string[]).includes(spy.name));
  assert.equal(m.vars?.demon, imp.name);
});

test('Imp: learns their Minions and bluffs on the first night', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.bluffs = ['mayor', 'virgin', 'saint'];
  const imp = byChar(s, 'imp');
  const poisoner = byChar(s, 'poisoner');
  const m = demonInfo(s, imp);
  assert.equal(m.key, 'demonInfo');
  assert.deepEqual(m.vars?.names, [poisoner.name]);
  assert.deepEqual(m.vars?.bluffs, ['mayor', 'virgin', 'saint']);
});

test('Imp: star-pass kills the Imp themselves and promotes a random Minion to Imp', () => {
  const s = mk(['imp', 'poisoner', 'spy', 'empath', 'soldier', 'washerwoman']);
  startNight(s);
  runFullNight(s);
  startNight(s); // night 2 — the Imp can now choose to self-target
  const imp = byChar(s, 'imp');
  advanceUntil(s, 'imp');
  answerRealTurn(s, [imp.id]);

  assert.equal(imp.alive, false, 'the original Imp should die from the star-pass');
  const newImp = s.players.find((p) => p.character === 'imp' && p.alive);
  assert.ok(newImp, 'a new, living Imp should exist after the star-pass');
  assert.notEqual(newImp!.id, imp.id);
  assert.ok(newImp!.log.some((e) => e.msg.key === 'becameImp'));
});

test('Recluse: can be legitimately killed by the Slayer when misregistering as the Demon', () => {
  let found = false;
  for (let seed = 0; seed < 500 && !found; seed++) {
    const s = mkDay(['imp', 'slayer', 'recluse', 'empath', 'soldier']);
    s.secret = `recluse-slayer-seed-${seed}`;
    const slayer = byChar(s, 'slayer');
    const recluse = byChar(s, 'recluse');
    useSlayer(s, slayer.id, recluse.id);
    if (!recluse.alive) {
      found = true;
      assert.equal(s.winner, null, 'killing a Recluse (not the real Demon) should not itself end the game');
    }
  }
  assert.ok(found, 'expected the Recluse to misregister as the Demon within 500 seeds');
});

test('allCharactersSummary lists all 22 Trouble Brewing characters, grouped by team, each with a real ability', () => {
  const summary = allCharactersSummary();
  assert.equal(summary.length, 22);
  assert.equal(new Set(summary.map((c) => c.id)).size, 22, 'no duplicate characters');

  for (const c of summary) {
    assert.equal(c.name, CHARACTERS[c.id].name);
    assert.equal(c.team, CHARACTERS[c.id].team);
    assert.ok(c.ability.length > 0, `${c.id} should have non-empty ability text`);
  }

  // Grouped by team, in the fixed good-then-evil display order (never interleaved).
  const teamIndices = summary.map((c) => TEAM_DISPLAY_ORDER.indexOf(c.team));
  const sorted = teamIndices.slice().sort((a, b) => a - b);
  assert.deepEqual(teamIndices, sorted, 'characters should be grouped by team in TEAM_DISPLAY_ORDER');
});
