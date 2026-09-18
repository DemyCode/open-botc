// The tips & tricks shown on night screens that carry no real information (public/tips.js), and
// how the app picks one: a fresh random tip for the player's own character every time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { CHARACTERS } from '../game/characters.js';
import type { CharacterId } from '../game/types.js';
import { viewFor, type GameView } from '../game/view.js';
import { playGame } from './driver.js';
import { brokenText, loadApp } from './fakedom.js';
import { advanceUntil, byChar, mk, runFullNight, startNight } from './helpers.js';

const sandbox: Record<string, unknown> = {};
vm.runInNewContext(fs.readFileSync(path.resolve('public/tips.js'), 'utf8') + '\nthis.TIPS = TIPS;', sandbox);
const TIPS = sandbox.TIPS as Record<string, { en: string[]; fr: string[] }>;
const LANGS = ['en', 'fr'] as const;
const withTips = (Object.keys(CHARACTERS) as CharacterId[]).filter((c) => c !== 'drunk');

// ---------------------------------------------------------------- the data

test('every character has tips — except the Drunk, who is shown the tips of the character they believe they are', () => {
  assert.deepEqual(Object.keys(TIPS).sort(), [...withTips].sort());
  assert.ok(!('drunk' in TIPS), 'a Drunk must never see "you are the Drunk" tips');
});

test('each character has at least 5 tips, in both languages, and the two lists line up one for one', () => {
  for (const c of withTips) {
    assert.ok(TIPS[c].en.length >= 5, `${c}: only ${TIPS[c].en.length} tips`);
    assert.equal(TIPS[c].fr.length, TIPS[c].en.length, `${c}: English and French lists must be the same length (the same tip keeps its place when the language changes)`);
  }
});

test('every tip is real, short enough for a phone, and never repeated within a character', () => {
  const problems: string[] = [];
  for (const c of withTips) {
    for (const lang of LANGS) {
      const list = TIPS[c][lang];
      if (new Set(list).size !== list.length) problems.push(`${c}/${lang}: duplicate tip`);
      list.forEach((tip, i) => {
        const why = brokenText(tip);
        if (why) problems.push(`${c}/${lang}#${i}: ${why}`);
        if (tip.length < 40 || tip.length > 460) problems.push(`${c}/${lang}#${i}: length ${tip.length}`);
        if (tip !== tip.trim()) problems.push(`${c}/${lang}#${i}: stray whitespace`);
        if (!/[.!?»)]$/.test(tip)) problems.push(`${c}/${lang}#${i}: does not end like a sentence`);
      });
    }
  }
  assert.deepEqual(problems, []);
});

test('the French tips are translations, not copies of the English ones', () => {
  for (const c of withTips) TIPS[c].fr.forEach((tip, i) => assert.notEqual(tip, TIPS[c].en[i], `${c}#${i} is untranslated`));
});

test('the French tips really are French: no tip is a leftover English sentence', () => {
  const englishWords = /\b(the|you|your|and|with|if|they|their|when|are|is|of|to)\b/gi;
  for (const c of withTips) {
    TIPS[c].fr.forEach((tip, i) => {
      const hits = (tip.match(englishWords) ?? []).length;
      assert.ok(hits <= 2, `${c}#${i} looks English: "${tip.slice(0, 80)}"`);
    });
  }
});

test('tips are about the right character: each mentions its own role or ability somewhere in the list', () => {
  const names: Record<string, RegExp> = {
    washerwoman: /Washerwoman|Townsfolk/i, librarian: /Outsider/i, investigator: /Minion/i, chef: /evil/i, empath: /neighbour/i,
    fortuneteller: /Demon/i, undertaker: /execut/i, monk: /protect/i, ravenkeeper: /Ravenkeeper|die at night|kill you/i, virgin: /nominat/i,
    slayer: /shot|shoot|slay/i, soldier: /Soldier|Demon attacks you/i, mayor: /Mayor/i, butler: /Master/i, recluse: /Recluse|register/i,
    saint: /execut/i, poisoner: /poison/i, spy: /Grimoire/i, scarletwoman: /Demon/i, baron: /Outsider/i, imp: /Minion|Demon|kill/i,
  };
  for (const c of withTips) assert.ok(TIPS[c].en.some((t) => names[c].test(t)), `${c}: no tip mentions ${names[c]}`);
});

