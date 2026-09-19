// Every "Examples" entry from the official wiki page of each Trouble Brewing character
// (https://wiki.bloodontheclocktower.com/Trouble_Brewing and the 22 character pages), as a test.
//
// Two kinds of example:
//  * Deterministic ones ("The Imp attacks the Soldier. Nobody dies.") are checked directly.
//  * Storyteller-choice ones ("The Storyteller decides that the Recluse registers as the Imp" /
//    "the poisoned Empath learns a 0") are checked by searching for a game secret where this
//    game's Storyteller (the engine) makes exactly that choice — proving the outcome can happen
//    — and, where useful, that no *illegal* outcome ever does.
//
// Examples that only work with Travellers or characters outside Trouble Brewing are translated
// to the closest Trouble Brewing equivalent (the test says so), or skipped with the reason.
import assert from 'node:assert/strict';
import { poison } from './helpers.js';
import { test } from 'node:test';
import { CHARACTERS } from '../game/characters.js';
import { addPlayer, createGame, declareNeighbor, nominate, skipSpeech, startGame, useSlayer } from '../game/engine.js';
import { chefInfo, empathInfo, fortuneTellerInfo, investigativeInfo } from '../game/info.js';
import { abilityWorks } from '../game/registration.js';
import { dealCharacters } from '../game/setup.js';
import type { CharacterId, GameState, PlayerState } from '../game/types.js';
import { GameError } from '../game/types.js';
import {
  answerRealTurn, byChar, endDayByConsensus, fastForwardToVote, markAllReady, runFullNight, skipRound, startNight, voteInOrder,
} from './helpers.js';
import { afterNight1, execute, findSecret, lastInfo, mk, mkDay, named, night, pairOf, playSteps, untilStep } from './wikiHelpers.js';

// ================================================================ WASHERWOMAN

// 1. "Evin is the Chef, and Amy is the Ravenkeeper. The Washerwoman learns that either Evin or Amy is the Chef."
test('Washerwoman ex. 1 — Evin (Chef) and Amy (Ravenkeeper): learns "Evin or Amy is the Chef"', () => {
  const build = (secret: string) => {
    const s = named(mk(['washerwoman', 'chef', 'ravenkeeper', 'imp', 'poisoner']), ['Wanda', 'Evin', 'Amy', 'Ian', 'Paul']);
    s.secret = secret;
    return { s, msg: investigativeInfo(s, s.players[0], 'townsfolk', 'ww') };
  };
  findSecret((secret) => {
    const { msg } = build(secret);
    return msg.key === 'investigativeInfo' && msg.vars!.role === 'chef' && JSON.stringify(pairOf(msg)) === JSON.stringify(['Amy', 'Evin']);
  }, 'Evin or Amy is the Chef');
  // And it is never a lie: one of the two really is the named Townsfolk.
  for (let i = 0; i < 200; i++) {
    const { s, msg } = build(`ww1-${i}`);
    const named2 = [msg.vars!.a, msg.vars!.b].map((n) => s.players.find((p) => p.name === n)!);
    assert.ok(named2.some((p) => p.character === msg.vars!.role));
  }
});

// 2. "Julian is the Imp, and Alex is the Virgin. The Washerwoman learns that either Julian or Alex is the Virgin."
test('Washerwoman ex. 2 — Julian (Imp) and Alex (Virgin): learns "Julian or Alex is the Virgin"', () => {
  for (let i = 0; i < 50; i++) {
    const s = named(mk(['washerwoman', 'imp', 'virgin']), ['Wanda', 'Julian', 'Alex']);
    s.secret = `ww2-${i}`;
    const msg = investigativeInfo(s, s.players[0], 'townsfolk', 'ww');
    assert.deepEqual(pairOf(msg), ['Alex', 'Julian']);
    assert.equal(msg.vars!.role, 'virgin');
  }
});

// 3. "Marianna is the Spy, and Sarah is the Scarlet Woman. The Washerwoman learns that one of them is the
//    Ravenkeeper. Here, the Spy is registering as a Townsfolk—in this case, the Ravenkeeper."
test('Washerwoman ex. 3 — Marianna (Spy) and Sarah (Scarlet Woman): the Spy registers as a Townsfolk', () => {
  const secret = findSecret((sec) => {
    const s = named(mk(['washerwoman', 'spy', 'scarletwoman']), ['Wanda', 'Marianna', 'Sarah']);
    s.secret = sec;
    const msg = investigativeInfo(s, s.players[0], 'townsfolk', 'ww');
    return msg.key === 'investigativeInfo' && JSON.stringify(pairOf(msg)) === JSON.stringify(['Marianna', 'Sarah']);
  }, 'the Spy shown as a Townsfolk');
  const s = named(mk(['washerwoman', 'spy', 'scarletwoman']), ['Wanda', 'Marianna', 'Sarah']);
  s.secret = secret;
  const msg = investigativeInfo(s, s.players[0], 'townsfolk', 'ww');
  assert.equal(CHARACTERS[msg.vars!.role as CharacterId].team, 'townsfolk', 'the character shown is a Townsfolk');
  assert.ok(![...pairOf(msg)].includes('Wanda'));
});

// ================================================================ LIBRARIAN

// 1. "Benjamin is the Saint, and Filip is the Baron. The Librarian learns that either Benjamin or Filip is the Saint."
test('Librarian ex. 1 — Benjamin (Saint) and Filip (Baron): learns "Benjamin or Filip is the Saint"', () => {
  for (let i = 0; i < 50; i++) {
    const s = named(mk(['librarian', 'saint', 'baron']), ['Lena', 'Benjamin', 'Filip']);
    s.secret = `lib1-${i}`;
    const msg = investigativeInfo(s, s.players[0], 'outsider', 'lib');
    assert.deepEqual(pairOf(msg), ['Benjamin', 'Filip']);
    assert.equal(msg.vars!.role, 'saint');
  }
});

// 2. "There are no Outsiders in this game. The Librarian learns a '0'."
test('Librarian ex. 2 — no Outsiders in play: learns that there are none (shown as a 0)', () => {
  for (let i = 0; i < 50; i++) {
    const s = mk(['librarian', 'imp', 'poisoner', 'chef', 'soldier']);
    s.secret = `lib2-${i}`;
    const msg = investigativeInfo(s, s.players[0], 'outsider', 'lib');
    assert.equal(msg.key, 'noTeamInPlay');
    assert.equal(msg.vars!.team, 'outsider');
  }
});

// 3. "Abdallah is the Drunk, who thinks they are the Monk, and Douglas is the Undertaker. The Librarian learns that
//    either Abdallah or Douglas is the Drunk. (The Librarian learns the true character.)"
test('Librarian ex. 3 — Abdallah (the Drunk, who thinks they are the Monk): learns the TRUE character, the Drunk', () => {
  for (let i = 0; i < 50; i++) {
    const s = named(mk(['librarian', 'drunk', 'undertaker'], { drunkFakeChar: 'monk' }), ['Lena', 'Abdallah', 'Douglas']);
    s.secret = `lib3-${i}`;
    const msg = investigativeInfo(s, s.players[0], 'outsider', 'lib');
    assert.deepEqual(pairOf(msg), ['Abdallah', 'Douglas']);
    assert.equal(msg.vars!.role, 'drunk', 'not the Monk they believe they are');
  }
});

// ================================================================ INVESTIGATOR

// 1. "Amy is the Baron, and Julian is the Mayor. The Investigator learns that either Amy or Julian is the Baron."
test('Investigator ex. 1 — Amy (Baron) and Julian (Mayor): learns "Amy or Julian is the Baron"', () => {
  for (let i = 0; i < 50; i++) {
    const s = named(mk(['investigator', 'baron', 'mayor']), ['Ines', 'Amy', 'Julian']);
    s.secret = `inv1-${i}`;
    const msg = investigativeInfo(s, s.players[0], 'minion', 'inv');
    assert.deepEqual(pairOf(msg), ['Amy', 'Julian']);
    assert.equal(msg.vars!.role, 'baron');
  }
});

