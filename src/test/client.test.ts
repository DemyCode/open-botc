// The real browser code (public/app.js) running in a fake browser, fed real game views. Catches
// what no engine test can: a screen that throws, shows "undefined", or a button that sends the
// wrong message.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPlayer, castVote, createGame, declareNeighbor, nominate, skipSpeech, startGame, useSlayer } from '../game/engine.js';
import { CHARACTERS } from '../game/characters.js';
import { MIN_ANSWER_MS } from '../game/night.js';
import type { CharacterId, GameState } from '../game/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { PROTOCOL_VERSION, viewFor, type GameView } from '../game/view.js';
import { playGame } from './driver.js';
import { brokenText, loadApp, type FakeClient, type FakeNode } from './fakedom.js';
import {
  advanceUntil, answerRealTurn, breakDawn, byChar, endDayByConsensus, fastForwardToVote, markAllReady, mk, mkDay, playRounds, runFullNight, skipRound, startNight,
} from './helpers.js';

const KNOWN_MESSAGES = new Set(['join', 'auth', 'leave', 'start', 'declareNeighbor', 'nightReal', 'nominate', 'skipSpeech', 'readySpeech', 'vote', 'endDay', 'slayer', 'dayAbility']);
const clickable = (root: FakeNode) => root.find((n) => (n.listeners.click?.length ?? 0) > 0);
const buttonLabels = (app: FakeClient) => app.root.buttons().map((b) => b.text());

// ---------------------------------------------------------------- the app itself

test('the app loads with no errors and shows the landing page, in English and in French', async () => {
  for (const [lang, join] of [['en', 'Join Game'], ['fr', 'Rejoindre']] as const) {
    const app = await loadApp(lang);
    assert.deepEqual(app.errors, []);
    assert.equal(brokenText(app.text()), null);
    assert.ok(app.text().includes(join) || app.text().toLowerCase().includes('rejoindre'), `${lang}: ${app.text().slice(0, 200)}`);
    assert.ok(app.root.buttons().length >= 2);
  }
});

test('the roles reference lists all 22 characters, grouped by team', async () => {
  const app = await loadApp('en');
  app.show(viewFor(mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']), 'x'), { seen: true });
  app.run('showRolesModal()');
  await new Promise((r) => setImmediate(r));
  const overlay = app.body.find((n) => n.hasClass('modal-overlay'))[0];
  assert.ok(overlay, 'the modal opened');
  const cards = overlay.find((n) => n.hasClass('roles-card'));
  assert.equal(cards.length, 22, "the game's script (Trouble Brewing): 22 characters");
  for (const name of ['Washerwoman', 'Imp', 'Scarlet Woman', 'Recluse', 'Saint']) assert.ok(overlay.text().includes(name), name);
  assert.equal(brokenText(overlay.text()), null);
});

// ---------------------------------------------------------------- every real screen

interface Sample { view: GameView; label: string }

function sampleViews(): Sample[] {
  const out: Sample[] = [];
  for (const n of [5, 6, 7, 9, 12, 15]) {
    for (let seed = 0; seed < 3; seed++) {
      let k = 0;
      playGame(seed, n, (s, where) => {
        k++;
        if (k % 7 !== 0) return;
        const p = s.players[(k / 7) % s.players.length | 0];
        out.push({ view: viewFor(s, p.id), label: `${where} as ${p.name}` });
      });
    }
  }
  return out;
}

test('every screen of real games renders, in both languages, with no broken text (a few hundred views)', async () => {
  const samples = sampleViews();
  assert.ok(samples.length > 200, `only ${samples.length} views sampled`);
  const app = await loadApp('en');
  const problems: string[] = [];
  const phases = new Set<string>();
  for (const { view, label } of samples) {
    phases.add(view.phase);
    for (const lang of ['en', 'fr'] as const) {
      for (const seen of [false, true]) {
        try {
          const text = app.show(view, { seen, lang });
          const why = brokenText(text);
          if (why) problems.push(`${label} [${lang}, seen=${seen}]: ${why} — ${text.slice(0, 120)}`);
        } catch (e) {
          problems.push(`${label} [${lang}, seen=${seen}] THREW ${(e as Error).message}`);
        }
      }
    }
  }
  assert.deepEqual(problems.slice(0, 5), []);
  assert.deepEqual([...phases].sort(), ['day', 'ended', 'night']);
});

test('tapping every button and row on every real screen never throws, and only sends known messages', async () => {
  const samples = sampleViews().filter((_, i) => i % 3 === 0);
  const app = await loadApp('en');
  const problems: string[] = [];
  for (const { view, label } of samples) {
    app.show(view, { seen: true, lang: 'en' });
    const targets = clickable(app.root);
    for (let i = 0; i < targets.length; i++) {
      app.show(view, { seen: true, lang: 'en' }); // a fresh screen for each tap
      const t = clickable(app.root)[i];
      if (!t) continue;
      try {
        t.click();
      } catch (e) {
        problems.push(`${label}: tapping "${t.text().slice(0, 30)}" threw ${(e as Error).message}`);
      }
    }
  }
  const unknown = app.sent.filter((m) => !KNOWN_MESSAGES.has(String(m.t)));
  assert.deepEqual(problems.slice(0, 5), []);
  assert.deepEqual(unknown.slice(0, 3), []);
  assert.ok(app.sent.length > 20, 'the taps did send messages');
});

test('the language switch flips every screen to French: the role name and the buttons change', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const v = viewFor(s, s.players[2].id);
  const app = await loadApp('en');
  const en = app.show(v, { seen: true, lang: 'en' });
  const fr = app.show(v, { seen: true, lang: 'fr' });
  assert.ok(en.includes('Empath') && !en.includes('Empathe'));
  assert.ok(fr.includes('Empathe'));
  assert.notEqual(en, fr);
  assert.ok(!/\b(You are alive|Hide role)\b/.test(fr), 'no English left on the French screen');
});

// ---------------------------------------------------------------- the role banner

test('hiding the role hides the character name (and the good/evil colour), showing brings it back', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await loadApp('en');
  app.show(viewFor(s, s.players[2].id), { seen: true });
  assert.ok(app.text().includes('Empath'));
  app.run('state.roleHidden = true; render();');
  assert.ok(!app.text().includes('Empath'), 'the role is hidden');
  assert.ok(!app.text().includes('Good') && !app.text().includes('Evil'), 'and so is the alignment');
  assert.ok(app.text().includes('You are alive'), 'but your alive status stays');
  assert.equal(app.root.find((n) => n.hasClass('role-banner') && (n.hasClass('good') || n.hasClass('evil'))).length, 0, 'no colour hint either');
});

test('an evil player sees Evil, a good one sees Good', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await loadApp('en');
  assert.ok(app.show(viewFor(s, s.players[0].id), { seen: true }).includes('Evil'));
  assert.ok(app.show(viewFor(s, s.players[2].id), { seen: true }).includes('Good'));
});

// ---------------------------------------------------------------- the day

function dayApp(s: GameState, viewerIndex: number, lang: 'en' | 'fr' = 'en'): Promise<FakeClient> {
  return loadApp(lang).then((app) => {
    app.show(viewFor(s, s.players[viewerIndex].id), { seen: true, lang });
    return app;
  });
}
const rows = (app: FakeClient) => app.root.find((n) => n.hasClass('player-row'));

test('tapping another living player nominates them at once (no confirmation)', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await dayApp(s, 2);
  rows(app)[3].click();
  assert.deepEqual(app.sent.at(-1), { t: 'nominate', nomineeId: s.players[3].id });
  assert.deepEqual(app.confirms, []);
});

test('nominating YOURSELF asks first, then sends', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await dayApp(s, 2);
  rows(app)[2].click();
  assert.equal(app.confirms.length, 1);
  assert.match(app.confirms[0], /yourself/i);
  assert.deepEqual(app.sent.at(-1), { t: 'nominate', nomineeId: s.players[2].id });
});

