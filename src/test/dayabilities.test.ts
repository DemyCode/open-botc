// Public day abilities (Juggler, Gossip, Moonchild, Klutz, Mutant, the Slayer...) can be used by their
// real character — or BLUFFED by anyone the rule allows, with no effect. The app says which: "Make your
// prediction as the Juggler" for the real one, "Bluff to be the Juggler" (with a warning and a
// confirmation) for everyone else. Private ones (Savant, Artist) are only ever your own.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useDayAbility, offeredActions } from '../game/dayactions.js';
import type { GameState } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { loadApp, type FakeClient } from './fakedom.js';
import { breakDawn, byChar, byPerceived, endDayByConsensus, mk, mkDay, playRounds, runFullNight, startNight } from './helpers.js';

async function dayApp(s: GameState, playerId: string, lang: 'en' | 'fr' = 'en'): Promise<FakeClient> {
  const app = await loadApp(lang);
  app.show(viewFor(s, playerId), { seen: true, lang });
  return app;
}
/** Re-renders the app on the current view (the app keeps its in-progress form between renders). */
const rerender = (app: FakeClient) => app.run('render()');
const card = (app: FakeClient, title: RegExp) => app.root.find((n) => n.hasClass('day-ability') && title.test(n.text()))[0];
const buttonIn = (node: ReturnType<typeof card>, label: RegExp) => node.find((n) => n.tag === 'button' && label.test(n.text()))[0];

// ---------------------------------------------------------------- the engine: who is offered what

test('the Juggler on day 1: every living player may make (or bluff) the prediction — it is "mine" only for the Juggler', () => {
  const s = mkDay(['imp', 'poisoner', 'juggler', 'soldier', 'monk', 'chef', 'mayor']);
  for (const p of s.players) {
    const offer = offeredActions(s, p).find((o) => o.character === 'juggler');
    assert.ok(offer, `${p.character} is offered it`);
    assert.equal(offer!.mine, p.character === 'juggler', `${p.character}: mine?`);
    assert.equal(offer!.form, 'guesses');
    assert.equal(offer!.public, true);
  }
  s.day = 2;
  assert.ok(!offeredActions(s, byChar(s, 'juggler')).some((o) => o.character === 'juggler'), 'only on the 1st day');
});

test('a Drunk who thinks they are the Juggler sees it as their own (they must never learn otherwise)', () => {
  const s = mkDay(['imp', 'poisoner', 'drunk', 'soldier', 'monk', 'chef', 'mayor']);
  s.scriptChars = [...s.scriptChars, 'juggler'];
  byChar(s, 'drunk').perceived = 'juggler';
  assert.equal(offeredActions(s, byPerceived(s, 'juggler')).find((o) => o.character === 'juggler')!.mine, true);
});

test('the Juggler guesses 1 to 5 players, each a character of the script — up to 5 publicly announced at once', () => {
  const s = mkDay(['imp', 'poisoner', 'juggler', 'soldier', 'monk', 'chef', 'mayor']);
  const j = byChar(s, 'juggler');
  const g = (c: string, v: string) => ({ p: byChar(s, c).id, v });
  assert.throws(() => useDayAbility(s, j.id, 'juggler', [], { guesses: [] }), /at least one/);
  assert.throws(() => useDayAbility(s, j.id, 'juggler', [], { guesses: [g('imp', 'imp'), g('poisoner', 'poisoner'), g('soldier', 'soldier'), g('monk', 'monk'), g('chef', 'chef'), g('mayor', 'mayor')] }), /At most 5/);
  assert.throws(() => useDayAbility(s, j.id, 'juggler', [], { guesses: [g('imp', 'zombuul')] }), /unknown character/, 'not on this script');
  useDayAbility(s, j.id, 'juggler', [], { guesses: [g('imp', 'imp'), g('poisoner', 'spy'), g('soldier', 'soldier'), g('monk', 'monk'), g('chef', 'chef')] });
  assert.equal(s.publicLog.at(-1)!.key, 'jugglerGuesses');
  assert.equal((s.publicLog.at(-1)!.vars!.names as string[]).length, 5);
});