// 2. "Angelus is the Spy, and Lewis is the Poisoner. The Investigator learns that either Angelus or Lewis is the Spy."
test('Investigator ex. 2 — Angelus (Spy) and Lewis (Poisoner): "Angelus or Lewis is the Spy" is possible, and never names anyone else', () => {
  const roles = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const s = named(mk(['investigator', 'spy', 'poisoner']), ['Ines', 'Angelus', 'Lewis']);
    s.secret = `inv2-${i}`;
    const msg = investigativeInfo(s, s.players[0], 'minion', 'inv');
    assert.deepEqual(pairOf(msg), ['Angelus', 'Lewis']);
    roles.add(String(msg.vars!.role));
  }
  assert.ok(roles.has('spy'), 'the wiki\'s outcome: "either Angelus or Lewis is the Spy"');
  assert.deepEqual([...roles].sort(), ['poisoner', 'spy'], 'and only ever one of the two real Minions');
});

// 3. "Brianna is the Recluse, and Marianna is the Imp. The Investigator learns that either Brianna or Marianna is the
//    Poisoner. (The Recluse is registering as a Minion—in this case, the Poisoner.)"
test('Investigator ex. 3 — Brianna (Recluse) and Marianna (Imp): the Recluse registers as the Poisoner', () => {
  findSecret((sec) => {
    const s = named(mk(['investigator', 'recluse', 'imp']), ['Ines', 'Brianna', 'Marianna']);
    s.secret = sec;
    const msg = investigativeInfo(s, s.players[0], 'minion', 'inv');
    return msg.key === 'investigativeInfo' && msg.vars!.role === 'poisoner' && JSON.stringify(pairOf(msg)) === JSON.stringify(['Brianna', 'Marianna']);
  }, 'Brianna or Marianna is the Poisoner');
});

// ================================================================ CHEF

const seatedChef = (chars: CharacterId[], chefIndex: number, secret = 'chef') => {
  const s = mk(chars);
  s.secret = secret;
  return { s, count: () => (chefInfo(s, s.players[chefIndex], 'chef').vars as { count: number }).count };
};

// 1. "No evil players are sitting next to each other. The Chef learns a '0'."
test('Chef ex. 1 — no evil players next to each other: 0', () => {
  const { count } = seatedChef(['chef', 'imp', 'soldier', 'poisoner', 'mayor', 'baron', 'monk'], 0);
  assert.equal(count(), 0);
});

// 2. "The Imp is sitting next to the Baron. Across the circle, the Poisoner is sitting next to the Scarlet Woman. The Chef learns a '2'."
test('Chef ex. 2 — Imp next to the Baron, Poisoner next to the Scarlet Woman: 2', () => {
  const { count } = seatedChef(['imp', 'baron', 'empath', 'chef', 'poisoner', 'scarletwoman', 'soldier', 'monk'], 3);
  assert.equal(count(), 2);
});

// 3. "An evil Scapegoat is sitting between the Imp and a Minion. Across the circle, two other Minions are sitting
//    next to each other. The Chef learns a '3'."   [Scapegoat is a Traveller: translated to a Minion, the Baron]
test('Chef ex. 3 (translated: the evil Scapegoat is the Baron) — Imp, Baron, Scarlet Woman in a row, and two Minions elsewhere: 3', () => {
  // seats: 0 Imp, 1 Baron, 2 Scarlet Woman | 3 Chef, 4 Soldier | 5 Poisoner, 6 Spy | 7 Monk, 8 Mayor
  const layout: CharacterId[] = ['imp', 'baron', 'scarletwoman', 'chef', 'soldier', 'poisoner', 'spy', 'monk', 'mayor'];
  let three = false;
  for (let i = 0; i < 200; i++) {
    const { count } = seatedChef(layout, 3, `chef3-${i}`);
    const c = count();
    assert.ok(c === 2 || c === 3, `Imp–Baron–Scarlet Woman are 2 pairs; the Spy pair adds 1 only if the Spy registers as evil (got ${c})`);
    if (c === 3) three = true;
  }
  assert.ok(three, 'the Chef can learn a 3');
});

// 4. "The Recluse is sitting between the Imp and the Poisoner. The Chef learns a '1'. Here, the Recluse is registering
//    as evil for the Imp-Recluse pair, but as good for the Poisoner-Recluse pair."
test('Chef ex. 4 — the Recluse between the Imp and the Poisoner: 1, the Recluse evil for one pair and good for the other', () => {
  const counts = new Set<number>();
  for (let i = 0; i < 300; i++) {
    const { count } = seatedChef(['imp', 'recluse', 'poisoner', 'chef', 'soldier', 'mayor'], 3, `chef4-${i}`);
    counts.add(count());
  }
  assert.ok(counts.has(1), 'the wiki\'s outcome: a 1');
  assert.deepEqual([...counts].sort(), [0, 1, 2], 'and 0 or 2 are possible too (evil for both pairs, or for neither)');
});

// ================================================================ EMPATH

// 1. "The Empath neighbours two good players—a Soldier and a Monk. The Empath learns a '0'."
test('Empath ex. 1 — neighbours a Soldier and a Monk: 0', () => {
  const s = mk(['soldier', 'empath', 'monk', 'imp', 'poisoner']);
  assert.equal((empathInfo(s, s.players[1], 'e').vars as { count: number }).count, 0);
});

// 2. "The next day, the Soldier is executed. That night, the Monk is killed by the Imp. The Empath now detects the
//    players sitting next to the Soldier and the Monk, which are a Librarian and an evil Gunslinger. The Empath now learns a '1'."
//    [the Gunslinger is a Traveller: translated to an evil Minion, the Poisoner]
test('Empath ex. 2 (translated: the evil Gunslinger is the Poisoner) — the neighbours die, so the Empath now detects the players beyond them: 1', () => {
  // seats: 0 Poisoner, 1 Soldier, 2 Empath, 3 Monk, 4 Librarian, 5 Imp, 6 Washerwoman
  const s = mk(['poisoner', 'soldier', 'empath', 'monk', 'librarian', 'imp', 'washerwoman']);
  const [poisoner, soldier, empath, monk] = s.players;
  startNight(s);
  runFullNight(s);
  assert.equal((lastInfo(empath).vars as { count: number }).count, 0, 'night 1: two good neighbours');
  execute(s, s.players[6], soldier); // the next day, the Soldier is executed
  assert.equal(soldier.alive, false);
  playSteps(s, { poisoner: ['poisoner'], monk: ['washerwoman'], imp: ['monk'] }); // that night, the Monk is killed by the Imp
  assert.equal(monk.alive, false);
  assert.equal((lastInfo(empath).vars as { count: number }).count, 1, 'the evil Poisoner on one side, the Librarian on the other');
  void poisoner;
});

// 3. "There are only three players left alive: the Empath, the Imp, and the Baron. No matter who is seated where, the Empath learns a '2'."
test('Empath ex. 3 — only the Empath, the Imp and the Baron are alive: always 2, whoever sits where', () => {
  const perms: CharacterId[][] = [['empath', 'imp', 'baron'], ['empath', 'baron', 'imp'], ['imp', 'empath', 'baron'], ['imp', 'baron', 'empath'], ['baron', 'empath', 'imp'], ['baron', 'imp', 'empath']];
  for (const layout of perms) {
    const s = mk(layout);
    const empath = byChar(s, 'empath');
    assert.equal((empathInfo(s, empath, 'e').vars as { count: number }).count, 2, layout.join(','));
  }
  // The same when they are the last three of a bigger table, with the dead sitting between them.
  const s = mk(['empath', 'soldier', 'imp', 'chef', 'baron', 'monk']);
  for (const i of [1, 3, 5]) s.players[i].alive = false;
  assert.equal((empathInfo(s, s.players[0], 'e').vars as { count: number }).count, 2);
});