test('nominating a DEAD player asks first, naming them', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  s.players[4].alive = false;
  const app = await dayApp(s, 2);
  rows(app)[4].click();
  assert.equal(app.confirms.length, 1);
  assert.ok(app.confirms[0].includes('P4'));
  assert.deepEqual(app.sent.at(-1), { t: 'nominate', nomineeId: s.players[4].id });
});

test('rows are not tappable once you have nominated today, nor for someone already nominated, nor when you are dead', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  s.usedNomineeIds.push(s.players[4].id);
  let app = await dayApp(s, 2);
  assert.equal(rows(app).filter((r) => r.listeners.click).length, 4, 'everyone but the already-nominated P4');
  s.usedNominatorIds.push(s.players[2].id);
  app = await dayApp(s, 2);
  assert.equal(rows(app).filter((r) => r.listeners.click).length, 0, 'you already nominated today');
  const dead = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  dead.players[2].alive = false;
  app = await dayApp(dead, 2);
  assert.equal(rows(app).filter((r) => r.listeners.click).length, 0, 'the dead cannot nominate');
});

/** The Slayer card's title: the real Slayer's, or the bluff one everybody else gets. */
const SLAYER_CARD = /Use your Slayer shot|Bluff to be the Slayer/;

test('the Slayer-shot card is shown to every living player who has not fired — not only to the Slayer', async () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'washerwoman', 'soldier']);
  for (const i of [0, 1, 2, 3, 4]) assert.match((await dayApp(s, i)).text(), SLAYER_CARD, `player ${i}`);
});

test('the Slayer card says what it is: "Use your Slayer shot" for the Slayer, "Bluff to be the Slayer" (with a warning) for everyone else', async () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'washerwoman', 'soldier']);
  const mine = (await dayApp(s, 1)).text();
  assert.ok(mine.includes('Use your Slayer shot') && !mine.includes('Bluff to be the Slayer') && !mine.includes('🎭'));
  const bluff = (await dayApp(s, 2)).text();
  assert.ok(bluff.includes('Bluff to be the Slayer') && !bluff.includes('Use your Slayer shot'));
  assert.ok(bluff.includes('You are not the Slayer'), 'the bluff is explained on the card');
  const fr = (await dayApp(s, 2, 'fr')).text();
  assert.ok(fr.includes('Bluffer : se faire passer pour'), fr.slice(0, 300));
});

test('regression: no Slayer-shot card on a script without the Slayer (e.g. Bad Moon Rising)', async () => {
  const s = mkDay(['po', 'grandmother', 'sailor', 'chambermaid', 'exorcist']);
  s.scriptChars = s.scriptChars.filter((c) => CHARACTERS[c].edition === 'bmr');
  assert.ok(!s.scriptChars.includes('slayer'));
  for (const i of [0, 1, 2, 3, 4]) assert.doesNotMatch((await dayApp(s, i)).text(), SLAYER_CARD, `player ${i}`);
  assert.throws(() => useSlayer(s, s.players[1].id, s.players[0].id), /not in this script/);
});

test('the Slayer-shot card is gone once your shot is spent, when you are dead, and at night', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  useSlayer(s, s.players[2].id, s.players[0].id);
  assert.doesNotMatch((await dayApp(s, 2)).text(), SLAYER_CARD, 'spent');
  assert.match((await dayApp(s, 3)).text(), SLAYER_CARD, 'others still have theirs');
  const dead = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  dead.players[2].alive = false;
  assert.doesNotMatch((await dayApp(dead, 2)).text(), SLAYER_CARD, 'dead');
  const night = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  startNight(night);
  const app = await loadApp('en');
  app.show(viewFor(night, night.players[2].id), { seen: true });
  assert.doesNotMatch(app.text(), SLAYER_CARD, 'night');
});

test('firing the Slayer shot asks to confirm and sends {slayer, target}; a bluffer is warned first, then sends the very same message', async () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'washerwoman', 'soldier']);
  for (const [i, confirms] of [[1, 1], [2, 2]] as const) {
    const app = await dayApp(s, i);
    const card = app.root.find((n) => n.hasClass('card') && SLAYER_CARD.test(n.text()))[0];
    card.find((n) => n.hasClass('choice'))[0].click();
    assert.equal(app.confirms.length, confirms, i === 1 ? 'the Slayer: "publicly accuse?" only' : 'a bluffer: the bluff warning, then "publicly accuse?"');
    if (i === 2) assert.match(String(app.confirms[0]), /You will tell the village that you are the Slayer/);
    assert.deepEqual(app.sent.at(-1), { t: 'slayer', targetId: s.players[0].id });
  }
});

test('a dead player is told how many votes they have left, and cannot nominate', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  s.players[2].alive = false;
  let app = await dayApp(s, 2);
  assert.ok(app.text().includes('one vote left'));
  s.players[2].ghostVoteUsed = true;
  app = await dayApp(s, 2);
  assert.ok(app.text().includes('already used your final vote'));
});

test('a nomination in each stage shows the right thing and the right buttons', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const [imp, poisoner, empath] = s.players;
  nominate(s, empath.id, imp.id);
  // ready gate: a button to say ready
  let app = await dayApp(s, 3);
  assert.ok(app.text().includes('P2 accuses P0') || app.text().includes('accuses'));
  assert.ok(buttonLabels(app).some((l) => /ready/i.test(l)));
  app.root.buttons().find((b) => /ready/i.test(b.text()) && !/end the day/i.test(b.text()))!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'readySpeech' });
  // accusing: only the accuser can end their speech
  markAllReady(s);
  app = await dayApp(s, 2);
  const skip = app.root.buttons().find((b) => /move to defense|défense/i.test(b.text()));
  assert.ok(skip, 'the accuser can end their speech');
  skip!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'skipSpeech' });
  app = await dayApp(s, 3);
  assert.ok(!app.root.buttons().some((b) => /move to defense/i.test(b.text())), 'others cannot');
  // voting: only the current voter has Yes/No
  skipSpeech(s, empath.id);
  skipSpeech(s, imp.id);
  const voterId = s.currentNomination!.currentVoterId!;
  const voterIdx = s.players.findIndex((p) => p.id === voterId);
  app = await dayApp(s, voterIdx);
  const yes = app.root.buttons().find((b) => /^Yes, execute/.test(b.text()));
  assert.ok(yes, 'the current voter can vote');
  yes!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'vote', yes: true });
  app.root.buttons().find((b) => b.text() === 'No')!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'vote', yes: false });
  const other = s.players.findIndex((p) => p.id !== voterId);
  app = await dayApp(s, other);
  assert.ok(!app.root.buttons().some((b) => /^Yes, execute/.test(b.text())), 'nobody else can vote');
  assert.ok(app.text().includes('Waiting on'));
  void poisoner;
});

test('"I\'m ready to end the day" sends endDay; a dead player has no such button', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await dayApp(s, 2);
  app.root.buttons().find((b) => /ready to end the day/i.test(b.text()))!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'endDay' });
  s.players[2].alive = false;
  const dead = await dayApp(s, 2);
  assert.ok(!dead.root.buttons().some((b) => /ready to end the day/i.test(b.text())));
});

// ---------------------------------------------------------------- the night

function nightView(char: 'poisoner' | 'washerwoman' | 'fortuneteller', viewer: 'actor' | 'other'): { s: GameState; view: GameView } {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'fortuneteller', 'chef']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, char === 'washerwoman' ? 'empath' : char);
  const who = viewer === 'actor' ? byChar(s, char === 'washerwoman' ? 'empath' : char) : byChar(s, 'soldier');
  return { s, view: viewFor(s, who.id) };
}