test('a bluffed Juggler prediction is announced exactly like a real one, and learns nothing that night', () => {
  const s = mk(['imp', 'poisoner', 'juggler', 'soldier', 'monk', 'chef', 'mayor']);
  startNight(s);
  runFullNight(s);
  const soldier = byChar(s, 'soldier');
  useDayAbility(s, soldier.id, 'juggler', [], { guesses: [{ p: byChar(s, 'imp').id, v: 'imp' }] });
  assert.equal(s.publicLog.at(-1)!.key, 'jugglerGuesses');
  assert.equal(s.publicLog.at(-1)!.vars!.name, soldier.name);
  endDayByConsensus(s);
  runFullNight(s);
  assert.ok(!soldier.log.some((l) => l.msg.key === 'jugglerInfo'), 'the bluffer is never woken with a count');
});

test('"each day" abilities are offered again the next day (Gossip, Savant); once-per-game ones are not (Artist)', () => {
  const s = mkDay(['imp', 'poisoner', 'gossip', 'savant', 'artist', 'chef', 'mayor']);
  s.scriptChars = [...new Set([...s.scriptChars, 'savant', 'artist'])];
  const has = (c: string, id: string) => offeredActions(s, byChar(s, c)).some((o) => o.character === id);
  useDayAbility(s, byChar(s, 'gossip').id, 'gossip', [], { statement: { t: 'alive', p: byChar(s, 'chef').id, v: true } });
  useDayAbility(s, byChar(s, 'savant').id, 'savant', [], {});
  useDayAbility(s, byChar(s, 'artist').id, 'artist', [], { statement: { t: 'alive', p: byChar(s, 'chef').id, v: true } });
  assert.ok(!has('gossip', 'gossip') && !has('savant', 'savant') && !has('artist', 'artist'), 'used today');
  s.day = 2;
  assert.ok(has('gossip', 'gossip'), 'the Gossip may speak again the next day');
  assert.ok(has('savant', 'savant'), 'the Savant may visit again the next day');
  assert.ok(!has('artist', 'artist'), 'the Artist asks once per game');
});

test('the Cerenovus\' mad player is offered to claim the character they are mad about — never shown the Cerenovus', () => {
  const s = mkDay(['imp', 'cerenovus', 'chef', 'soldier', 'monk', 'empath', 'mayor']);
  s.data.mad = { player: byChar(s, 'chef').id, character: 'savant', by: byChar(s, 'cerenovus').id };
  const offer = offeredActions(s, byChar(s, 'chef')).find((o) => o.character === 'cerenovus')!;
  assert.equal(offer.claimAs, 'savant');
  assert.equal(offer.mine, true, 'no bluff warning: it is what the madness demands');
  assert.ok(!offeredActions(s, byChar(s, 'soldier')).some((o) => o.character === 'cerenovus'), 'nobody else');
});

// ---------------------------------------------------------------- the app: labels, warnings, forms

test('the real Juggler reads "Make your prediction as the Juggler" — no bluff warning — and can guess 5 players, then announce', async () => {
  const s = mkDay(['imp', 'poisoner', 'juggler', 'soldier', 'monk', 'chef', 'mayor']);
  const j = byChar(s, 'juggler');
  const app = await dayApp(s, j.id);
  const title = /Make your prediction as the Juggler/;
  assert.ok(card(app, title), app.text().slice(0, 400));
  assert.ok(!app.text().includes('Bluff to be the Juggler'));
  assert.ok(!card(app, title).text().includes('🎭'), 'no bluff note');
  const picks: [string, string][] = [['imp', 'Imp'], ['poisoner', 'Poisoner'], ['soldier', 'Soldier'], ['monk', 'Monk'], ['chef', 'Chef']];
  for (const [who, role] of picks) {
    const p = byChar(s, who);
    card(app, title).find((n) => n.hasClass('choice') && n.text().includes(p.name))[0].click();
    rerender(app);
    assert.match(card(app, title).text(), new RegExp(`Which character is ${p.name}\\?`));
    card(app, title).find((n) => n.hasClass('char-choice') && n.text().trim() === role)[0].click();
    rerender(app);
  }
  assert.equal(card(app, title).find((n) => n.hasClass('choice')).length, 0, 'no 6th guess');
  buttonIn(card(app, title), /Announce my 5 guesses/).click();
  assert.equal(app.confirms.length, 0, 'your own ability: no warning');
  assert.deepEqual(app.sent.at(-1), {
    t: 'dayAbility', character: 'juggler', targetIds: [],
    payload: { guesses: picks.map(([who, role]) => ({ p: byChar(s, who).id, v: role.toLowerCase() })) },
  });
});