// ================================================================ FORTUNE TELLER

const ft = (chars: CharacterId[], redHerringIndex: number | null = null) => {
  const s = mk(chars);
  if (redHerringIndex !== null) s.players[redHerringIndex].isRedHerring = true;
  return { s, ask: (a: PlayerState, b: PlayerState) => fortuneTellerInfo(s, s.players[0], [a.id, b.id], 'ft').key };
};

// 1. "The Fortune Teller chooses the Monk and the Undertaker and learns a 'no'."
test('Fortune Teller ex. 1 — chooses the Monk and the Undertaker: no', () => {
  const { s, ask } = ft(['fortuneteller', 'monk', 'undertaker', 'imp', 'chef', 'poisoner'], 4);
  assert.equal(ask(byChar(s, 'monk'), byChar(s, 'undertaker')), 'fortuneTellerNo');
});

// 2. "The Fortune Teller chooses the Imp and the Empath, and learns a 'yes'."
test('Fortune Teller ex. 2 — chooses the Imp and the Empath: yes', () => {
  const { s, ask } = ft(['fortuneteller', 'imp', 'empath', 'chef', 'poisoner'], 3);
  assert.equal(ask(byChar(s, 'imp'), byChar(s, 'empath')), 'fortuneTellerYes');
});

// 3. "The Fortune Teller chooses an alive Butler and a dead Imp, and learns a 'yes'."
test('Fortune Teller ex. 3 — an alive Butler and a DEAD Imp: yes (a dead Demon still reads as the Demon)', () => {
  const { s, ask } = ft(['fortuneteller', 'butler', 'imp', 'poisoner', 'chef', 'soldier'], 4);
  const imp = byChar(s, 'imp');
  imp.alive = false;
  byChar(s, 'poisoner').character = 'imp'; // (the game goes on with a new Imp, as after a Scarlet-Woman / star-pass)
  assert.equal(ask(byChar(s, 'butler'), imp), 'fortuneTellerYes');
});

// 4. "The Fortune Teller chooses themselves and a Saint. The Saint is the Red Herring. The Fortune Teller learns a 'yes'."
test('Fortune Teller ex. 4 — chooses themselves and the Saint, who is the Red Herring: yes', () => {
  const { s, ask } = ft(['fortuneteller', 'saint', 'imp', 'poisoner', 'chef'], 1);
  assert.equal(ask(s.players[0], byChar(s, 'saint')), 'fortuneTellerYes');
});

// ================================================================ UNDERTAKER

const undertakerNight = (layout: CharacterId[], opts: Parameters<typeof mk>[1], execute_: (s: GameState) => void, secret?: string): GameState => {
  const s = mk(layout, opts);
  if (secret) s.secret = secret;
  startNight(s);
  runFullNight(s);
  execute_(s);
  return s;
};

// 1. "The Mayor is executed today. That night, the Undertaker is shown the Mayor token."
test('Undertaker ex. 1 — the Mayor is executed: the Undertaker is shown the Mayor', () => {
  const s = undertakerNight(['imp', 'undertaker', 'mayor', 'soldier', 'poisoner', 'chef'], {}, (g) => execute(g, byChar(g, 'chef'), byChar(g, 'mayor')));
  untilStep(s, 'undertaker', 'soldier');
  assert.equal(lastInfo(byChar(s, 'undertaker')).vars!.role, 'mayor');
});

// 2. "The Drunk, who thinks they are the Virgin, is executed today. At night, the Undertaker is shown the Drunk token,
//    because the Undertaker learns a player's true character, as opposed to the one they believe they are."
test('Undertaker ex. 2 — the Drunk (who thinks they are the Virgin) is executed: shown the Drunk, the true character', () => {
  const s = undertakerNight(['imp', 'undertaker', 'drunk', 'soldier', 'poisoner', 'chef'], { drunkFakeChar: 'virgin' }, (g) => execute(g, byChar(g, 'chef'), byChar(g, 'drunk')));
  untilStep(s, 'undertaker', 'soldier');
  assert.equal(lastInfo(byChar(s, 'undertaker')).vars!.role, 'drunk');
});

// 3. "The Spy is executed. Two Travellers are exiled. That night, the Undertaker is shown the Butler token, because the
//    Spy is registering as the Butler, and because the exiles are not executions."   [Travellers: only the Spy part is testable]
test('Undertaker ex. 3 (Travellers left out) — the Spy is executed: the Undertaker can be shown the Butler', () => {
  const roles = new Set<string>();
  findSecret((sec) => {
    const s = undertakerNight(['imp', 'undertaker', 'spy', 'butler', 'soldier', 'chef', 'poisoner'], {}, (g) => execute(g, byChar(g, 'chef'), byChar(g, 'spy')), sec);
    untilStep(s, 'undertaker', 'soldier');
    const role = String(lastInfo(byChar(s, 'undertaker')).vars!.role);
    roles.add(role);
    return role === 'butler';
  }, 'the Spy shown as the Butler');
  for (const r of roles) assert.ok(r === 'spy' || ['townsfolk', 'outsider'].includes(CHARACTERS[r as CharacterId].team), `${r} is what a Spy can register as`);
});
test('Undertaker ex. 3 (the Travellers part) — exiles are not executions', { skip: 'Travellers (exile) do not exist in this app' }, () => {});

// 4. "Nobody was executed today. That night, the Undertaker does not wake."
test('Undertaker ex. 4 — nobody was executed: the Undertaker does not wake', () => {
  const s = undertakerNight(['imp', 'undertaker', 'soldier', 'poisoner', 'chef', 'empath'], {}, (g) => endDayByConsensus(g));
  const steps: string[] = [];
  while (s.pendingRealTurn) {
    steps.push(s.pendingRealTurn.charId);
    if (s.pendingRealTurn.charId === 'imp') answerRealTurn(s, [byChar(s, 'soldier').id]); // (the Imp must not kill the Undertaker first)
    else skipRound(s);
  }
  assert.equal(byChar(s, 'undertaker').alive, true, 'the Undertaker is alive: they were skipped, not killed');
  assert.ok(steps.includes('imp') && steps.includes('empath'), `the night did run: ${steps.join(', ')}`);
  assert.ok(!steps.includes('undertaker'), `the steps were: ${steps.join(', ')}`);
  assert.ok(!byChar(s, 'undertaker').log.some((e) => e.night === 2), 'and they learn nothing');
});

// ================================================================ MONK

const LAYOUT = (extra: CharacterId[]): CharacterId[] => ['imp', 'monk', 'poisoner', ...extra];

// 1. "The Monk protects the Fortune Teller. The Imp attacks the Fortune Teller. No deaths occur tonight."
test('Monk ex. 1 — protects the Fortune Teller, the Imp attacks them: nobody dies', () => {
  const s = afterNight1(LAYOUT(['fortuneteller', 'soldier', 'chef']));
  night(s, { monk: ['fortuneteller'], imp: ['fortuneteller'] });
  assert.equal(byChar(s, 'fortuneteller').alive, true);
  assert.deepEqual(s.deathsTonight, []);
  assert.equal(s.publicLog.at(-1)!.key, 'nobodyDiedLastNight');
});

// 2. "The Monk protects the Mayor, and the Imp attacks the Mayor. The Mayor's 'another player dies' ability does not
//    trigger, because the Mayor is safe from the Imp. Nobody dies tonight."
test('Monk ex. 2 — protects the Mayor, the Imp attacks the Mayor: the Mayor\'s bounce does not trigger, nobody dies', () => {
  const s = afterNight1(LAYOUT(['mayor', 'washerwoman', 'chef']));
  night(s, { monk: ['mayor'], imp: ['mayor'] });
  assert.ok(s.players.every((p) => p.alive));
});