/** The labels of the buttons of a given class. */
const buttonsOf = (app: FakeClient, cls: string) => app.root.find((n) => n.hasClass(cls));
/** Shows `view` as a fresh screen whose 5-second wait is already over. */
function ready(app: FakeClient, view: GameView): void {
  app.run(`handleTurnChange(${JSON.stringify(view)}); state.turnReadyAt = 0;`);
  app.show(view, { seen: true });
}

test('a pick screen: the players are locked with a countdown for 5 seconds, then ONE tap sends that player at once — no Confirm', async () => {
  const { s, view } = nightView('poisoner', 'actor');
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(view)})`);
  const waiting = app.show(view, { seen: true });
  assert.match(waiting, /You can answer in \ds/, 'a countdown while waiting');
  assert.ok(buttonsOf(app, 'choice').every((b) => b.disabled), 'every player is locked');
  buttonsOf(app, 'choice')[3].click();
  assert.ok(!app.sent.some((m) => m.t === 'nightReal'), 'a tap during the wait sends nothing');
  ready(app, view);
  assert.ok(!app.root.buttons().some((b) => /^Confirm/.test(b.text())), 'no Confirm button: the tap is the answer');
  buttonsOf(app, 'choice')[3].click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [s.players[3].id] });
  buttonsOf(app, 'choice')[4].click();
  assert.equal(app.sent.filter((m) => m.t === 'nightReal').length, 1, 'a second tap on the same screen sends nothing');
});

test('the Fortune Teller picks her two players on two screens: "Choice 1 of 2", then "Choice 2 of 2" with the first one greyed out', async () => {
  const { s, view } = nightView('fortuneteller', 'actor');
  const ft = byChar(s, 'fortuneteller');
  const imp = byChar(s, 'imp');
  const app = await loadApp('en');
  ready(app, view);
  assert.match(app.text(), /Choice 1 of 2/);
  assert.ok(!app.root.buttons().some((b) => b.text() === 'No one'), 'the Fortune Teller must choose');
  buttonsOf(app, 'choice')[imp.seat].click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [imp.id] });
  playRounds(s, 1, { [ft.id]: [[imp.id]] }); // the round ends once everyone has tapped
  const second = viewFor(s, ft.id);
  ready(app, second);
  assert.match(app.text(), /Choice 2 of 2/);
  assert.match(app.text(), new RegExp(`Already chosen: ${imp.name}`));
  assert.equal(buttonsOf(app, 'choice')[imp.seat].disabled, true, 'the same player cannot be chosen twice');
});

test('the Seamstress\'s first pick offers "No one" (to keep her ability); once she chose one player, the second pick does not', async () => {
  const s = mk(['imp', 'poisoner', 'seamstress', 'soldier', 'empath', 'chef', 'mayor']);
  startNight(s);
  advanceUntil(s, 'seamstress');
  const seam = byChar(s, 'seamstress');
  const app = await loadApp('en');
  ready(app, viewFor(s, seam.id));
  app.root.buttons().find((b) => b.text() === 'No one')!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [] });
  const t = mk(['imp', 'poisoner', 'seamstress', 'soldier', 'empath', 'chef', 'mayor']);
  startNight(t);
  advanceUntil(t, 'seamstress');
  playRounds(t, 1, { [byChar(t, 'seamstress').id]: [[byChar(t, 'soldier').id]] });
  const other = await loadApp('en');
  ready(other, viewFor(t, byChar(t, 'seamstress').id));
  assert.ok(!other.root.buttons().some((b) => b.text() === 'No one'), 'one player is not an answer');
});

test('the Pukka is asked whom to POISON (who dies tomorrow night), never "choose a player to kill"', async () => {
  const s = mk(['pukka', 'poisoner', 'empath', 'washerwoman', 'soldier', 'chef', 'mayor']);
  startNight(s);
  advanceUntil(s, 'pukka');
  const view = viewFor(s, byChar(s, 'pukka').id);
  assert.deepEqual(view.nightTurn!.body, { key: 'pukkaChoose' });
  for (const [lang, poison, kill] of [['en', /poison/, /to kill/], ['fr', /empoisonner/, /à tuer/]] as const) {
    const app = await loadApp(lang);
    app.run(`handleTurnChange(${JSON.stringify(view)})`);
    app.show(view, { seen: true });
    assert.match(app.root.text(), poison);
    assert.doesNotMatch(app.root.text(), kill);
  }
});

function courtierView(): { s: GameState; view: GameView } {
  const s = mk(['imp', 'poisoner', 'courtier', 'soldier', 'empath', 'chef', 'mayor']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'courtier');
  return { s, view: viewFor(s, byChar(s, 'courtier').id) };
}

test("the Courtier's screen is a character screen: one tap on a character sends it at once", async () => {
  const { view } = courtierView();
  assert.equal(view.nightTurn!.kind, 'character');
  assert.ok(view.nightTurn!.characters.some((c) => c.id === 'empath'));
  const app = await loadApp('en');
  ready(app, view);
  assert.equal(buttonsOf(app, 'choice').length, 0, 'no player buttons');
  assert.equal(buttonsOf(app, 'char-choice').length, view.nightTurn!.characters.length, 'a button per character');
  buttonsOf(app, 'char-choice').find((n) => n.text().includes('Empath'))!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [], character: 'empath' });
});

test('the Courtier can decline with "No one", which sends no character', async () => {
  const { view } = courtierView();
  const app = await loadApp('en');
  ready(app, view);
  app.root.buttons().find((b) => b.text() === 'No one')!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [] });
});

test('the Gambler: a pick screen for the player, then a character screen for the guess — one tap each', async () => {
  const s = mk(['imp', 'poisoner', 'gambler', 'soldier', 'empath', 'chef', 'mayor']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'gambler');
  const gambler = byChar(s, 'gambler');
  const app = await loadApp('en');
  ready(app, viewFor(s, gambler.id));
  assert.equal(buttonsOf(app, 'char-choice').length, 0, 'first the player');
  buttonsOf(app, 'choice')[3].click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [s.players[3].id] });
  playRounds(s, 1, { [gambler.id]: [[s.players[3].id]] });
  ready(app, viewFor(s, gambler.id));
  assert.equal(buttonsOf(app, 'choice').length, 0, 'then the character');
  assert.ok(!app.root.buttons().some((b) => b.text() === 'No one'), 'the guess is not optional');
  buttonsOf(app, 'char-choice').find((n) => n.text().includes('Soldier'))!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [], character: 'soldier' });
});

test('regression (FR): the Dreamer on night 1 gets the list of players to tap — not just the prompt and "J\'ai compris"', async () => {
  const s = mk(['imp', 'poisoner', 'dreamer', 'soldier', 'empath', 'chef', 'mayor']);
  startNight(s);
  advanceUntil(s, 'dreamer');
  const dreamer = byChar(s, 'dreamer');
  const view = viewFor(s, dreamer.id);
  assert.equal(view.nightTurn!.kind, 'pick');
  const app = await loadApp('fr');
  ready(app, view);
  assert.match(app.text(), /Choisissez un joueur \(pas vous\)/);
  assert.equal(buttonsOf(app, 'choice').length, s.players.length, 'a button for every player');
  assert.equal(buttonsOf(app, 'choice')[dreamer.seat].disabled, true, 'not yourself');
  assert.ok(!app.root.buttons().some((b) => b.text() === "J'ai compris"), 'no "J\'ai compris" on a pick screen');
  buttonsOf(app, 'choice')[byChar(s, 'imp').seat].click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [byChar(s, 'imp').id] });
});

test('regression (FR): a tip screen shows an "Astuce" or a "Définition" to read under "Votre tour" — never the heading alone', async () => {
  const s = mk(['imp', 'poisoner', 'dreamer', 'soldier', 'empath', 'chef', 'mayor']);
  startNight(s);
  advanceUntil(s, 'dreamer');
  const app = await loadApp('fr');
  for (let i = 0; i < 20; i++) {
    const view = JSON.parse(JSON.stringify(viewFor(s, byChar(s, 'soldier').id))) as GameView;
    view.nightTurn!.stepKey = `1-9-${i}`; // a new screen each time: a new draw
    ready(app, view);
    assert.match(app.text(), /Votre tour/);
    assert.match(app.text(), /Astuce de « .+ » :|Définition de « .+ » :/, app.text().slice(0, 300));
    assert.ok(app.root.buttons().some((b) => b.text() === "J'ai compris"));
  }
});

test('regression: an app newer than a server left running on an old build says "restart the server" instead of drawing broken screens', async () => {
  // Exactly what a phone received from the old server: the old view shape, with no protocol number.
  const s = mk(['imp', 'poisoner', 'dreamer', 'soldier', 'empath', 'chef', 'mayor']);
  startNight(s);
  advanceUntil(s, 'dreamer');
  const v = viewFor(s, byChar(s, 'dreamer').id) as unknown as Record<string, unknown>;
  delete v.protocol;
  v.nightTurn = { shape: 'choose', title: 'Your turn', body: { key: 'dreamerChoose' }, min: 1, max: 1, choices: [], decoy: false, stepKey: '1-3', waitMs: 0 };
  for (const [lang, title] of [['en', 'The server needs a restart'], ['fr', 'Le serveur doit être redémarré']] as const) {
    const app = await loadApp(lang);
    const text = app.show(v, { seen: true });
    assert.ok(text.includes(title), text.slice(0, 200));
    assert.ok(!app.root.buttons().some((b) => /Got it|J'ai compris/.test(b.text())), 'no answer button that would send nonsense');
  }
});

test('the app and the server declare the same protocol version', async () => {
  const appJs = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  assert.equal(Number(/const PROTOCOL_VERSION = (\d+);/.exec(appJs)?.[1]), PROTOCOL_VERSION);
  const s = mk(['imp', 'poisoner', 'dreamer', 'soldier', 'empath']);
  assert.equal(viewFor(s, s.players[0].id).protocol, PROTOCOL_VERSION);
});

test('an info screen has a "Got it" button that sends an empty answer once unlocked', async () => {
  const { view } = nightView('washerwoman', 'actor');
  const app = await loadApp('en');
  ready(app, view);
  assert.ok(app.text().includes('Your Information'));
  app.root.buttons().find((b) => b.text() === 'Got it')!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [] });
});

test('everyone else gets a tip: something to read and "Got it" — no players to pick, nothing about the step, the same countdown', async () => {
  const tip = nightView('fortuneteller', 'other');
  assert.equal(tip.view.nightTurn!.kind, 'tip');
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(tip.view)})`);
  const text = app.show(tip.view, { seen: true });
  assert.equal(buttonsOf(app, 'choice').length, 0, 'no player buttons');
  assert.ok(/💡|📖/.test(text), 'a tip or a definition to read');
  assert.ok(text.includes('Nothing to do right now'));
  assert.ok(!text.includes('Choose 2 players to check for the Demon'), 'the real prompt is never on a tip');
  assert.match(app.root.buttons().find((b) => /^Got it/.test(b.text()))!.text(), /\(\d\)/, 'the same 5-second wait');
  ready(app, tip.view);
  app.root.buttons().find((b) => b.text() === 'Got it')!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [] });
});

