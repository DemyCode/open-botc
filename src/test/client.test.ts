// The real browser code (public/app.js) running in a fake browser, fed real game views. Catches
// what no engine test can: a screen that throws, shows "undefined", or a button that sends the
// wrong message.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPlayer, createGame, declareNeighbor, nominate, skipSpeech, useSlayer } from '../game/engine.js';
import { MIN_ANSWER_MS } from '../game/night.js';
import type { GameState } from '../game/types.js';
import { viewFor, type GameView } from '../game/view.js';
import { playGame } from './driver.js';
import { brokenText, loadApp, type FakeClient, type FakeNode } from './fakedom.js';
import {
  advanceUntil, answerRealTurn, byChar, fastForwardToVote, markAllReady, mk, mkDay, runFullNight, skipRound, startNight,
} from './helpers.js';

const KNOWN_MESSAGES = new Set(['join', 'auth', 'leave', 'start', 'declareNeighbor', 'nightReal', 'nominate', 'skipSpeech', 'readySpeech', 'vote', 'endDay', 'slayer']);
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
  app.run('showRolesModal()');
  await new Promise((r) => setImmediate(r));
  const overlay = app.body.find((n) => n.hasClass('modal-overlay'))[0];
  assert.ok(overlay, 'the modal opened');
  const cards = overlay.find((n) => n.hasClass('roles-card'));
  assert.equal(cards.length, 22);
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

test('the Slayer-shot card is shown to every living player who has not fired — not only to the Slayer', async () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'washerwoman', 'soldier']);
  for (const i of [0, 1, 2, 3, 4]) assert.ok((await dayApp(s, i)).text().includes('Slayer shot'), `player ${i}`);
});

test('the Slayer-shot card is gone once your shot is spent, when you are dead, and at night', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  useSlayer(s, s.players[2].id, s.players[0].id);
  assert.ok(!(await dayApp(s, 2)).text().includes('Slayer shot'), 'spent');
  assert.ok((await dayApp(s, 3)).text().includes('Slayer shot'), 'others still have theirs');
  const dead = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  dead.players[2].alive = false;
  assert.ok(!(await dayApp(dead, 2)).text().includes('Slayer shot'), 'dead');
  const night = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  startNight(night);
  const app = await loadApp('en');
  app.show(viewFor(night, night.players[2].id), { seen: true });
  assert.ok(!app.text().includes('Slayer shot'), 'night');
});

test('firing the Slayer shot asks to confirm and sends {slayer, target}; a bluffer sends the very same message', async () => {
  const s = mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);
  for (const i of [1, 2]) {
    const app = await dayApp(s, i);
    const card = app.root.find((n) => n.hasClass('card') && n.text().startsWith('Slayer shot'))[0];
    const choice = card.find((n) => n.hasClass('choice'))[0];
    choice.click();
    assert.equal(app.confirms.length, 1);
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
  markAllReady(s);
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

test('a night "pick players" screen: the button counts down 5 seconds, then unlocks; nothing to pick → still locked', async () => {
  const { view } = nightView('poisoner', 'actor');
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(view)})`);
  app.show(view, { seen: true });
  let confirm = app.root.buttons().find((b) => /^Confirm/.test(b.text()))!;
  assert.match(confirm.text(), /\(\d\)/, 'a countdown while waiting');
  assert.equal(confirm.disabled, true);
  app.run('state.turnReadyAt = 0');
  app.show(view, { seen: true });
  confirm = app.root.buttons().find((b) => /^Confirm/.test(b.text()))!;
  assert.equal(confirm.text(), 'Confirm');
  assert.equal(confirm.disabled, true, 'still locked until someone is chosen');
});

test('a night screen: choosing a player then Confirm sends exactly that choice, once the wait is over', async () => {
  const { s, view } = nightView('poisoner', 'actor');
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(view)}); state.turnReadyAt = 0;`);
  app.show(view, { seen: true });
  app.root.find((n) => n.hasClass('choice'))[3].click();
  app.run('render()');
  const confirm = app.root.buttons().find((b) => /^Confirm/.test(b.text()))!;
  assert.equal(confirm.disabled, false);
  confirm.click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [s.players[3].id] });
});