// 3. "The Monk protects the Imp. The Imp chooses to kill themself tonight, but nothing happens. The Imp stays alive
//    and a new Imp is not created."
test('Monk ex. 3 — protects the Imp, who tries to kill themselves: nothing happens, no new Imp', () => {
  const s = afterNight1(LAYOUT(['washerwoman', 'chef', 'empath']));
  night(s, { monk: ['imp'], imp: ['imp'] });
  assert.equal(byChar(s, 'imp').alive, true);
  assert.equal(s.players.filter((p) => p.character === 'imp').length, 1);
  assert.equal(byChar(s, 'poisoner').character, 'poisoner', 'no Minion became the Imp');
});

// ================================================================ RAVENKEEPER

// 1. "The Ravenkeeper is killed by the Imp, and then wakes to choose a player. After some deliberation, they choose
//    Benjamin. Benjamin is the Empath, and the Ravenkeeper learns this."
test('Ravenkeeper ex. 1 — killed by the Imp, chooses Benjamin (the Empath): learns Empath', () => {
  const s = named(afterNight1(['imp', 'ravenkeeper', 'empath', 'poisoner', 'soldier', 'chef']), ['Ian', 'Rita', 'Benjamin', 'Paul', 'Sol', 'Chuck']);
  night(s, { imp: ['ravenkeeper'], ravenkeeper: ['empath'] });
  assert.equal(byChar(s, 'ravenkeeper').alive, false);
  assert.deepEqual(byChar(s, 'ravenkeeper').nightResult, { key: 'ravenkeeperInfo', vars: { name: 'Benjamin', role: 'empath' } });
});

// 2. "The Imp attacks the Mayor. The Mayor doesn't die, but the Ravenkeeper dies instead, due to the Mayor's ability.
//    The Ravenkeeper is woken and chooses Douglas, who is a dead Recluse. The Ravenkeeper learns that Douglas is the
//    Scarlet Woman, since the Recluse registered as a Minion."
test('Ravenkeeper ex. 2 — the Mayor bounce kills the Ravenkeeper, who looks at a dead Recluse and is told "Scarlet Woman"', () => {
  findSecret((sec) => {
    // 0 Imp, 1 Mayor, 2 Soldier (immune), 3 Ravenkeeper, 4 Douglas the (dead) Recluse, 5 the (dead) Scarlet Woman
    const s = named(afterNight1(['imp', 'mayor', 'soldier', 'ravenkeeper', 'recluse', 'scarletwoman']), ['Ian', 'Mae', 'Sol', 'Rita', 'Douglas', 'Sarah']);
    s.secret = sec;
    byChar(s, 'recluse').alive = false;
    byChar(s, 'scarletwoman').alive = false;
    night(s, { imp: ['mayor'], ravenkeeper: ['recluse'] });
    assert.equal(byChar(s, 'mayor').alive, true, 'the Mayor does not die');
    assert.equal(byChar(s, 'ravenkeeper').alive, false, 'the Ravenkeeper dies instead');
    return byChar(s, 'ravenkeeper').nightResult?.vars?.role === 'scarletwoman';
  }, 'the dead Recluse registering as the Scarlet Woman');
});

// ================================================================ VIRGIN

// 1. "The Washerwoman nominates the Virgin. The Washerwoman is immediately executed and the day ends."
test('Virgin ex. 1 — the Washerwoman nominates the Virgin: executed at once, and the day ends', () => {
  const s = mkDay(['imp', 'virgin', 'washerwoman', 'poisoner', 'soldier']);
  nominate(s, byChar(s, 'washerwoman').id, byChar(s, 'virgin').id);
  assert.equal(byChar(s, 'washerwoman').alive, false);
  assert.equal(s.phase, 'night', 'the day is over');
  assert.equal(s.currentNomination, null);
});

// 2. "The Drunk, who thinks they are the Chef, nominates the Virgin. The Drunk remains alive, and the Virgin loses
//    their ability. Players may now vote on whether or not to execute the Virgin. (The Drunk is not a Townsfolk.)"
test('Virgin ex. 2 — the Drunk (who thinks they are the Chef) nominates the Virgin: nobody dies, the Virgin loses the ability, the vote goes ahead', () => {
  const s = mk(['imp', 'virgin', 'drunk', 'poisoner', 'soldier'], { drunkFakeChar: 'chef' });
  s.phase = 'day'; s.day = 1; s.night = 1;
  nominate(s, byChar(s, 'drunk').id, byChar(s, 'virgin').id);
  assert.equal(byChar(s, 'drunk').alive, true);
  assert.equal(byChar(s, 'virgin').virginUsed, true, 'the Virgin has lost their ability');
  assert.ok(s.currentNomination, 'the nomination goes on');
  fastForwardToVote(s);
  assert.equal(s.currentNomination!.state, 'voting', 'and players may now vote');
});

// 3. "A dead player nominates the Virgin. The dead, however, cannot nominate. The Storyteller declares that the
//    nomination does not count. The Virgin does not lose their ability."
test('Virgin ex. 3 — a dead player tries to nominate the Virgin: refused, and the Virgin keeps the ability', () => {
  const s = mkDay(['imp', 'virgin', 'washerwoman', 'poisoner', 'soldier']);
  byChar(s, 'washerwoman').alive = false;
  assert.throws(() => nominate(s, byChar(s, 'washerwoman').id, byChar(s, 'virgin').id), GameError);
  assert.equal(s.currentNomination, null, 'the nomination does not count');
  assert.equal(byChar(s, 'virgin').virginUsed, false, 'the Virgin keeps their ability');
});

// ================================================================ SLAYER

// 1. "The Slayer chooses the Imp. The Imp dies, and good wins!"
test('Slayer ex. 1 — chooses the Imp: the Imp dies, good wins', () => {
  const s = mkDay(['imp', 'slayer', 'poisoner', 'soldier', 'chef']);
  useSlayer(s, byChar(s, 'slayer').id, byChar(s, 'imp').id);
  assert.equal(byChar(s, 'imp').alive, false);
  assert.equal(s.winner, 'good');
});

// 2. "The Slayer chooses the Recluse. The Storyteller decides that the Recluse registers as the Imp, so the Recluse
//    dies, but the game continues."
test('Slayer ex. 2 — chooses the Recluse, who registers as the Imp: the Recluse dies, the game continues', () => {
  findSecret((sec) => {
    const s = mkDay(['imp', 'slayer', 'recluse', 'poisoner', 'soldier', 'chef']);
    s.secret = sec;
    useSlayer(s, byChar(s, 'slayer').id, byChar(s, 'recluse').id);
    if (byChar(s, 'recluse').alive) return false;
    assert.equal(s.winner, null, 'the game continues');
    assert.equal(byChar(s, 'imp').alive, true);
    return true;
  }, 'the Recluse registering as the Imp');
});

// 3. "The Imp is bluffing as the Slayer. They declare that they use their Slayer ability on the Scarlet Woman. Nothing happens."
test('Slayer ex. 3 — the Imp, bluffing as the Slayer, shoots the Scarlet Woman: nothing happens', () => {
  const s = mkDay(['imp', 'scarletwoman', 'slayer', 'soldier', 'chef']);
  useSlayer(s, byChar(s, 'imp').id, byChar(s, 'scarletwoman').id);
  assert.ok(s.players.every((p) => p.alive));
  assert.equal(s.publicLog.at(-1)!.key, 'slayerMiss');
  assert.equal(s.winner, null);
});

// ================================================================ SOLDIER

// 1. "The Imp attacks the Soldier. The Soldier does not die, so nobody dies that night."
test('Soldier ex. 1 — the Imp attacks the Soldier: nobody dies', () => {
  const s = afterNight1(['imp', 'soldier', 'poisoner', 'chef', 'washerwoman']);
  night(s, { imp: ['soldier'] });
  assert.deepEqual(s.deathsTonight, []);
});