test('anyone else reads "Bluff to be the Juggler", with a warning — and must confirm before it goes out', async () => {
  const s = mkDay(['imp', 'poisoner', 'juggler', 'soldier', 'monk', 'chef', 'mayor']);
  const soldier = byChar(s, 'soldier');
  const app = await dayApp(s, soldier.id);
  const title = /Bluff to be the Juggler/;
  assert.ok(card(app, title));
  assert.match(card(app, title).text(), /You are not the Juggler/);
  card(app, title).find((n) => n.hasClass('choice') && n.text().includes(byChar(s, 'imp').name))[0].click();
  rerender(app);
  card(app, title).find((n) => n.hasClass('char-choice') && n.text().trim() === 'Imp')[0].click();
  rerender(app);
  // Cancelling the warning sends nothing.
  app.run('confirm = function (m) { __confirms.push(m); return false; }');
  (app.ctx as Record<string, unknown>).__confirms = app.confirms;
  buttonIn(card(app, title), /Announce my 1 guess/).click();
  assert.match(app.confirms.at(-1)!, /You will tell the village that you are the Juggler/);
  assert.ok(!app.sent.some((m) => m.t === 'dayAbility'), 'nothing sent when cancelled');
  app.run('confirm = function (m) { __confirms.push(m); return true; }');
  buttonIn(card(app, title), /Announce my 1 guess/).click();
  assert.deepEqual(app.sent.at(-1), { t: 'dayAbility', character: 'juggler', targetIds: [], payload: { guesses: [{ p: byChar(s, 'imp').id, v: 'imp' }] } });
});

test('in French too: "Faire votre prédiction en tant que Jongleur" / "Bluffer : se faire passer pour Jongleur"', async () => {
  const s = mkDay(['imp', 'poisoner', 'juggler', 'soldier', 'monk', 'chef', 'mayor']);
  assert.match((await dayApp(s, byChar(s, 'juggler').id, 'fr')).text(), /Faire votre prédiction en tant que Jongleur/);
  const bluff = (await dayApp(s, byChar(s, 'soldier').id, 'fr')).text();
  assert.match(bluff, /Bluffer : se faire passer pour Jongleur/);
  assert.match(bluff, /Vous n’êtes pas Jongleur/);
});

test('the Gossip builds a statement from buttons — what, about whom, which — sees it as a sentence, and announces it', async () => {
  const s = mkDay(['imp', 'poisoner', 'gossip', 'soldier', 'monk', 'chef', 'mayor']);
  const gossip = byChar(s, 'gossip');
  const imp = byChar(s, 'imp');
  const app = await dayApp(s, gossip.id);
  const title = /Make a public statement as the Gossip/;
  buttonIn(card(app, title), /is a Townsfolk \/ Outsider/).click(); rerender(app);
  card(app, title).find((n) => n.hasClass('choice') && n.text().includes(imp.name))[0].click(); rerender(app);
  buttonIn(card(app, title), /^the Demon$/).click(); rerender(app);
  assert.match(card(app, title).text(), new RegExp(`Your statement: “${imp.name} is the Demon”`));
  buttonIn(card(app, title), /Announce it publicly/).click();
  assert.deepEqual(app.sent.at(-1), { t: 'dayAbility', character: 'gossip', targetIds: [], payload: { statement: { t: 'team', p: imp.id, v: 'demon' } } });
});