test('during the wait a tap on Confirm does nothing (the button is locked and the handler refuses too)', async () => {
  const { view } = nightView('poisoner', 'actor');
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(view)})`);
  app.show(view, { seen: true });
  app.root.find((n) => n.hasClass('choice'))[1].click();
  app.root.buttons().find((b) => /^Confirm/.test(b.text()))!.click();
  assert.ok(!app.sent.some((m) => m.t === 'nightReal'), 'nothing sent before the 5 seconds are up');
});

test('the Fortune Teller\'s screen asks for exactly two players', async () => {
  const { view } = nightView('fortuneteller', 'actor');
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(view)}); state.turnReadyAt = 0;`);
  app.show(view, { seen: true });
  const choices = () => app.root.find((n) => n.hasClass('choice'));
  choices()[0].click(); app.run('render()');
  assert.equal(app.root.buttons().find((b) => /^Confirm/.test(b.text()))!.disabled, true, 'one is not enough');
  choices()[1].click(); app.run('render()');
  assert.equal(app.root.buttons().find((b) => /^Confirm/.test(b.text()))!.disabled, false);
  choices()[2].click(); app.run('render()'); // a third replaces the oldest
  assert.equal(app.root.find((n) => n.hasClass('choice') && n.hasClass('selected')).length, 2);
});

test('an info screen has a "Got it" button that sends an empty answer once unlocked', async () => {
  const { view } = nightView('washerwoman', 'actor');
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(view)}); state.turnReadyAt = 0;`);
  app.show(view, { seen: true });
  assert.ok(app.text().includes('Your Information'));
  app.root.buttons().find((b) => b.text() === 'Got it')!.click();
  assert.deepEqual(app.sent.at(-1), { t: 'nightReal', targetIds: [] });
});

test('a decoy looks like a real turn: same title, same grid, plus a note — and the same countdown', async () => {
  const real = nightView('poisoner', 'actor');
  const decoy = nightView('poisoner', 'other');
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(real.view)})`);
  const realText = app.show(real.view, { seen: true });
  const realChoices = app.root.find((n) => n.hasClass('choice')).length;
  app.run(`handleTurnChange(${JSON.stringify(decoy.view)})`);
  const decoyText = app.show(decoy.view, { seen: true });
  assert.equal(app.root.find((n) => n.hasClass('choice')).length, realChoices);
  assert.ok(realText.includes('Your Turn') && decoyText.includes('Your Turn'));
  assert.ok(decoyText.includes('Decoy') && !realText.includes('Decoy'));
  assert.match(app.root.buttons().find((b) => /^Confirm/.test(b.text()))!.text(), /\(\d\)/);
});

test('after answering a decoy at the Fortune Teller\'s step, a stand-in result screen appears — like the real one', async () => {
  const decoy = nightView('fortuneteller', 'other');
  assert.equal(decoy.view.nightTurn!.decoyResult, true);
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(decoy.view)}); state.turnReadyAt = 0;`);
  app.show(decoy.view, { seen: true });
  app.root.find((n) => n.hasClass('choice')).slice(0, 2).forEach((c) => { c.click(); app.run('render()'); });
  app.root.buttons().find((b) => /^Confirm/.test(b.text()))!.click();
  const after = app.run<string>("(function(){ render(); return document.getElementById('app').textContent; })()");
  assert.ok(after.includes('Your Result'), after.slice(0, 200));
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

test('a Fortune Teller\'s result is a screen of its own that needs a tap, even if the night is already over', async () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'fortuneteller']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  answerRealTurn(s, [byChar(s, 'imp').id, byChar(s, 'empath').id]);
  while (s.pendingRealTurn) skipRound(s);
  const app = await loadApp('en');
  const text = app.show(viewFor(s, byChar(s, 'fortuneteller').id), { seen: false });
  assert.ok(text.includes('Your Result'), text.slice(0, 200));
  assert.match(text, /Yes|No/);
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