// 2. "The Poisoner poisons the Soldier, then the Imp attacks the Soldier. The Soldier dies, since they have no ability."
test('Soldier ex. 2 — the Poisoner poisons the Soldier, then the Imp attacks: the Soldier dies', () => {
  const s = afterNight1(['imp', 'soldier', 'poisoner', 'chef', 'washerwoman']);
  night(s, { poisoner: ['soldier'], imp: ['soldier'] });
  assert.equal(byChar(s, 'soldier').alive, false);
});

// 3. "The Imp attacks the Soldier. The Soldier dies, because they are actually the Drunk."
test('Soldier ex. 3 — the Imp attacks the "Soldier" who is actually the Drunk: they die', () => {
  const s = afterNight1(['imp', 'drunk', 'poisoner', 'chef', 'washerwoman'], { drunkFakeChar: 'soldier' });
  night(s, { imp: ['drunk'] });
  assert.equal(byChar(s, 'drunk').alive, false);
});

// ================================================================ MAYOR

// 1. "The Imp attacks the Mayor. The Storyteller chooses that the Ravenkeeper dies instead."
test('Mayor ex. 1 — the Imp attacks the Mayor: the Ravenkeeper dies instead', () => {
  const s = afterNight1(['imp', 'mayor', 'soldier', 'ravenkeeper']); // the Soldier is immune: the Ravenkeeper is the only one who can die instead
  night(s, { imp: ['mayor'] });
  assert.equal(byChar(s, 'mayor').alive, true);
  assert.equal(byChar(s, 'ravenkeeper').alive, false);
});

// 2. "There are three players alive. There are no nominations for execution today. Good wins."
test('Mayor ex. 2 — three alive and no nominations: good wins', () => {
  const s = mkDay(['imp', 'mayor', 'empath']);
  endDayByConsensus(s);
  assert.equal(s.winner, 'good');
  assert.equal(s.publicLog.at(-1)!.key, 'goodWinsMayor');
});

// 3. "There are five players alive, including two Travellers. Both Travellers are exiled, and the vote is tied between the
//    remaining players. Because a tied vote means neither player is executed, good wins."
//    [translated: three players alive, and a tied vote means nobody is executed]
test('Mayor ex. 3 (translated: no Travellers) — three alive and the vote is tied: neither nominee is executed, so good wins', () => {
  const s = mkDay(['imp', 'mayor', 'empath']); // 3 alive: 2 votes needed
  const [imp, mayor, empath] = s.players;
  nominate(s, mayor.id, empath.id); fastForwardToVote(s); voteInOrder(s, [imp.id, mayor.id]);
  assert.equal(s.onBlockId, empath.id);
  nominate(s, empath.id, imp.id); fastForwardToVote(s); voteInOrder(s, [mayor.id, empath.id]);
  assert.equal(s.onBlockId, null, 'a tied vote: neither is executed');
  endDayByConsensus(s);
  assert.equal(s.winner, 'good');
  assert.ok(s.players.every((p) => p.alive));
});
test('Mayor ex. 3 (the Travellers part) — exiled Travellers do not count as players', { skip: 'Travellers (exile) do not exist in this app' }, () => {});

// ================================================================ BUTLER

/** 6 alive (3 votes needed): the Butler, the nominator and the Soldier vote yes; the Master (Empath) optionally too. */
function butlerVote(masterVotesYes: boolean, opts: { butlerDead?: boolean } = {}): GameState {
  const s = named(mk(['imp', 'butler', 'poisoner', 'soldier', 'washerwoman', 'empath']), ['Ian', 'Bea', 'Paul', 'Sol', 'Wanda', 'Filip']);
  startNight(s);
  runFullNight(s);
  night(s, { butler: ['empath'], imp: ['soldier'] }); // Filip (the Empath) is the Master
  assert.equal(s.data.butlerMasterId, byChar(s, 'empath').id);
  const butler = byChar(s, 'butler');
  if (opts.butlerDead) butler.alive = false;
  nominate(s, byChar(s, 'washerwoman').id, byChar(s, 'poisoner').id);
  fastForwardToVote(s);
  const yes = [butler.id, byChar(s, 'washerwoman').id, byChar(s, 'soldier').id];
  if (masterVotesYes) yes.push(byChar(s, 'empath').id);
  voteInOrder(s, yes);
  return s;
}

// 1. "The Butler chooses Filip to be their Master. Tomorrow, if Filip raises his hand to vote on an execution, then the
//    Butler may too. If not, then the Butler may not raise their hand."
test('Butler ex. 1 — Filip is the Master: the Butler\'s vote counts if Filip votes, and not if he does not', () => {
  const filipVotes = butlerVote(true);
  assert.equal(filipVotes.onBlockId, byChar(filipVotes, 'poisoner').id, 'Filip votes too: the Butler\'s vote counts (4 yes)');
  assert.equal(butlerVote(false).onBlockId, null, 'Filip does not vote: the Butler\'s vote does not count (2 of the 3 needed)');
});

// 2. "A nomination is in progress. The Butler and their Master both have their hands raised to vote. As the Storyteller is
//    counting votes, the Master lowers their hand at the last second. The Butler must lower their hand immediately."
test('Butler ex. 2 — the Master changes their mind at the last moment: the Butler\'s vote is taken back, and the record says so', () => {
  const s = butlerVote(false); // the Butler voted yes; the Master, asked later, voted no
  assert.equal(s.onBlockId, null);
  const vote = s.history.filter((e) => e.type === 'vote').at(-1)!;
  assert.deepEqual(vote.vars.dropped, [byChar(s, 'butler').id]);
  assert.equal(vote.vars.yes, 2);
});

// 3. "The Butler is dead. Because dead players have no ability, the Butler may vote with their vote token at any time."
test('Butler ex. 3 — the Butler is dead: they may vote (with their one vote) whatever the Master does', () => {
  const s = butlerVote(false, { butlerDead: true });
  assert.equal(s.onBlockId, byChar(s, 'poisoner').id, 'the dead Butler\'s vote counts even though Filip did not vote');
});

// ================================================================ DRUNK

// 1. "The Drunk, who thinks they are the Soldier, is attacked by the Imp. The Drunk dies."
test('Drunk ex. 1 — thinks they are the Soldier, attacked by the Imp: dies', () => {
  const s = afterNight1(['imp', 'drunk', 'poisoner', 'chef', 'washerwoman'], { drunkFakeChar: 'soldier' });
  night(s, { imp: ['drunk'] });
  assert.equal(byChar(s, 'drunk').alive, false);
});

// 2. "The Drunk, who thinks they are the Empath, wakes and learns a '0,' even though they are sitting next to one evil
//    player. The next night, they learn a '1.'"
test('Drunk ex. 2 — thinks they are the Empath: learns a 0 next to one evil player, and a 1 the next night', () => {
  findSecret((sec) => {
    // seats: 0 Imp, 1 the Drunk, 2 Soldier, ...  → the Drunk has exactly one evil neighbour
    const s = mk(['imp', 'drunk', 'soldier', 'chef', 'washerwoman', 'monk', 'mayor'], { drunkFakeChar: 'empath' });
    s.secret = sec;
    startNight(s);
    runFullNight(s);
    const drunk = byChar(s, 'drunk');
    const first = (lastInfo(drunk).vars as { count: number }).count;
    endDayByConsensus(s);
    playSteps(s, { imp: ['soldier'], monk: ['chef'] });
    const second = (lastInfo(drunk).vars as { count: number }).count;
    return first === 0 && second === 1;
  }, 'a 0 then a 1 for the Drunk Empath');
});