// ---------------------------------------------------------------- what a player sees

/** A decoy "information" screen for a player whose role banner says `character` (the step's own character is irrelevant to the tip). */
function decoyView(character: CharacterId, stepKey = '2-1'): GameView {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'empath');
  const v = JSON.parse(JSON.stringify(viewFor(s, byChar(s, 'soldier').id))) as GameView;
  assert.equal(v.nightTurn!.decoy, true);
  assert.equal(v.nightTurn!.body.key, 'decoyInfo', 'an information-step decoy');
  v.nightTurn!.stepKey = stepKey;
  v.myCharacter = { id: character, name: CHARACTERS[character].name, ability: CHARACTERS[character].ability, alignment: 'good' } as GameView['myCharacter'];
  return v;
}
const tipOnScreen = (text: string, character: CharacterId, lang: 'en' | 'fr') => TIPS[character][lang].findIndex((t) => text.includes(t));

test('the decoy information screen shows a tip for the player\'s own character instead of "nothing to learn" — every character, both languages', async () => {
  const app = await loadApp('en');
  for (const character of withTips) {
    for (const lang of LANGS) {
      const text = app.show(decoyView(character), { seen: true, lang });
      assert.ok(tipOnScreen(text, character, lang) >= 0, `${character}/${lang}: no tip from ${character}'s list is on the screen`);
      assert.ok(!/Nothing to learn|Rien à apprendre/.test(text), `${character}/${lang}: the placeholder is still there`);
      assert.ok(text.includes(lang === 'en' ? 'Tip from the Blood on the Clocktower wiki' : 'Astuce du wiki Blood on the Clocktower'), 'the source is credited');
      for (const other of withTips) {
        if (other !== character) assert.ok(tipOnScreen(text, other, lang) < 0, `${character}: a tip of ${other} leaked onto the screen`);
      }
    }
  }
});

test('the tip is random: over 60 new screens a character sees many different tips, and never the same one twice in a row', async () => {
  const app = await loadApp('en');
  const seen: number[] = [];
  for (let i = 0; i < 60; i++) seen.push(tipOnScreen(app.show(decoyView('empath', `2-${i}`), { seen: true }), 'empath', 'en'));
  assert.ok(seen.every((i) => i >= 0));
  assert.ok(new Set(seen).size >= 4, `only ${new Set(seen).size} different tips in 60 screens`);
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], 'never the same tip twice in a row');
});

test('every tip of a character shows up eventually (the pick is uniform, not stuck on a few)', async () => {
  const app = await loadApp('en');
  const seen = new Set<number>();
  for (let i = 0; i < 400; i++) seen.add(tipOnScreen(app.show(decoyView('poisoner', `2-${i}`), { seen: true }), 'poisoner', 'en'));
  assert.equal(seen.size, TIPS.poisoner.en.length);
});

test('while the same screen refreshes (the countdown ticks) the tip does not change', async () => {
  const app = await loadApp('en');
  const view = decoyView('slayer', '2-7');
  const first = tipOnScreen(app.show(view, { seen: true }), 'slayer', 'en');
  for (let i = 0; i < 20; i++) assert.equal(tipOnScreen(app.show(view, { seen: true }), 'slayer', 'en'), first);
});

