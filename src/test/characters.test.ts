import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import { useSlayer } from '../game/engine.js';
import {
  chefInfo, demonInfo, empathInfo, fortuneTellerInfo, investigativeInfo,
  minionInfo, ravenkeeperInfo, spyInfo, undertakerInfo,
} from '../game/info.js';
import { advanceUntil, answerRealTurn, byChar, mk, mkDay, runFullNight, startNight } from './helpers.js';

// This file covers every Trouble Brewing character's core ability at least once. Several
// characters (Virgin, Slayer's hit/miss, Butler's vote restriction, Scarlet Woman's promotion,
// Saint, Baron's setup split, Drunk's fake turn, Recluse/Spy misregistration in general) already
// have dedicated coverage in day.test.ts / night.test.ts / win.test.ts / setup.test.ts /
// registration.test.ts — this file fills in what those didn't touch, and is organized one
// character at a time for easy scanning.

function assertInvestigativeInfoIsGrounded(state: ReturnType<typeof mk>, msg: string, team: 'townsfolk' | 'outsider' | 'minion') {
  const match = msg.match(/^(.+) or (.+) is the (.+)\.$/);
  assert.ok(match, `unexpected message format: ${msg}`);
  const [, nameA, nameB, claimedChar] = match;
  const candidates = [nameA, nameB].map((n) => state.players.find((p) => p.name === n));
  const real = candidates.find((p) => p && CHARACTERS[p.character].team === team && CHARACTERS[p.character].name === claimedChar);
  assert.ok(real, `expected one of ${nameA}/${nameB} to really be the ${claimedChar}`);
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
  const msg = investigativeInfo(s, lib, 'outsider', 'lib-slot-2');
  assert.match(msg, /no Outsiders/i);
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
  assert.match(chefInfo(s, chef, 'chef-slot'), /^You see 1 pair of evil players/);
});

test('Chef: counts zero pairs when no two evil players are adjacent', () => {
  const s = mk(['chef', 'imp', 'empath', 'poisoner', 'soldier']); // evils (imp, poisoner) separated by goods
  const chef = byChar(s, 'chef');
  assert.match(chefInfo(s, chef, 'chef-slot-2'), /^You see 0 pairs of evil players/);
});

test('Empath: counts evil among living neighbours, skipping a dead seat for the next living one', () => {
  const s = mk(['empath', 'imp', 'soldier', 'poisoner', 'washerwoman']); // seats 0..4
  const empath = byChar(s, 'empath');
  const imp = byChar(s, 'imp');
  assert.match(empathInfo(s, empath, 'empath-slot-1'), /^1 of your 2 alive neighbours is evil\.$/);

  imp.alive = false; // empath's right-hand neighbour dies; soldier (good) is next living
  assert.match(empathInfo(s, empath, 'empath-slot-2'), /^0 of your 2 alive neighbours are evil\.$/);
});

test('Fortune Teller: detects the real Demon, and the red herring always reads as one too', () => {
  const s = mk(['imp', 'fortuneteller', 'empath', 'soldier', 'washerwoman']);
  const ft = byChar(s, 'fortuneteller');
  const imp = byChar(s, 'imp');
  const empath = byChar(s, 'empath');
  const soldier = byChar(s, 'soldier');

  assert.match(fortuneTellerInfo(s, ft, [imp.id, empath.id], 'ft-1'), /^Yes/);
  assert.match(fortuneTellerInfo(s, ft, [empath.id, soldier.id], 'ft-2'), /^No/);

  empath.isRedHerring = true;
  assert.match(fortuneTellerInfo(s, ft, [empath.id, soldier.id], 'ft-3'), /^Yes/);
});

test('Undertaker: learns the true character of whoever was executed, or that nobody was', () => {
  const s = mk(['imp', 'undertaker', 'chef', 'soldier', 'washerwoman']);
  const undertaker = byChar(s, 'undertaker');
  const chef = byChar(s, 'chef');
  assert.equal(undertakerInfo(s, undertaker, chef, 'ut-slot'), `${chef.name} was the Chef.`);
  assert.equal(undertakerInfo(s, undertaker, null, 'ut-slot-2'), 'Nobody was executed today.');
});

test('Ravenkeeper: learns the true character of whoever they choose', () => {
  const s = mk(['imp', 'ravenkeeper', 'chef', 'soldier', 'washerwoman']);
  const rk = byChar(s, 'ravenkeeper');
  const chef = byChar(s, 'chef');
  assert.equal(ravenkeeperInfo(s, rk, chef.id, 'rk-slot'), `${chef.name} is the Chef.`);
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
  const msg = spyInfo(s, spy, 'spy-slot');
  for (const p of s.players) assert.ok(msg.includes(`${p.name}: ${CHARACTERS[p.character].name}`), msg);
});

test('Minions: learn their fellow Minions and the Demon', () => {
  const s = mk(['imp', 'poisoner', 'spy', 'empath', 'soldier']);
  const poisoner = byChar(s, 'poisoner');
  const spy = byChar(s, 'spy');
  const imp = byChar(s, 'imp');
  const msg = minionInfo(s, poisoner);
  assert.ok(msg.includes(spy.name) && msg.includes(imp.name), msg);
});

test('Imp: learns their Minions and bluffs on the first night', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.bluffs = ['mayor', 'virgin', 'saint'];
  const imp = byChar(s, 'imp');
  const poisoner = byChar(s, 'poisoner');
  const msg = demonInfo(s, imp);
  assert.ok(msg.includes(poisoner.name), msg);
  assert.ok(msg.includes('Mayor') && msg.includes('Virgin') && msg.includes('Saint'), msg);
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
  assert.ok(newImp!.log.some((e) => e.text.includes('You are now the Imp')));
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