// 3. "The Drunk, who thinks they are the Ravenkeeper, is killed at night. They choose the Saint, but learn that this
//    player is the Poisoner."
test('Drunk ex. 3 — thinks they are the Ravenkeeper, killed at night, chooses the Saint: is told "Poisoner"', () => {
  findSecret((sec) => {
    const s = afterNight1(['imp', 'drunk', 'saint', 'poisoner', 'soldier', 'chef', 'washerwoman'], { drunkFakeChar: 'ravenkeeper' });
    s.secret = sec;
    night(s, { imp: ['drunk'], ravenkeeper: ['saint'] });
    const drunk = byChar(s, 'drunk');
    return !drunk.alive && drunk.nightResult?.vars?.role === 'poisoner' && drunk.nightResult.vars.name === byChar(s, 'saint').name;
  }, 'a false answer: the Saint is the Poisoner');
});

// 4. "The Fortune Teller is executed. That night, the Drunk, who thinks they are Undertaker, learns that the Drunk died today."
test('Drunk ex. 4 — the Fortune Teller is executed; the Drunk (who thinks they are the Undertaker) is told the Drunk died', () => {
  findSecret((sec) => {
    const s = mk(['imp', 'drunk', 'fortuneteller', 'poisoner', 'soldier', 'chef', 'washerwoman'], { drunkFakeChar: 'undertaker' });
    s.secret = sec;
    startNight(s);
    runFullNight(s);
    execute(s, byChar(s, 'chef'), byChar(s, 'fortuneteller'));
    untilStep(s, 'undertaker', 'soldier');
    return lastInfo(byChar(s, 'drunk')).vars!.role === 'drunk';
  }, 'the Drunk Undertaker told "the Drunk"');
});

// ================================================================ RECLUSE

// 1. "The Slayer uses their ability on the Recluse. The Storyteller decides that the Recluse registers as the Imp, so the Recluse dies."
test('Recluse ex. 1 — the Slayer shoots the Recluse, who registers as the Imp: the Recluse dies', () => {
  const secret = findSecret((sec) => {
    const s = mkDay(['imp', 'slayer', 'recluse', 'poisoner', 'soldier']);
    s.secret = sec;
    useSlayer(s, byChar(s, 'slayer').id, byChar(s, 'recluse').id);
    return !byChar(s, 'recluse').alive;
  }, 'the Recluse dying to the Slayer');
  assert.ok(secret);
});

// 2. "The Empath, who neighbours the Recluse and the Monk, learns they are neighbouring one evil player. The next night,
//    the Empath learns they are neighbouring no evil players."
test('Recluse ex. 2 — the Empath next to the Recluse and the Monk: a 1 one night, a 0 the next', () => {
  findSecret((sec) => {
    // seats: 0 Monk, 1 Empath, 2 Recluse
    const s = mk(['monk', 'empath', 'recluse', 'imp', 'soldier', 'chef', 'poisoner']);
    s.secret = sec;
    startNight(s);
    runFullNight(s);
    const empath = byChar(s, 'empath');
    const first = (lastInfo(empath).vars as { count: number }).count;
    endDayByConsensus(s);
    playSteps(s, { poisoner: ['poisoner'], monk: ['chef'], imp: ['soldier'] });
    const second = (lastInfo(empath).vars as { count: number }).count;
    return first === 1 && second === 0;
  }, 'a 1 then a 0');
});

// 3. "The Investigator learns that either the Recluse or the Saint is the Scarlet Woman."
test('Recluse ex. 3 — the Investigator learns "the Recluse or the Saint is the Scarlet Woman"', () => {
  findSecret((sec) => {
    const s = named(mk(['investigator', 'recluse', 'saint', 'scarletwoman', 'soldier', 'chef', 'imp']), ['Ines', 'Rex', 'Sam', 'Sarah', 'Sol', 'Chuck', 'Ian']);
    s.secret = sec;
    const msg = investigativeInfo(s, s.players[0], 'minion', 'inv');
    return msg.key === 'investigativeInfo' && msg.vars!.role === 'scarletwoman' && JSON.stringify(pairOf(msg)) === JSON.stringify(['Rex', 'Sam']);
  }, 'Recluse or Saint is the Scarlet Woman');
});

// 4. "The Recluse is executed. The Undertaker learns that the Imp was executed."
test('Recluse ex. 4 — the Recluse is executed: the Undertaker can learn that the Imp was executed', () => {
  findSecret((sec) => {
    const s = undertakerNight(['imp', 'undertaker', 'recluse', 'soldier', 'poisoner', 'chef'], {}, (g) => execute(g, byChar(g, 'chef'), byChar(g, 'recluse')), sec);
    untilStep(s, 'undertaker', 'soldier');
    return lastInfo(byChar(s, 'undertaker')).vars!.role === 'imp';
  }, 'the Recluse shown as the Imp');
});

// 5. "The Recluse neighbours the Imp and an Evil Traveller. Because showing a '2' to the Chef might be too revealing, the
//    Chef learns true information, a '0,' instead."   [Traveller: translated to the Poisoner]
test('Recluse ex. 5 (translated: the evil Traveller is the Poisoner) — the Recluse between the Imp and the Poisoner: the Chef can learn a true 0', () => {
  let zero = false;
  for (let i = 0; i < 300 && !zero; i++) {
    const { count } = seatedChef(['imp', 'recluse', 'poisoner', 'chef', 'soldier', 'mayor'], 3, `rec5-${i}`);
    zero = count() === 0;
  }
  assert.ok(zero, 'the Chef can be told 0 (the truth about the Recluse: they are good)');
});

// ================================================================ SAINT

// 1. "There are seven players alive and nominations are in progress. The Saint gets four votes and is about to die.
//    Then, the Baron is nominated but only gets three votes. No more nominations occur today. The Saint is executed, and evil wins."
test('Saint ex. 1 — 7 alive: the Saint gets 4 votes, the Baron only 3: the Saint is executed and evil wins', () => {
  const s = mkDay(['imp', 'saint', 'baron', 'chef', 'soldier', 'empath', 'washerwoman']);
  const [imp, saint, baron, chef, soldier, empath, washerwoman] = s.players;
  nominate(s, chef.id, saint.id); fastForwardToVote(s); voteInOrder(s, [chef.id, soldier.id, empath.id, washerwoman.id]);
  assert.equal(s.onBlockId, saint.id, 'the Saint is about to die');
  nominate(s, soldier.id, baron.id); fastForwardToVote(s); voteInOrder(s, [chef.id, soldier.id, empath.id]);
  assert.equal(s.onBlockId, saint.id, 'the Baron got only three votes');
  endDayByConsensus(s);
  assert.equal(saint.alive, false);
  assert.equal(s.winner, 'evil');
  void imp;
});

// 2. "The Imp is nominated, and the players vote. The Gunslinger kills the Saint. The Saint dies, and the game continues."
//    [the Gunslinger is a Traveller: translated to the Imp killing the Saint at night — a death that is not an execution]
test('Saint ex. 2 (translated: killed by the Imp, not a Gunslinger) — the Saint dies but not by execution: the game continues', () => {
  const s = afterNight1(['imp', 'saint', 'poisoner', 'chef', 'soldier', 'empath']);
  night(s, { imp: ['saint'] });
  assert.equal(byChar(s, 'saint').alive, false);
  assert.equal(s.winner, null);
});
test('Saint ex. 3 — executed, but the Scapegoat dies instead: the game continues', { skip: 'Scapegoat (a Traveller) does not exist in this app' }, () => {});

// ================================================================ POISONER

// 1. "During the night, the Poisoner poisons the Slayer. The next day, the Slayer tries to slay the Imp. Nothing happens.
//    The Slayer now has no ability."
test('Poisoner ex. 1 — poisons the Slayer, who shoots the Imp next day: nothing happens, and the shot is spent', () => {
  const s = afterNight1(['imp', 'poisoner', 'slayer', 'soldier', 'chef', 'empath']);
  night(s, { poisoner: ['slayer'], imp: ['soldier'] });
  useSlayer(s, byChar(s, 'slayer').id, byChar(s, 'imp').id);
  assert.equal(byChar(s, 'imp').alive, true);
  assert.equal(byChar(s, 'slayer').slayerUsed, true);
  assert.throws(() => useSlayer(s, byChar(s, 'slayer').id, byChar(s, 'imp').id), /already used/);
});