test('switching language keeps the same tip, translated', async () => {
  const app = await loadApp('en');
  const view = decoyView('mayor', '2-3');
  const en = tipOnScreen(app.show(view, { seen: true, lang: 'en' }), 'mayor', 'en');
  const fr = tipOnScreen(app.show(view, { seen: true, lang: 'fr' }), 'mayor', 'fr');
  assert.equal(fr, en);
  assert.ok(en >= 0);
});

test('a Drunk is shown the tips of the character they believe they are — never Drunk tips', async () => {
  const s = mk(['imp', 'poisoner', 'drunk', 'washerwoman', 'soldier', 'monk', 'chef'], { drunkFakeChar: 'empath' });
  startNight(s); // night 1: the Washerwoman's information step, at which the Drunk (believing they are the Empath) gets a decoy
  advanceUntil(s, 'washerwoman');
  const drunk = byChar(s, 'drunk');
  const app = await loadApp('en');
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) {
    const v = JSON.parse(JSON.stringify(viewFor(s, drunk.id))) as GameView;
    v.nightTurn!.stepKey = `2-${i}`;
    assert.equal(v.myCharacter!.id, 'empath');
    const text = app.show(v, { seen: true });
    const index = tipOnScreen(text, 'empath', 'en');
    assert.ok(index >= 0, 'an Empath tip');
    seen.add(index);
    assert.ok(!/Drunk/.test(text.split('💡')[1] ?? ''), 'the tip never mentions being the Drunk');
  }
  assert.ok(seen.size > 1);
});

test('a real information screen is unchanged: it shows the real information, no tip', async () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'empath');
  const app = await loadApp('en');
  const text = app.show(viewFor(s, byChar(s, 'empath').id), { seen: true });
  assert.ok(text.includes('Your Information'));
  assert.ok(!text.includes('💡'), 'no tip on a real information screen');
  assert.ok(!text.includes('Tip from the'));
});

test('a decoy that stands in for a result screen (Fortune Teller / Ravenkeeper step) also shows a tip', async () => {
  const s = mk(['imp', 'poisoner', 'fortuneteller', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  const v = viewFor(s, byChar(s, 'soldier').id);
  assert.equal(v.nightTurn!.decoyResult, true);
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(v)}); state.turnReadyAt = 0;`);
  app.show(v, { seen: true });
  app.root.find((n) => n.hasClass('choice')).slice(0, 2).forEach((c) => { c.click(); app.run('render()'); });
  app.root.buttons().find((b) => /^Confirm/.test(b.text()))!.click();
  const text = app.run<string>("(function(){ render(); return document.getElementById('app').textContent; })()");
  assert.ok(text.includes('Your Result'));
  assert.ok(tipOnScreen(text, 'soldier', 'en') >= 0, 'a Soldier tip');
  assert.ok(!text.includes('Nothing to learn'));
});

test('a player whose character has no tips (should never happen) still gets the old placeholder rather than an empty screen', async () => {
  const app = await loadApp('en');
  const text = app.show(decoyView('imp'), { seen: true });
  assert.ok(tipOnScreen(text, 'imp', 'en') >= 0, 'sanity: the Imp has tips');
  const v = decoyView('imp');
  v.myCharacter!.id = 'nobody' as CharacterId;
  assert.ok(app.show(v, { seen: true }).includes('Nothing to learn at this step'));
});

test('over whole games, no player is ever dealt a perceived character without tips', () => {
  for (let n = 5; n <= 15; n++) {
    const s = playGame(1, n);
    for (const p of s.players) assert.ok(p.perceived in TIPS, `${p.perceived} has no tips`);
  }
});

test('the very first tip a player sees is random too: over 60 freshly opened apps it is not always the same one', async () => {
  const first = new Set<number>();
  for (let i = 0; i < 60; i++) {
    const app = await loadApp('en');
    first.add(tipOnScreen(app.show(decoyView('imp', '2-1'), { seen: true }), 'imp', 'en'));
  }
  assert.ok(first.size >= 4, `the first tip was one of only ${first.size} different ones in 60 fresh starts`);
});