test('a result is a screen of its own ("Your Result" and "Got it"), while everyone else reads a tip', async () => {
  const { s } = nightView('fortuneteller', 'actor');
  const ft = byChar(s, 'fortuneteller');
  playRounds(s, 2, { [ft.id]: [[byChar(s, 'imp').id], [byChar(s, 'chef').id]] });
  const app = await loadApp('en');
  ready(app, viewFor(s, ft.id));
  assert.ok(app.text().includes('Your Result'));
  assert.ok(app.text().includes('Yes'), app.text().slice(0, 300));
  app.root.buttons().find((b) => b.text() === 'Got it')!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [] });
  const other = await loadApp('en');
  ready(other, viewFor(s, byChar(s, 'soldier').id));
  assert.ok(!other.text().includes('Your Result'));
  assert.ok(other.root.buttons().some((b) => b.text() === 'Got it'));
});


test('waiting between steps: the same calm screen for everyone, and the dead just rest', async () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  startNight(s);
  while (s.pendingRealTurn) skipRound(s);
  const app = await loadApp('en');
  assert.ok(app.show(viewFor(s, s.players[2].id), { seen: true }).includes('Waiting for everyone'));
  s.players[2].alive = false;
  assert.ok(app.show(viewFor(s, s.players[2].id), { seen: true }).includes('rest peacefully'));
});

test('dusk and dawn screens show first and go away when you tap Continue', async () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'imp');
  answerRealTurn(s, [byChar(s, 'empath').id]);
  runFullNight(s);
  const app = await loadApp('en');
  const dawn = app.show(viewFor(s, byChar(s, 'empath').id), { seen: false });
  assert.ok(dawn.includes('You died tonight'), dawn.slice(0, 200));
  app.root.buttons().find((b) => b.text() === 'Continue')!.click();
  const day = app.text();
  assert.ok(day.includes('Day') && !day.includes('You died tonight'));
  const others = app.show(viewFor(s, byChar(s, 'soldier').id), { seen: false });
  assert.ok(others.includes('You survived the night'));
});

// ---------------------------------------------------------------- buzzing