// 2. "The poisoned Empath, who neighbours two evil players, learns a '0.' The next night, the Empath, no longer poisoned,
//    learns the correct information: a '2.'"
test('Poisoner ex. 2 — the poisoned Empath between two evil players learns a 0; the next night, healthy, learns the true 2', () => {
  findSecret((sec) => {
    // seats: 0 Imp, 1 Empath, 2 Poisoner
    const s = mk(['imp', 'empath', 'poisoner', 'soldier', 'chef', 'monk', 'mayor']);
    s.secret = sec;
    startNight(s);
    runFullNight(s);
    const empath = byChar(s, 'empath');
    endDayByConsensus(s);
    playSteps(s, { poisoner: ['empath'], monk: ['chef'], imp: ['soldier'] });
    const poisonedAnswer = (lastInfo(empath).vars as { count: number }).count;
    endDayByConsensus(s);
    playSteps(s, { poisoner: ['chef'], monk: ['chef'], imp: ['soldier'] });
    const healthyAnswer = (lastInfo(empath).vars as { count: number }).count;
    assert.equal(healthyAnswer, 2, 'no longer poisoned: the true information');
    return poisonedAnswer === 0;
  }, 'a poisoned Empath learning a 0');
});

// 3. "The Investigator is poisoned. They learn that one of two players is the Baron, even though neither is a Minion.
//    (Or even the right players, but the wrong Minion type.)"
test('Poisoner ex. 3 — the poisoned Investigator is told "one of two players is the Baron", though neither is a Minion', () => {
  findSecret((sec) => {
    // The Poisoner is alive and has poisoned the Investigator (who is asked the way the first night asks).
    const s = mk(['imp', 'poisoner', 'investigator', 'soldier', 'chef', 'monk', 'mayor']);
    s.secret = sec;
    poison(s, byChar(s, 'investigator').id);
    const msg = investigativeInfo(s, byChar(s, 'investigator'), 'minion', 'poison-slot');
    const nonMinions = [msg.vars!.a, msg.vars!.b].map((n) => s.players.find((p) => p.name === n)!).every((p) => CHARACTERS[p.character].team !== 'minion');
    return msg.vars!.role === 'baron' && nonMinions;
  }, 'a false "Baron" about two non-Minions');
});

// 4. "The Undertaker is poisoned. Even though the Imp died today, they learn that the Virgin died. A few days later, a
//    poisoned Saint dies, and the game continues."
test('Poisoner ex. 4 — the poisoned Undertaker is told "the Virgin died" although the Imp was executed (the Scarlet Woman takes over)', () => {
  findSecret((sec) => {
    const s = mk(['imp', 'scarletwoman', 'poisoner', 'undertaker', 'soldier', 'chef', 'empath', 'washerwoman']);
    s.secret = sec;
    startNight(s);
    runFullNight(s);
    execute(s, byChar(s, 'chef'), byChar(s, 'imp')); // the Imp dies today...
    assert.equal(s.winner, null, '...but the Scarlet Woman becomes the Imp: the game goes on');
    playSteps(s, { poisoner: ['undertaker'], imp: ['soldier'] }); // the Poisoner poisons the Undertaker
    return lastInfo(byChar(s, 'undertaker')).vars!.role === 'virgin';
  }, 'a poisoned Undertaker told "Virgin"');
  // ...and, a few days later, a poisoned Saint who is executed does not end the game.
  const s = mkDay(['imp', 'saint', 'poisoner', 'soldier', 'chef', 'empath']);
  poison(s, byChar(s, 'saint').id);
  execute(s, byChar(s, 'chef'), byChar(s, 'saint'));
  assert.equal(byChar(s, 'saint').alive, false);
  assert.equal(s.winner, null, 'the poisoned Saint dies, and the game continues');
});

// 5. "The Poisoner poisons the Mayor, then becomes the Imp. The Mayor is no longer poisoned because there is no Poisoner in play."
test('Poisoner ex. 5 — poisons the Mayor, then becomes the Imp: the Mayor is no longer poisoned', () => {
  const s = afterNight1(['imp', 'poisoner', 'mayor', 'soldier', 'chef', 'empath']);
  night(s, { poisoner: ['mayor'], imp: ['imp'] }); // the Imp kills themselves; the Poisoner is the only Minion
  const poisoner = s.players[1];
  assert.equal(poisoner.character, 'imp', 'the Poisoner became the Imp');
  assert.equal(abilityWorks(s, byChar(s, 'mayor')), true, 'no Poisoner in play: the Mayor is no longer poisoned');
});

// ================================================================ SPY

// 1. "The Washerwoman learns that either Abdallah or Douglas is the Ravenkeeper. Abdallah is the Monk, and Douglas is
//    the Spy registering as the Ravenkeeper."
test('Spy ex. 1 — the Washerwoman learns "Abdallah (Monk) or Douglas (Spy) is the Ravenkeeper"', () => {
  findSecret((sec) => {
    const s = named(mk(['washerwoman', 'monk', 'spy', 'ravenkeeper', 'imp', 'chef']), ['Wanda', 'Abdallah', 'Douglas', 'Rita', 'Ian', 'Chuck']);
    s.secret = sec;
    const msg = investigativeInfo(s, s.players[0], 'townsfolk', 'ww');
    return msg.key === 'investigativeInfo' && msg.vars!.role === 'ravenkeeper' && JSON.stringify(pairOf(msg)) === JSON.stringify(['Abdallah', 'Douglas']);
  }, 'Abdallah or Douglas (the Spy) is the Ravenkeeper');
});

// 2. "The Spy neighbours the Imp and the Empath. The Chef learns a '1' because the Spy is registering as evil. Later that
//    night, the Empath learns a '0' because the Spy is now registering as good."
test('Spy ex. 2 — next to the Imp and the Empath: the Chef sees the Spy as evil (1), later that night the Empath sees them as good (0)', () => {
  findSecret((sec) => {
    // seats: 0 Chef, 1 Imp, 2 Spy, 3 Empath, 4 Soldier, 5 Monk, 6 Poisoner
    const s = mk(['chef', 'imp', 'spy', 'empath', 'soldier', 'monk', 'poisoner']);
    s.secret = sec;
    startNight(s);
    runFullNight(s);
    const chef = (lastInfo(byChar(s, 'chef')).vars as { count: number }).count;
    const empath = (lastInfo(byChar(s, 'empath')).vars as { count: number }).count;
    return chef === 1 && empath === 0;
  }, 'Chef 1 and Empath 0 the same night');
});

// 3. "The Spy nominates the Virgin and is executed by the Virgin's ability, because the Storyteller chooses that the Spy
//    registers as a Townsfolk. That night, the Undertaker learns that the Drunk died today, because the Spy is now
//    registering as the Drunk."
test('Spy ex. 3 — the Spy nominates the Virgin and is executed; that night the Undertaker learns "the Drunk died"', () => {
  findSecret((sec) => {
    const s = mk(['imp', 'undertaker', 'spy', 'virgin', 'drunk', 'chef', 'poisoner'], { drunkFakeChar: 'empath' });
    s.secret = sec;
    startNight(s);
    runFullNight(s);
    nominate(s, byChar(s, 'spy').id, byChar(s, 'virgin').id);
    if (byChar(s, 'spy').alive) return false; // this time the Spy registered as evil-ish: no execution
    assert.equal(s.phase, 'night', 'the Virgin\'s execution ended the day');
    untilStep(s, 'undertaker', 'chef');
    return lastInfo(byChar(s, 'undertaker')).vars!.role === 'drunk';
  }, 'the executed Spy shown to the Undertaker as the Drunk');
});