test('statements are shown as sentences, never as raw data — in the public log, in both languages', async () => {
  const s = mkDay(['imp', 'poisoner', 'gossip', 'soldier', 'monk', 'chef', 'mayor']);
  const imp = byChar(s, 'imp');
  useDayAbility(s, byChar(s, 'gossip').id, 'gossip', [], { statement: { t: 'team', p: imp.id, v: 'demon' } });
  const en = (await dayApp(s, byChar(s, 'soldier').id)).text();
  assert.ok(en.includes(`makes a public statement: “${imp.name} is the Demon”`), en.slice(-600));
  assert.ok(!/"t":|\{"/.test(en), 'no JSON on screen');
  const fr = (await dayApp(s, byChar(s, 'soldier').id, 'fr')).text();
  assert.ok(fr.includes(`« ${imp.name} est le Démon »`), fr.slice(-600));
});

test('a dead player sees "Bluff to be the Moonchild" and may only point at a living player; the real Moonchild sees their own', async () => {
  const s = mkDay(['imp', 'poisoner', 'moonchild', 'soldier', 'monk', 'chef', 'mayor']);
  // The Moonchild and the Chef died last night (so they learn it today); the Monk died on an earlier night.
  for (const c of ['moonchild', 'chef']) Object.assign(byChar(s, c), { alive: false, diedTonight: true });
  byChar(s, 'monk').alive = false;
  const mine = await dayApp(s, byChar(s, 'moonchild').id);
  assert.ok(card(mine, /Choose a player as the Moonchild/));
  const bluff = await dayApp(s, byChar(s, 'chef').id);
  const c = card(bluff, /Bluff to be the Moonchild/);
  assert.ok(c);
  const names = c.find((n) => n.hasClass('choice')).map((n) => n.text());
  assert.ok(!names.some((n) => n.includes(byChar(s, 'monk').name)), 'a dead player is not offered');
  assert.equal(names.length, s.players.filter((p) => p.alive).length);
});

test('the Savant visits the Storyteller with one button, and the two statements come back as sentences', async () => {
  const s = mkDay(['imp', 'poisoner', 'savant', 'soldier', 'monk', 'chef', 'mayor']);
  const savant = byChar(s, 'savant');
  const app = await dayApp(s, savant.id);
  buttonIn(card(app, /Visit the Storyteller \(Savant\)/), /^Visit the Storyteller$/).click();
  assert.deepEqual(app.sent.at(-1), { t: 'dayAbility', character: 'savant', targetIds: [], payload: {} });
  useDayAbility(s, savant.id, 'savant', [], {});
  const after = (await dayApp(s, savant.id)).text();
  assert.match(after, /Two statements, one true and one false: \(1\) .+\. \(2\) .+\./);
  assert.ok(!/"t":/.test(after), 'no JSON');
});

// ---------------------------------------------------------------- "When you learn that you died": that day only

/** Plays night `n` with the Imp killing `victim` (by true character), then dawn. */
function killAtNight(s: GameState, victim: string): void {
  startNight(s);
  while (s.pendingRealTurn) {
    const t = s.pendingRealTurn;
    if (t.charId === 'imp') playRounds(s, 1, Object.fromEntries(t.playerIds.map((id) => [id, [[byChar(s, victim).id]]])), undefined, true);
    else playRounds(s, 1, {}, undefined, true);
  }
  breakDawn(s);
}
const offers = (s: GameState, c: string) => offeredActions(s, byChar(s, c)).map((o) => o.character);

test('regression: the Moonchild (real or bluffed) is offered only on the day you learn you died — never to someone long dead', () => {
  const s = mk(['imp', 'poisoner', 'moonchild', 'soldier', 'monk', 'chef', 'mayor', 'empath']);
  startNight(s);
  runFullNight(s);
  endDayByConsensus(s);
  killAtNight(s, 'chef'); // night 2: the Chef dies
  assert.ok(offers(s, 'chef').includes('moonchild'), 'day 2: the Chef has just learned they died — they may bluff it');
  endDayByConsensus(s);
  killAtNight(s, 'moonchild'); // night 3: the real Moonchild dies
  assert.ok(!offers(s, 'chef').includes('moonchild'), 'day 3: the Chef died two days ago — no longer offered');
  assert.ok(offers(s, 'moonchild').includes('moonchild'), 'day 3: the Moonchild has just learned they died');
  endDayByConsensus(s);
  killAtNight(s, 'monk');
  assert.ok(!offers(s, 'moonchild').includes('moonchild'), 'day 4: the moment has passed');
});

test('a player executed today learns it at once: they may choose (or bluff) as the Moonchild or the Klutz that same day', () => {
  const s = mkDay(['imp', 'poisoner', 'moonchild', 'klutz', 'monk', 'chef', 'mayor', 'empath']);
  s.scriptChars = [...new Set([...s.scriptChars, 'klutz'])];
  const chef = byChar(s, 'chef');
  chef.alive = false;
  s.data.diedToday = [chef.id]; // executed this afternoon
  assert.ok(offers(s, 'chef').includes('moonchild'));
  assert.ok(offers(s, 'chef').includes('klutz'));
  const longDead = byChar(s, 'empath');
  longDead.alive = false; // died on an earlier day
  assert.deepEqual(offeredActions(s, longDead).map((o) => o.character).filter((c) => c === 'moonchild' || c === 'klutz'), []);
});