test('the phone NEVER buzzes at night, whatever arrives', async () => {
  const { view } = nightView('poisoner', 'actor');
  const other = nightView('poisoner', 'other').view;
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(view)}); handleVoteBuzz(${JSON.stringify(view)});`);
  app.run(`handleTurnChange(${JSON.stringify(other)}); handleVoteBuzz(${JSON.stringify(other)});`);
  assert.deepEqual(app.vibrations, []);
});

test('the phone buzzes once when it becomes YOUR turn to vote — not again for the same vote, again for the next', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  nominate(s, s.players[2].id, s.players[0].id);
  fastForwardToVote(s);
  const app = await loadApp('en');
  const first = s.currentNomination!.currentVoterId!;
  const notYet = s.players.find((p) => p.id !== first)!;
  app.run(`handleVoteBuzz(${JSON.stringify(viewFor(s, notYet.id))})`);
  assert.equal(app.vibrations.length, 0, 'not my turn');
  const mine = JSON.stringify(viewFor(s, first));
  app.run(`handleVoteBuzz(${mine})`);
  assert.equal(app.vibrations.length, 1);
  app.run(`handleVoteBuzz(${mine}); handleVoteBuzz(${mine})`);
  assert.equal(app.vibrations.length, 1, 'the same vote never buzzes twice');
});

// ---------------------------------------------------------------- lobby and the end

function lobbyState(n: number, seated: boolean): GameState {
  const s = createGame('LOBBY');
  const ps = Array.from({ length: n }, (_, i) => addPlayer(s, `Player${i + 1}`));
  if (seated) ps.forEach((p, i) => declareNeighbor(s, p.id, ps[(i + 1) % n].id));
  return s;
}

test('the lobby: seating is asked before the game can start, and only the host gets a Start button', async () => {
  const app = await loadApp('en');
  const unseated = lobbyState(5, false);
  const host = app.show(viewFor(unseated, unseated.players[0].id));
  assert.equal(brokenText(host), null);
  assert.ok(!buttonLabels(app).some((l) => /^Start/i.test(l)), 'no Start before seating is confirmed');
  const seated = lobbyState(5, true);
  app.show(viewFor(seated, seated.players[0].id));
  const start = app.root.buttons().find((b) => /^Start/i.test(b.text()));
  assert.ok(start, 'the host can start once seating is confirmed');
  start!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'start' });
  app.show(viewFor(seated, seated.players[1].id));
  assert.ok(!app.root.buttons().some((b) => /^Start/i.test(b.text())), 'a guest has no Start button');
});

test('the end screen names the winner and lists every player with their character', async () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'washerwoman', 'soldier']);
  useSlayer(s, s.players[1].id, s.players[0].id);
  const app = await loadApp('en');
  const text = app.show(viewFor(s, s.players[3].id));
  assert.match(text, /good wins/i);
  for (const name of ['Imp', 'Slayer', 'Empath', 'Washerwoman', 'Soldier']) assert.ok(text.includes(name), name);
  const fr = app.show(viewFor(s, s.players[3].id), { lang: 'fr' });
  assert.ok(fr.includes('Le Bien gagne'));
  assert.ok(fr.includes('Diablotin') && fr.includes('Lavandière'));
});

test('evil winning shows the evil banner', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath']);
  nominate(s, s.players[0].id, s.players[2].id);
  s.phase = 'ended';
  s.winner = 'evil';
  const app = await loadApp('en');
  assert.match(app.show(viewFor(s, s.players[0].id)), /evil wins/i);
});

// ---------------------------------------------------------------- glossary popups

test('an underlined term opens its definition; closing it removes it; opening another replaces the first', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await dayApp(s, 2);
  const terms = app.root.find((n) => n.hasClass('term'));
  assert.ok(terms.length >= 2, 'the ability text has underlined terms');
  terms[0].click();
  let modal = app.body.find((n) => n.hasClass('term-overlay'));
  assert.equal(modal.length, 1);
  assert.ok(modal[0].text().length > 40, 'a real definition');
  assert.equal(brokenText(modal[0].text()), null);
  const closeBtn = modal[0].buttons().find((b) => b.text() === 'Close')!;
  closeBtn.click();
  assert.equal(app.body.find((n) => n.hasClass('term-overlay')).length, 0);
  terms[0].click();
  terms[1].click();
  assert.equal(app.body.find((n) => n.hasClass('term-overlay')).length, 1, 'one definition at a time');
});

test('a tap on an underlined term does not also trigger the tappable row or button it sits inside', async () => {
  const app = await loadApp('en');
  const parent = app.run<FakeNode>("globalThis.__hits = 0; el('div', { onclick: () => { globalThis.__hits++; } }, [glossify('The Demon wins')])");
  const term = parent.find((n) => n.hasClass('term'))[0];
  assert.ok(term, 'the word is underlined');
  term.click();
  assert.equal(app.run('globalThis.__hits'), 0, 'only the popup opens, not the parent\'s action');
  assert.equal(app.body.find((n) => n.hasClass('term-overlay')).length, 1);
  parent.click();
  assert.equal(app.run('globalThis.__hits'), 1, 'a tap on the parent itself still works');
});

test('every underlined term in every real screen opens a definition that exists', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await dayApp(s, 2);
  for (const t of app.root.find((n) => n.hasClass('term'))) {
    t.click();
    const modal = app.body.find((n) => n.hasClass('term-overlay'))[0];
    assert.ok(modal && modal.text().trim().length > 20, `"${t.text()}" opened nothing`);
    modal.buttons()[0].click();
  }
});

void MIN_ANSWER_MS;

test('during the defense nobody is asked "ready"; only the accused has a button, to start the vote', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const [imp, , empath] = s.players;
  nominate(s, empath.id, imp.id);
  markAllReady(s);
  skipSpeech(s, empath.id); // the accusation is over: straight into the defense
  for (let i = 0; i < 5; i++) {
    const app = await dayApp(s, i);
    assert.ok(!app.root.buttons().some((b) => /ready to hear|prêt à écouter/i.test(b.text())), `player ${i} is not asked to get ready`);
    assert.ok(/responding|répond/i.test(app.text()), `player ${i} sees the accused answering`);
    const done = app.root.buttons().filter((b) => /start the vote|lancer le vote/i.test(b.text()));
    assert.equal(done.length, i === 0 ? 1 : 0, 'only the accused (the Imp) can end the defense');
  }
});

// ---------------------------------------------------------------- sounds and buzzes for accusations and nightfall

/** Sends a view the way the network does (so the app can compare it with the one before). */
function receive(app: FakeClient, view: GameView): void {
  app.run(`state.code = 'ROOM'; state.token = 't'; state.playerId = ${JSON.stringify(view.selfId)}; handleMessage({ t: 'view', view: ${JSON.stringify(view)} });`);
}
const ACCUSE_BUZZ = [120, 60, 120];
const NIGHT_BUZZ = [250];

test('the end-of-day card says you must be seated at your place, in English and in French, for living players only', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const en = await dayApp(s, 2, 'en');
  assert.ok(en.text().includes('(you must be seated at your place)'));
  const card = en.root.find((n) => n.hasClass('card') && n.text().includes("I'm ready to end the day"))[0];
  assert.ok(card.text().includes('seated at your place'), 'the note is inside the same card as the button');
  const fr = await dayApp(s, 2, 'fr');
  assert.ok(fr.text().includes('(vous devez être assis à votre place)'));
  s.players[2].alive = false;
  assert.ok(!(await dayApp(s, 2, 'en')).text().includes('seated at your place'), 'the dead have no such button, so no note');
});

test('being accused plays a sound and buzzes once, for everyone — accuser, accused and onlookers alike', async () => {
  for (const viewer of [0, 2, 3]) {
    const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
    const app = await loadApp('en');
    receive(app, viewFor(s, s.players[viewer].id));
    assert.deepEqual(app.vibrations, [], 'nothing yet');
    nominate(s, s.players[2].id, s.players[0].id);
    receive(app, viewFor(s, s.players[viewer].id));
    assert.deepEqual(app.vibrations, [ACCUSE_BUZZ], `player ${viewer} buzzes once`);
    assert.equal(app.tones.length, 2, 'two notes');
    assert.deepEqual(app.tones.map((t) => t.freq), [660, 880], 'the rising "accusation" sound');
  }
});

test('the accusation sounds once per accusation — not for every later stage of the same one, but again for the next one', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await loadApp('en');
  const me = s.players[3].id;
  receive(app, viewFor(s, me));
  nominate(s, s.players[2].id, s.players[0].id);
  receive(app, viewFor(s, me));
  markAllReady(s);
  receive(app, viewFor(s, me)); // accusing
  skipSpeech(s, s.players[2].id);
  receive(app, viewFor(s, me)); // defending
  receive(app, viewFor(s, me)); // a repeated update
  skipSpeech(s, s.players[0].id);
  receive(app, viewFor(s, me)); // voting
  assert.equal(app.vibrations.length, 1, 'still just the one buzz');
  voteAll(s);
  receive(app, viewFor(s, me)); // the nomination is over
  nominate(s, s.players[1].id, s.players[4].id);
  receive(app, viewFor(s, me));
  assert.deepEqual(app.vibrations, [ACCUSE_BUZZ, ACCUSE_BUZZ], 'a second accusation buzzes again');
});

function voteAll(s: GameState): void {
  let guard = 0;
  while (s.currentNomination?.state === 'voting' && guard++ < 30) castVote(s, s.currentNomination.currentVoterId!, false);
}

test('opening the app in the middle of an accusation is silent (it is not news)', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  nominate(s, s.players[2].id, s.players[0].id);
  const app = await loadApp('en');
  receive(app, viewFor(s, s.players[3].id));
  receive(app, viewFor(s, s.players[3].id));
  assert.deepEqual(app.vibrations, []);
  assert.deepEqual(app.tones, []);
});

test('reconnecting into the same accusation does not repeat the sound', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await loadApp('en');
  receive(app, viewFor(s, s.players[3].id));
  nominate(s, s.players[2].id, s.players[0].id);
  receive(app, viewFor(s, s.players[3].id));
  receive(app, viewFor(s, s.players[3].id)); // the same view again after a reconnect
  assert.equal(app.vibrations.length, 1);
});

test('nightfall plays its own sound and buzzes once, for everyone — and the game start counts as nightfall too', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await loadApp('en');
  receive(app, viewFor(s, s.players[2].id));
  endDayByConsensus(s);
  assert.equal(s.phase, 'night');
  receive(app, viewFor(s, s.players[2].id));
  assert.deepEqual(app.vibrations, [NIGHT_BUZZ]);
  assert.deepEqual(app.tones.map((t) => t.freq), [392, 294, 220], 'a slow falling sound, different from the accusation');
  receive(app, viewFor(s, s.players[2].id)); // a repeated night view
  assert.equal(app.vibrations.length, 1);

  const lobby = createGame('L');
  const ps = Array.from({ length: 5 }, (_, i) => addPlayer(lobby, `Q${i}`));
  ps.forEach((p, i) => declareNeighbor(lobby, p.id, ps[(i + 1) % 5].id));
  const app2 = await loadApp('en');
  receive(app2, viewFor(lobby, ps[0].id));
  startGame(lobby);
  receive(app2, viewFor(lobby, ps[0].id));
  assert.deepEqual(app2.vibrations, [NIGHT_BUZZ], 'starting the game is going into the first night');
});

test('opening the app in the middle of the night is silent', async () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  startNight(s);
  const app = await loadApp('en');
  receive(app, viewFor(s, s.players[2].id));
  assert.deepEqual(app.vibrations, []);
  assert.deepEqual(app.tones, []);
});

test('nothing buzzes or sounds during the night itself: not for a turn, a result, a step, a decoy, or dawn', async () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'fortuneteller', 'chef']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  const app = await loadApp('en');
  const me = byChar(s, 'soldier').id; // a decoy player
  receive(app, viewFor(s, me)); // the app has been open since before this night began? no: opens now
  app.vibrations.length = 0;
  app.tones.length = 0;
  let steps = 0;
  while (s.pendingRealTurn && steps++ < 30) {
    receive(app, viewFor(s, me));
    receive(app, viewFor(s, byChar(s, s.pendingRealTurn.charId === 'minion-info' ? 'poisoner' : (s.pendingRealTurn.charId as CharacterId)).id));
    skipRound(s);
  }
  receive(app, viewFor(s, me));
  assert.deepEqual(app.vibrations, [], 'no buzz at any night step');
  assert.deepEqual(app.tones, [], 'no sound at any night step');
  breakDawn(s);
  receive(app, viewFor(s, me)); // dawn: night -> day
  assert.deepEqual(app.vibrations, [], 'dawn is silent too');
});

test('a whole game seen by one phone: exactly one night sound per night and one accusation sound per accusation', async () => {
  let accusations = 0;
  let nights = 0;
  const app = await loadApp('en');
  let previousPhase = '';
  let previousNom = '';
  const seenAccusations = new Set<string>();
  playGame(3, 7, (s) => {
    const v = viewFor(s, s.players[0].id);
    receive(app, v);
    if (v.phase === 'night' && previousPhase !== 'night' && previousPhase !== '') nights++;
    previousPhase = v.phase;
    const key = v.phase === 'day' && v.nomination ? `${v.day}-${v.nomination.nominatorId}-${v.nomination.nomineeId}` : '';
    if (key && key !== previousNom && !seenAccusations.has(key)) { accusations++; seenAccusations.add(key); }
    previousNom = key;
  });
  const night = app.vibrations.filter((b) => b.length === 1).length;
  const accuse = app.vibrations.filter((b) => b.length === 3 && b[0] === 120).length;
  assert.equal(night, nights, 'one nightfall buzz per night entered');
  assert.equal(accuse, accusations, 'one accusation buzz per accusation');
  assert.ok(nights >= 1 && accusations >= 1);
});

test('the first tap anywhere wakes the audio up (browsers block sound until then), and sound still works afterwards', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await loadApp('en');
  receive(app, viewFor(s, s.players[3].id));
  assert.equal(app.audioResumed(), 0);
  app.fireWindow('pointerdown');
  assert.equal(app.audioResumed(), 1);
  nominate(s, s.players[2].id, s.players[0].id);
  receive(app, viewFor(s, s.players[3].id));
  assert.equal(app.tones.length, 2);
});

test('without audio support the buzz still happens and nothing breaks', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await loadApp('en', {}, { audio: false });
  receive(app, viewFor(s, s.players[3].id));
  nominate(s, s.players[2].id, s.players[0].id);
  assert.doesNotThrow(() => receive(app, viewFor(s, s.players[3].id)));
  assert.deepEqual(app.vibrations, [ACCUSE_BUZZ]);
  assert.deepEqual(app.tones, []);
});

test('a phone with no vibration support still plays the sound', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  const app = await loadApp('en');
  app.run('navigator.vibrate = undefined');
  receive(app, viewFor(s, s.players[3].id));
  nominate(s, s.players[2].id, s.players[0].id);
  assert.doesNotThrow(() => receive(app, viewFor(s, s.players[3].id)));
  assert.equal(app.tones.length, 2);
});

// ---------------------------------------------------------------- the replay on the end screen

/** The scripted 7-player game (see history.test.ts), finished: an execution of the Imp on day 2. */
function scriptedEndedGame(): GameState {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  const [imp, , empath, washerwoman, soldier, monk, chef] = s.players;
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
  let g = 0;
  while (s.currentNomination?.state === 'voting' && g++ < 20) {
    const v = s.currentNomination.currentVoterId!;
    castVote(s, v, [empath.id, soldier.id, chef.id].includes(v));
  }
  endDayByConsensus(s);
  return s;
}
const replayLinesOf = (app: FakeClient) => app.root.find((n) => n.hasClass('replay-line')).map((n) => n.text());

test('the end screen tells the whole story in order: setup, each night and day, and the ending', async () => {
  const s = scriptedEndedGame();
  assert.equal(s.phase, 'ended');
  const app = await loadApp('en');
  app.show(viewFor(s, s.players[3].id), { seen: true });
  assert.ok(app.text().includes('What really happened'));
  const headings = app.root.find((n) => n.tag === 'h3').map((n) => n.text());
  // (This game was built without startGame, so there is no "roles dealt" section — real games have one, below.)
  assert.deepEqual(headings, ['Night 1', 'Day 1', 'Night 2', 'Day 2']);
  const lines = replayLinesOf(app);
  const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
  for (const needle of [
    'P1 (Poisoner) poisons P5 (Monk)',
    'P1 (Poisoner) poisons P5 (Monk)',
    'P5 (Monk) protects P3 (Washerwoman) — ⚠ no effect, they were poisoned',
    'P0 (Imp) (the Demon) attacks P3 (Washerwoman)',
    'P3 (Washerwoman) dies — killed by the Demon',
    'Dawn breaks. Found dead: P3 (Washerwoman)',
    'P2 (Empath) nominates P0 (Imp)',
    'Vote on P0 (Imp): 3 yes (3 needed, 6 alive) — now on the block',
    'P0 (Imp) is executed',
    'P0 (Imp) dies — executed',
    'Good wins: The Demon is dead — good wins!',
  ]) assert.ok(at(needle) >= 0, `the replay says: ${needle}`);
  // Order of the story.
  assert.ok(at('P1 (Poisoner) poisons P5 (Monk)') < at('attacks P3') && at('attacks P3') < at('dies — killed by the Demon'));
  assert.ok(at('Dawn breaks. Found dead') < at('nominates') && at('nominates') < at('Vote on') && at('Vote on') < at('P0 (Imp) is executed') && at('P0 (Imp) is executed') < at('Good wins'));
  assert.equal(lines.filter((l) => l.includes('Good wins')).length, 1);
  assert.ok(!lines.some((l) => /undefined|\[object|NaN/.test(l)));
});

test('the story is told in French too', async () => {
  const s = scriptedEndedGame();
  const app = await loadApp('fr');
  app.show(viewFor(s, s.players[3].id), { seen: true });
  assert.ok(app.text().includes('Ce qui s’est vraiment passé'));
  assert.deepEqual(app.root.find((n) => n.tag === 'h3').map((n) => n.text()), ['Nuit 1', 'Jour 1', 'Nuit 2', 'Jour 2']);
  const lines = replayLinesOf(app);
  for (const needle of ['(Empoisonneur) empoisonne', '(Diablotin) (le Démon) attaque', 'meurt — tué(e) par le Démon', 'nomine', 'Vote sur', 'sur le billot', 'est exécuté(e)', 'Le Bien gagne']) {
    assert.ok(lines.some((l) => l.includes(needle)), `French replay has: ${needle}`);
  }
  assert.ok(!lines.some((l) => /Poisoner|Imp\b|nominates|executed|Dawn/.test(l)), 'no English left in the French replay');
});

test('players are named with their real character, coloured by team: evil in red, good in green', async () => {
  const s = scriptedEndedGame();
  const app = await loadApp('en');
  app.show(viewFor(s, s.players[3].id), { seen: true });
  const names = app.root.find((n) => n.hasClass('rname'));
  assert.ok(names.length > 20);
  const imp = names.find((n) => n.text() === 'P0 (Imp)')!;
  const empath = names.find((n) => n.text() === 'P2 (Empath)')!;
  assert.ok(imp.hasClass('evil') && !imp.hasClass('good'));
  assert.ok(empath.hasClass('good') && !empath.hasClass('evil'));
});

test('a Drunk is shown as the Drunk, with the character they believed they were', async () => {
  const s = mk(['imp', 'poisoner', 'drunk', 'washerwoman', 'soldier', 'monk', 'chef'], { drunkFakeChar: 'empath' });
  startNight(s);
  s.history.unshift({ seq: 0, phase: 'setup', night: 0, day: 0, type: 'roles', vars: {
    players: s.players.map((p) => ({ id: p.id, character: p.character, perceived: p.perceived })), redHerring: null, bluffs: ['virgin', 'mayor', 'saint'] } });
  runFullNight(s);
  s.phase = 'ended';
  s.winner = 'evil';
  const app = await loadApp('en');
  app.show(viewFor(s, s.players[0].id), { seen: true });
  const text = replayLinesOf(app).join('\n');
  assert.ok(text.includes('P2 (Drunk) — believes they are the Empath'));
  assert.ok(/P2 \(Drunk\) learns, as the Empath: .* — ⚠ unreliable, they were drunk/.test(text));
});

test('the replay only exists on the end screen: never while the game is running', async () => {
  const s = scriptedEndedGame();
  const app = await loadApp('en');
  for (const phase of ['day', 'night'] as const) {
    const running = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
    running.phase = phase;
    app.show(viewFor(running, running.players[2].id), { seen: true });
    assert.ok(!app.text().includes('What really happened'), `not during the ${phase}`);
    assert.equal(app.root.find((n) => n.hasClass('replay')).length, 0);
  }
  app.show(viewFor(s, s.players[2].id), { seen: true });
  assert.equal(app.root.find((n) => n.hasClass('replay')).length, 1);
});

test('the replay is the same for every player, and appears for the dead too', async () => {
  const s = scriptedEndedGame();
  const app = await loadApp('en');
  const texts = s.players.map((p) => { app.show(viewFor(s, p.id), { seen: true }); return replayLinesOf(app).join('\n'); });
  assert.ok(texts.every((t) => t === texts[0]) && texts[0].length > 500);
});

test('every kind of event in real games is worded, in both languages, with no broken text (130 games)', async () => {
  const app = await loadApp('en');
  const kinds = new Set<string>();
  const problems: string[] = [];
  for (let n = 5; n <= 15; n++) {
    for (let seed = 0; seed < 12; seed++) {
      const s = playGame(seed, n);
      for (const lang of ['en', 'fr'] as const) {
        app.show(viewFor(s, s.players[0].id), { seen: true, lang });
        const lines = replayLinesOf(app);
        assert.equal(app.root.find((n) => n.tag === 'h3')[0].text(), lang === 'en' ? 'Setup' : 'Mise en place', 'a real game starts with its setup');
        const bad = lines.find((l) => /undefined|\[object|NaN|null|\$\{/.test(l));
        if (bad) problems.push(`${lang} seed ${seed} ${n}p: ${bad}`);
        assert.ok(lines.length >= s.history.filter((e) => e.type !== 'nightStart').length, 'every event has at least one line');
      }
      s.history.forEach((e) => kinds.add(e.type));
    }
  }
  assert.deepEqual(problems.slice(0, 3), []);
  for (const k of ['roles', 'info', 'choice', 'attack', 'death', 'dawn', 'nominate', 'vote', 'execution', 'dayEnd', 'win']) assert.ok(kinds.has(k), `no game produced a ${k} event`);
});

// ---------------------------------------------------------------- the role card: minimised by default, alignment and team tappable

test('the role card starts minimised: a freshly opened app shows no character, no alignment, no colour — only alive status and a Show role button', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  for (const player of [s.players[0], s.players[2]]) {
    const app = await loadApp('en');
    assert.equal(app.run('state.roleHidden'), true, 'minimised by default');
    const v = JSON.stringify(viewFor(s, player.id));
    app.run(`state.code = 'ROOM'; state.token = 'tok'; state.playerId = ${JSON.stringify(player.id)}; state.view = ${v};
      state.ws = { readyState: 1, send: () => {} }; state.dawnSeenForDay = 1; state.duskSeenForNight = 1; state.nightResultSeenForNight = 1; render();`);
    const text = app.text();
    assert.ok(!/Empath|Imp|Good|Evil|Townsfolk|Minion/.test(text), 'nothing about the role is on screen');
    assert.equal(app.root.find((n) => n.hasClass('role-banner') && (n.hasClass('good') || n.hasClass('evil'))).length, 0);
    assert.ok(text.includes('You are alive') && text.includes('Show role'));
    app.root.buttons().find((b) => /Show role/.test(b.text()))!.click();
    assert.ok(/Good|Evil/.test(app.text()), 'one tap on Show role reveals the card');
  }
});

test('"Good"/"Evil" and the team on the role card are tappable and open their definition — both languages, every team', async () => {
  const cases: [string, string, RegExp, RegExp][] = [
    ['empath', 'en', /Good/, /Townsfolk/], ['saint', 'en', /Good/, /Outsider/], ['poisoner', 'en', /Evil/, /Minion/], ['imp', 'en', /Evil/, /Demon/],
    ['empath', 'fr', /Bon/, /Villageois/], ['imp', 'fr', /Maléfique/, /Démon/],
  ];
  for (const [character, lang, align, team] of cases) {
    const s = mkDay(['imp', 'poisoner', 'empath', 'saint', 'soldier']);
    const app = await loadApp(lang as 'en' | 'fr');
    const me = s.players.find((p) => p.character === character)!;
    app.show(viewFor(s, me.id), { seen: true, lang: lang as 'en' | 'fr' });
    for (const label of [align, team]) {
      const link = app.root.find((n) => n.hasClass('term') && label.test(n.text()) && !!n.parent && (n.parent.hasClass('align') || n.parent.hasClass('team')))[0];
      assert.ok(link, `${character}/${lang}: ${label} on the card is a tappable term`);
      link.click();
      const modal = app.body.find((n) => n.hasClass('term-overlay'))[0];
      assert.ok(modal, `${character}/${lang}: a definition opens`);
      assert.ok(/^(good|bien|evil|mal|townsfolk|villageois|outsider|marginal|minion|sbire|demon|démon)/i.test(modal.text()), `${character}/${lang}: it defines ${label}: ${modal.text().slice(0, 60)}`);
      assert.ok(!brokenText(modal.text()));
      app.body.find((n) => n.hasClass('term-overlay')).forEach((o) => o.parent?.children.splice(o.parent.children.indexOf(o), 1));
    }
  }
});

// ---------------------------------------------------------------- the Demon's bluffs only appear in games where the Demon is told them

function seatAndStart(s: GameState, n: number): void {
  const ps = Array.from({ length: n }, (_, i) => addPlayer(s, `P${i}`));
  ps.forEach((p, i) => declareNeighbor(s, p.id, ps[(i + 1) % n].id));
  startGame(s);
}

/** A really started game of `n` players, ended straight away so the replay is visible. */
function startedAndEnded(n: number): GameState {
  const s = createGame('BLUF');
  seatAndStart(s, n);
  s.phase = 'ended';
  s.winner = 'good';
  return s;
}

test('replay log: no "Demon\'s bluffs" line in games of 5 or 6 players (the Demon is never told them); shown from 7', async () => {
  for (const lang of ['en', 'fr'] as const) {
    for (let n = 5; n <= 10; n++) {
      const s = startedAndEnded(n);
      const app = await loadApp(lang);
      app.show(viewFor(s, s.players[0].id), { seen: true, lang });
      const text = replayLinesOf(app).join('\n');
      const has = /bluffs du Démon|Demon's bluffs/.test(text);
      assert.equal(has, n >= 7, `${lang}, ${n} players: bluffs line ${has ? 'shown' : 'absent'}`);
      assert.ok(!brokenText(text));
    }
  }
});

test('at 5-6 players the Demon and Minions are not told about each other (official rule) and the first night has no Demon-info step', () => {
  for (const n of [5, 6]) {
    const s = createGame('NOINFO');
    seatAndStart(s, n);
    assert.ok(!s.history.some((e) => e.type === 'info' && /minionInfo|demonInfo/.test(JSON.stringify(e.vars))), `${n} players: no evil intro`);
    assert.deepEqual((s.history.find((e) => e.type === 'roles')!.vars as { bluffs: string[] }).bluffs, []);
  }
});

// ---------------------------------------------------------------- the client renders the engine's offers, nothing more

test('the client shows the Slayer card and nomination rows exactly when the view says so — it derives no rule itself', async () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'washerwoman', 'soldier']);
  const v = viewFor(s, s.players[2].id);
  const app = await loadApp('en');
  // Same game state, but the engine (the view) withholds everything: the client must follow.
  app.show({ ...v, slayerShotAvailable: false, canNominate: false, nominatableIds: [] }, { seen: true });
  assert.ok(!app.text().includes('Slayer shot'), 'no Slayer card when not offered');
  assert.equal(rows(app).filter((r) => r.listeners.click).length, 0, 'no nomination rows when not offered');
  // And the reverse: only the offered target is tappable.
  app.show({ ...v, canNominate: true, nominatableIds: [s.players[3].id] }, { seen: true });
  assert.equal(rows(app).filter((r) => r.listeners.click).length, 1, 'exactly the offered nominee');
});

// ---------------------------------------------------------------- the replay words every kill and every block by who really did it

import { record } from '../game/history.js';

async function replayOfAttack(vars: Record<string, unknown>, lang: 'en' | 'fr'): Promise<string> {
  const s = mk(['po', 'innkeeper', 'godfather', 'monk', 'sailor', 'soldier', 'tealady']);
  startNight(s);
  record(s, 'attack', { actor: s.players[0].id, target: s.players[1].id, ...vars });
  s.phase = 'ended';
  s.winner = 'good';
  const app = await loadApp(lang);
  app.show(viewFor(s, s.players[3].id), { seen: true, lang });
  return replayLinesOf(app).find((l) => /Po|Godfather|Parrain/.test(l) && /→|attacks|attaque|kills|tue/.test(l)) ?? replayLinesOf(app).join('\n');
}

for (const [by, en, fr] of [['monk', 'Monk', 'Moine'], ['innkeeper', 'Innkeeper', 'Aubergiste'], ['sailor', 'Sailor', 'Marin'], ['tealady', 'Tea Lady', 'Dame de thé']] as const) {
  test(`replay: a Demon attack stopped by the ${en} says so (and not that the Monk did it)`, async () => {
    const line = await replayOfAttack({ outcome: 'blocked', by }, 'en');
    assert.ok(line.includes(en), line);
    if (by !== 'monk') assert.ok(!line.includes('Monk'), line);
    const fline = await replayOfAttack({ outcome: 'blocked', by }, 'fr');
    assert.ok(fline.includes(fr), fline);
    if (by !== 'monk') assert.ok(!fline.includes('Moine'), fline);
  });
}

test('replay: the Soldier is still worded as safe from the Demon', async () => {
  assert.match(await replayOfAttack({ outcome: 'blocked', by: 'soldier' }, 'en'), /Soldier is safe from the Demon/);
});

test('replay: a kill by an ability that is not the Demon\'s attack is not called "the Demon attacks"', async () => {
  for (const [cause, en, fr] of [['godfather', 'Godfather', 'Parrain'], ['gossip', 'Gossip', 'Commère'], ['assassin', 'Assassin', 'Assassin']] as const) {
    const line = await replayOfAttack({ outcome: 'killed', cause }, 'en');
    assert.ok(!line.includes('(the Demon)'), line);
    assert.ok(line.includes(en), line);
    const fline = await replayOfAttack({ outcome: 'killed', cause }, 'fr');
    assert.ok(!fline.includes('(le Démon)'), fline);
    assert.ok(fline.includes(fr), fline);
  }
});

test('replay: a blocked kill by another ability names the ability and who stopped it', async () => {
  const line = await replayOfAttack({ outcome: 'blocked', cause: 'godfather', by: 'innkeeper' }, 'en');
  assert.ok(line.includes('Godfather') && line.includes('Innkeeper'), line);
});

// ---------------------------------------------------------------- icons on a phone

test('regression: every class the app draws a character/team icon with has an explicit size (an unsized SVG fills the whole button)', () => {
  const appJs = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const css = fs.readFileSync(path.resolve('public/style.css'), 'utf8');
  const classes = new Set([...appJs.matchAll(/(?:characterIcon|svgIcon)\([^,()]+,\s*'([a-z-]+)'\)/g)].map((m) => m[1]));
  assert.ok(classes.has('inline'), 'the character buttons (Courtier, Gambler, Juggler...) use "inline"');
  for (const cls of classes) {
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) => new RegExp(`\\.${cls}\\b`).test(sel)).map(([, , body]) => body);
    const sized = rules.some((b) => /\bwidth\s*:/.test(b) && /\bheight\s*:/.test(b))
      || (cls === 'hero-icon' && /\.hero-icon \.icon-svg\s*\{[^}]*width[^}]*height/.test(css));
    assert.ok(sized, `.${cls} has no width/height in style.css`);
  }
  assert.match(css, /\.char-choice svg[^{]*\{[^}]*width:\s*22px[^}]*height:\s*22px/, 'a small icon beside the name on the character buttons');
});

test('regression: the Outsider icon (a crescent moon) is not collapsed to a dot — its inner arc can span the crescent', () => {
  const appJs = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const outsider = /\n {2}outsider: '([^']*)'/.exec(appJs)![1];
  // "M14.5 3 a8.5 8.5 0 1 0 0 17 a<r> ... 0-17z": an arc across a 17-unit chord needs a radius of at least 8.5,
  // or the browser scales it up until it exactly cancels the outer arc — leaving only the small star.
  const inner = /a8\.5 8\.5 0 1 0 0 17a([\d.]+) [\d.]+ 0 0 1 0-17z/.exec(outsider);
  assert.ok(inner, `unexpected crescent path: ${outsider}`);
  assert.ok(Number(inner[1]) > 8.5, 'the inner arc is wider than the gap it spans');
});