// ================================================================ SCARLET WOMAN

// 1. "Seven players alive: the Imp, the Scarlet Woman, two Townsfolk, and three Travellers. The Imp is executed, so the game
//    ends and good wins because Travellers do not add to the player count for the Scarlet Woman's ability."
test('Scarlet Woman ex. 1 — Travellers do not count towards the 5 players', { skip: 'Travellers do not exist in this app' }, () => {});

// 2. "Five players alive: the Imp, the Scarlet Woman, the Baron, and two Townsfolk. The Imp is executed. The Scarlet Woman
//    becomes the Imp, and the game continues."
test('Scarlet Woman ex. 2 — five alive (Imp, Scarlet Woman, Baron, two Townsfolk): the Imp is executed, the Scarlet Woman becomes the Imp', () => {
  const s = mkDay(['imp', 'scarletwoman', 'baron', 'chef', 'empath']);
  execute(s, byChar(s, 'chef'), byChar(s, 'imp'));
  assert.equal(s.players[1].character, 'imp', 'the Scarlet Woman is now the Imp');
  assert.equal(s.winner, null, 'the game continues');
});

// 3. "Brianna is the Scarlet Woman. The Fortune Teller chooses Brianna and Alex, and learns a 'no.' Later, the Imp dies, so
//    Brianna becomes the Imp. The Fortune Teller chooses Brianna and Alex again, and learns a 'yes.'"
test('Scarlet Woman ex. 3 — the Fortune Teller\'s "no" on Brianna becomes a "yes" once she is the Imp', () => {
  const s = named(afterNight1(['fortuneteller', 'imp', 'scarletwoman', 'soldier', 'chef', 'washerwoman']), ['Fay', 'Ian', 'Brianna', 'Alex', 'Chuck', 'Wanda']);
  s.players[4].isRedHerring = true; // (the red herring is somebody else)
  const [ftp, , brianna, alex] = s.players;
  night(s, { fortuneteller: [brianna, alex], imp: ['soldier'] });
  assert.equal(ftp.nightResult?.key, 'fortuneTellerNo', 'chooses Brianna and Alex: no');
  execute(s, s.players[5], s.players[1]); // later, the Imp dies
  assert.equal(brianna.character, 'imp', 'Brianna becomes the Imp');
  night(s, { fortuneteller: [brianna, alex], imp: [alex] });
  assert.equal(brianna.character, 'imp');
  assert.equal(ftp.nightResult?.key, 'fortuneTellerYes', 'chooses Brianna and Alex again: yes');
});

// ================================================================ BARON

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

// 1. "The game is being set up for seven players, with five Townsfolk, one Minion, and one Demon. Because the Minion is
//    the Baron, the Storyteller removes two Townsfolk tokens and adds a Saint and a Butler token. In total, three
//    Townsfolk, two Outsider, one Minion, and one Demon tokens go in the bag."
test('Baron ex. 1 — seven players with the Baron: 3 Townsfolk, 2 Outsiders, the Baron, the Demon', () => {
  const secret = findSecret((sec) => Object.values(dealCharacters(ids(7), sec).characters).includes('baron'), 'a 7-player game with the Baron');
  const chars = Object.values(dealCharacters(ids(7), secret).characters);
  const count = (t: string) => chars.filter((c) => CHARACTERS[c].team === t).length;
  assert.deepEqual([count('townsfolk'), count('outsider'), count('minion'), count('demon')], [3, 2, 1, 1]);
  assert.equal(chars.length, 7);
});

// 2. "The game is being set up for fifteen players, with nine Townsfolk, two Outsiders, three Minions, and one Demon.
//    Because the Baron is in play, the Storyteller must add a Drunk and a Recluse... one player isn't a Townsfolk—they
//    are an Outsider: the Drunk."
test('Baron ex. 2 — fifteen players with the Baron: 4 Outsiders (all of them, so a Drunk and a Recluse), 7 Townsfolk, and the Drunk believes a Townsfolk that is not in play', () => {
  const secret = findSecret((sec) => Object.values(dealCharacters(ids(15), sec).characters).includes('baron'), 'a 15-player game with the Baron');
  const d = dealCharacters(ids(15), secret);
  const chars = Object.values(d.characters);
  const count = (t: string) => chars.filter((c) => CHARACTERS[c].team === t).length;
  assert.deepEqual([count('townsfolk'), count('outsider'), count('minion'), count('demon')], [7, 4, 3, 1]);
  assert.deepEqual(chars.filter((c) => CHARACTERS[c].team === 'outsider').sort(), ['butler', 'drunk', 'recluse', 'saint'], 'every Outsider is in play');
  const drunkId = Object.entries(d.characters).find(([, c]) => c === 'drunk')![0];
  assert.equal(CHARACTERS[d.perceived[drunkId]].team, 'townsfolk');
  assert.ok(!chars.includes(d.perceived[drunkId]), 'the Drunk\'s Townsfolk token is not also in play');
});

// ================================================================ IMP

// 1. "It is the first night. The Imp learns that Evin and Sarah are the Minions. The Imp also learns that the Monk, Chef,
//    and Librarian are not in play. The Imp bluffs as the Chef, then bluffs as Mayor halfway through the game.
//    Eventually, the Imp is executed and good wins."
test('Imp ex. 1 — the first night: learns the Minions and three characters not in play; later executed, good wins', () => {
  const s = createGame('IMP1');
  s.secret = 'imp-example-1';
  const ps = Array.from({ length: 10 }, (_, i) => addPlayer(s, `P${i}`));
  ps.forEach((p, i) => declareNeighbor(s, p.id, ps[(i + 1) % 10].id));
  startGame(s);
  runFullNight(s);
  const imp = byChar(s, 'imp');
  const info = imp.log.find((e) => e.msg.key === 'demonInfo')!.msg;
  const minions = s.players.filter((p) => CHARACTERS[p.character].team === 'minion').map((p) => p.name).sort();
  assert.deepEqual([...(info.vars!.names as string[])].sort(), minions, 'the Imp learns who the Minions are');
  const bluffs = info.vars!.bluffs as CharacterId[];
  assert.equal(bluffs.length, 3);
  const inPlay = new Set(s.players.map((p) => p.character));
  for (const b of bluffs) assert.ok(!inPlay.has(b) && ['townsfolk', 'outsider'].includes(CHARACTERS[b].team), `${b} is a good character not in play`);
  // Eventually the Imp is executed and good wins.
  const nominator = s.players.find((p) => p.alive && p.id !== imp.id)!;
  nominate(s, nominator.id, imp.id);
  if (s.currentNomination) {
    markAllReady(s);
    skipSpeech(s, nominator.id);
    skipSpeech(s, imp.id);
    voteInOrder(s, s.players.map((p) => p.id));
  }
  endDayByConsensus(s);
  // (A Scarlet Woman, if this game has one, would take over: the example is about the plain case.)
  if (s.players.some((p) => p.character === 'scarletwoman' && p.alive)) return;
  assert.equal(s.winner, 'good');
});

// 2. "During the night, the Imp wakes and chooses a player, who dies. The next night, the Imp chooses themselves to die.
//    The Imp dies, and the Poisoner becomes the Imp."
test('Imp ex. 2 — kills a player one night, chooses themselves the next: the Imp dies and the Poisoner becomes the Imp', () => {
  const s = afterNight1(['imp', 'poisoner', 'washerwoman', 'chef', 'soldier', 'empath']);
  night(s, { imp: ['washerwoman'] });
  assert.equal(byChar(s, 'washerwoman').alive, false, 'the chosen player dies');
  endDayByConsensus(s);
  playSteps(s, { imp: ['imp'] });
  assert.equal(s.players[0].alive, false, 'the Imp dies');
  assert.equal(s.players[1].character, 'imp', 'the Poisoner becomes the Imp');
});
