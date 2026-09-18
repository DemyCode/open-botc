// The reading material shown on night screens that carry no real information: every tip and every
// bluffing idea of the player's own character (public/tips.js — all the bullets of the wiki page),
// and the game-term definitions of the wiki Glossary (public/glossary.js + public/terms.js).
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

type Lang = 'en' | 'fr';
type Entry = { kind: 'tip' | 'bluff'; en: string; fr: string };
type Term = { en: { title: string; def: string }; fr: { title: string; def: string } };

const sandbox: Record<string, unknown> = {};
for (const [file, name] of [['tips.js', 'TIPS'], ['terms.js', 'WIKI_TERMS'], ['glossary.js', 'GLOSSARY']]) {
  vm.runInNewContext(fs.readFileSync(path.resolve('public', file), 'utf8') + `\nthis.${name} = ${name};`, sandbox);
}
const TIPS = sandbox.TIPS as Record<string, Entry[]>;
const WIKI_TERMS = sandbox.WIKI_TERMS as Term[];
const GLOSSARY = sandbox.GLOSSARY as Term[];
const LANGS: Lang[] = ['en', 'fr'];
const withTips = (Object.keys(CHARACTERS) as CharacterId[]).filter((c) => c !== 'drunk');
const allTerms = (lang: Lang) => GLOSSARY.map((g) => g[lang]).concat(WIKI_TERMS.map((g) => g[lang]));
const termText = (t: { title: string; def: string }) => `${t.title} — ${t.def}`;

// ---------------------------------------------------------------- the data

/** How many bullets each wiki page has under "Tips & Tricks" / "Bluffing as the X" — [tips, bluffs]. */
const WIKI_COUNTS: Record<string, [number, number]> = {
  washerwoman: [16, 6], librarian: [10, 7], investigator: [9, 8], chef: [9, 6], empath: [9, 7], fortuneteller: [10, 9],
  undertaker: [12, 6], monk: [10, 6], ravenkeeper: [11, 7], virgin: [13, 8], slayer: [13, 5], soldier: [11, 6],
  mayor: [6, 8], butler: [8, 8], recluse: [7, 7], saint: [5, 12], poisoner: [10, 0], spy: [16, 0],
  scarletwoman: [5, 0], baron: [10, 0], imp: [12, 0],
};

test('every character has entries — except the Drunk, who is shown those of the character they believe they are', () => {
  assert.deepEqual(Object.keys(TIPS).sort(), [...withTips].sort());
  assert.ok(!('drunk' in TIPS), 'a Drunk must never see "you are the Drunk" entries');
});

test('EVERY bullet of the wiki is there: the full number of tips and of bluffing ideas per character', () => {
  for (const c of withTips) {
    const [tips, bluffs] = WIKI_COUNTS[c];
    assert.equal(TIPS[c].filter((e) => e.kind === 'tip').length, tips, `${c}: tips`);
    assert.equal(TIPS[c].filter((e) => e.kind === 'bluff').length, bluffs, `${c}: bluffing ideas`);
  }
  assert.equal(WIKI_TERMS.length, 52, 'the rest of the wiki Glossary');
});

test('the wiki bullets are word for word — the Ravenkeeper examples given by the user are there in full', () => {
  const rk = TIPS.ravenkeeper;
  assert.ok(rk.some((e) => e.kind === 'tip' && e.en.startsWith('If the Demon knows you are the Ravenkeeper, they are very unlikely to kill you. It is to your benefit to bluff as a character who is a constant threat to the evil team, such as the Empath, Fortune Teller, Slayer, or Undertaker.')));
  assert.ok(rk.some((e) => e.kind === 'tip' && e.en.startsWith('If you have told nobody that you are the Ravenkeeper, and you are still alive late in the game, then it is probable that a Spy is in play')));
  assert.ok(rk.some((e) => e.kind === 'bluff' && e.en === "Don't know the identity of the player you are confirming? Claim that person is the Drunk. This will also cast doubt on their information, adding an extra layer of usefulness to the strategy."));
  assert.ok(rk.some((e) => e.kind === 'bluff' && e.en.startsWith('The Ravenkeeper would wake only when they die during the night, not the day.')));
  assert.ok(rk.some((e) => e.kind === 'bluff' && /Throwing blame allows you to point the finger at a good player as an evil one/.test(e.en) && /An advanced technique is to claim they are in fact a different character/.test(e.en)), 'sub-bullets are kept with their bullet');
});

test('every entry is real: both languages present, no wiki markup, no scraping debris, no duplicates', () => {
  const problems: string[] = [];
  for (const c of withTips) {
    for (const lang of LANGS) {
      const seen = new Set<string>();
      TIPS[c].forEach((e, i) => {
        const text = e[lang];
        if (seen.has(text)) problems.push(`${c}/${lang}#${i}: duplicate`);
        seen.add(text);
        const why = brokenText(text);
        if (why) problems.push(`${c}/${lang}#${i}: ${why}`);
        if (text.length < 20 || text.length > 2000) problems.push(`${c}/${lang}#${i}: length ${text.length}`);
        if (text !== text.trim() || /\s{2}/.test(text)) problems.push(`${c}/${lang}#${i}: stray whitespace`);
        if (!/[.!?»)…"”]$/.test(text)) problems.push(`${c}/${lang}#${i}: does not end like a sentence: …${text.slice(-30)}`);
        if (/\{\{|\}\}|\[\[|\]\]|Category:|<\/?\w+>|'''/.test(text)) problems.push(`${c}/${lang}#${i}: markup`);
        if (e.kind !== 'tip' && e.kind !== 'bluff') problems.push(`${c}#${i}: kind ${e.kind}`);
      });
    }
  }
  assert.deepEqual(problems, []);
});

test('the French entries are translations, in the French names of the characters', () => {
  const englishWords = /\b(the|you|your|and|with|if|they|their|when|are|is|of|to)\b/gi;
  const wrongNames = /\b(Tueur|Diseuse|Enquêteur|Croque-mort|Vierge|Gardien de corbeau|Espion|Ivre)\b/;
  const problems: string[] = [];
  for (const c of withTips) {
    TIPS[c].forEach((e, i) => {
      if (e.fr === e.en) problems.push(`${c}#${i}: untranslated`);
      const hits = (e.fr.match(englishWords) ?? []).length;
      if (hits > 2) problems.push(`${c}#${i}: looks English: "${e.fr.slice(0, 60)}"`);
      const wrong = e.fr.match(wrongNames);
      if (wrong) problems.push(`${c}#${i}: "${wrong[0]}" is not the app's French name`);
    });
  }
  WIKI_TERMS.forEach((t, i) => {
    if (t.fr.def === t.en.def || t.fr.title === '') problems.push(`term ${t.en.title}: untranslated`);
    if ((t.fr.def.match(englishWords) ?? []).length > 2) problems.push(`term ${t.en.title}: looks English`);
    if (brokenText(t.en.def) || brokenText(t.fr.def) || brokenText(t.fr.title)) problems.push(`term #${i} broken`);
    if (/\{\{|\[\[|'''/.test(t.en.def)) problems.push(`term ${t.en.title}: markup`);
  });
  assert.deepEqual(problems, []);
});

test('bluffing ideas exist for the 16 characters whose wiki page has a Bluffing section, and only for them', () => {
  for (const c of withTips) assert.equal(TIPS[c].some((e) => e.kind === 'bluff'), WIKI_COUNTS[c][1] > 0, c);
});

test('the wiki glossary terms do not repeat the app\'s own terms', () => {
  const own = new Set(GLOSSARY.map((g) => g.en.title.toLowerCase().replace(/[ *]+$/, '')));
  for (const t of WIKI_TERMS) assert.ok(!own.has(t.en.title.toLowerCase()), `${t.en.title} is already defined by the app`);
});

// ---------------------------------------------------------------- what a player sees

/** A decoy "information" screen for a player whose role banner says `character`. */
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

type Shown = { kind: 'tip' | 'bluff' | 'term'; index: number };
/** Which entry a screen's text carries: one of the character's own, or a term. */
function shown(text: string, character: CharacterId, lang: Lang): Shown | null {
  const own = TIPS[character] ?? [];
  const i = own.findIndex((e) => text.includes(e[lang]));
  if (i >= 0) return { kind: own[i].kind, index: i };
  const j = allTerms(lang).findIndex((t) => text.includes(termText(t)));
  return j >= 0 ? { kind: 'term', index: j } : null;
}
const id = (s: Shown | null) => (s ? `${s.kind}:${s.index}` : 'none');
const CREDIT: Record<Shown['kind'], Record<Lang, string>> = {
  tip: { en: 'Tip from the Blood on the Clocktower wiki', fr: 'Astuce du wiki Blood on the Clocktower' },
  bluff: { en: 'Bluffing advice from the Blood on the Clocktower wiki', fr: 'Conseil de bluff du wiki Blood on the Clocktower' },
  term: { en: 'Definition from the Blood on the Clocktower glossary', fr: 'Définition du glossaire Blood on the Clocktower' },
};
/** Makes every random draw of the app deterministic (mulberry32), so coverage tests can't flake. */
const seedApp = (app: { run<T>(c: string): T }, seed: number) =>
  app.run(`(function(){ var a = ${seed}; Math.random = function(){ a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })()`);

test('the decoy information screen shows something to read instead of "nothing to learn" — every character, both languages, with its source credited', async () => {
  const app = await loadApp('en');
  for (const character of withTips) {
    for (const lang of LANGS) {
      for (let i = 0; i < 6; i++) {
        const text = app.show(decoyView(character, `2-${i}`), { seen: true, lang });
        const what = shown(text, character, lang);
        assert.ok(what, `${character}/${lang}: nothing from ${character}'s list or the glossary is on the screen`);
        assert.ok(!/Nothing to learn|Rien à apprendre/.test(text), `${character}/${lang}: the placeholder is still there`);
        assert.ok(text.includes(CREDIT[what.kind][lang]), `${character}/${lang}: the ${what.kind} source is credited`);
        for (const other of withTips) {
          if (other === character) continue;
          const foreign = TIPS[other].find((e) => text.includes(e[lang]) && !TIPS[character].some((mine) => mine[lang] === e[lang]));
          assert.ok(!foreign, `${character}: an entry of ${other} leaked onto the screen`);
        }
      }
    }
  }
});

test('the draw mixes everything: own tips, own bluffing ideas, and glossary terms — about a third being terms', async () => {
  const app = await loadApp('en');
  seedApp(app, 1);
  const counts = { tip: 0, bluff: 0, term: 0 };
  const distinct = { tip: new Set<number>(), bluff: new Set<number>(), term: new Set<number>() };
  const N = 2500;
  for (let i = 0; i < N; i++) {
    const what = shown(app.show(decoyView('empath', `2-${i}`), { seen: true }), 'empath', 'en')!;
    assert.ok(what);
    counts[what.kind]++;
    distinct[what.kind].add(what.index);
  }
  assert.ok(counts.term > N * 0.24 && counts.term < N * 0.42, `terms: ${counts.term}/${N}`);
  assert.ok(counts.tip > 0 && counts.bluff > 0, JSON.stringify(counts));
  assert.equal(distinct.tip.size, 9, 'all 9 Empath tips come up');
  assert.equal(distinct.bluff.size, 7, 'all 7 Empath bluffing ideas come up');
  assert.equal(distinct.term.size, GLOSSARY.length + WIKI_TERMS.length, 'every glossary term comes up');
});

test('never the same entry twice in a row, and the first one a player sees is random too', async () => {
  const app = await loadApp('en');
  seedApp(app, 7);
  let last = 'none';
  for (let i = 0; i < 300; i++) {
    const now = id(shown(app.show(decoyView('saint', `2-${i}`), { seen: true }), 'saint', 'en'));
    assert.notEqual(now, 'none');
    assert.notEqual(now, last, `twice ${now} in a row at screen ${i}`);
    last = now;
  }
  const first = new Set<string>();
  for (let n = 0; n < 40; n++) {
    const fresh = await loadApp('en');
    seedApp(fresh, 100 + n);
    first.add(id(shown(fresh.show(decoyView('imp', '2-1'), { seen: true }), 'imp', 'en')));
  }
  assert.ok(first.size >= 8, `the first entry was one of only ${first.size} different ones in 40 fresh starts`);
});

test('a character without bluffing ideas (Imp) still gets tips and terms, and no bluff credit', async () => {
  const app = await loadApp('en');
  seedApp(app, 3);
  const kinds = new Set<string>();
  for (let i = 0; i < 200; i++) kinds.add(shown(app.show(decoyView('imp', `2-${i}`), { seen: true }), 'imp', 'en')!.kind);
  assert.deepEqual([...kinds].sort(), ['term', 'tip']);
});

test('while the same screen refreshes (the countdown ticks) the entry does not change', async () => {
  const app = await loadApp('en');
  const view = decoyView('slayer', '2-7');
  const first = id(shown(app.show(view, { seen: true }), 'slayer', 'en'));
  for (let i = 0; i < 20; i++) assert.equal(id(shown(app.show(view, { seen: true }), 'slayer', 'en')), first);
});

test('switching language keeps the same entry, translated — tips, bluffs and terms alike', async () => {
  const app = await loadApp('en');
  seedApp(app, 5);
  const kinds = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const view = decoyView('mayor', `2-${i}`);
    const en = shown(app.show(view, { seen: true, lang: 'en' }), 'mayor', 'en');
    const fr = shown(app.show(view, { seen: true, lang: 'fr' }), 'mayor', 'fr');
    assert.ok(en && fr);
    assert.equal(id(fr), id(en));
    kinds.add(en.kind);
  }
  assert.equal(kinds.size, 3, 'the check covered tips, bluffs and terms');
});

test('a Drunk reads the entries of the character they believe they are — never Drunk tips', async () => {
  const s = mk(['imp', 'poisoner', 'drunk', 'washerwoman', 'soldier', 'monk', 'chef'], { drunkFakeChar: 'empath' });
  startNight(s);
  advanceUntil(s, 'washerwoman');
  const drunk = byChar(s, 'drunk');
  const app = await loadApp('en');
  seedApp(app, 9);
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) {
    const v = JSON.parse(JSON.stringify(viewFor(s, drunk.id))) as GameView;
    v.nightTurn!.stepKey = `2-${i}`;
    assert.equal(v.myCharacter!.id, 'empath');
    const what = shown(app.show(v, { seen: true }), 'empath', 'en');
    assert.ok(what, 'an Empath entry or a term');
    seen.add(id(what));
  }
  assert.ok(seen.size > 10);
  assert.ok(![...seen].some((k) => k.startsWith('tip:') && /Drunk/.test(TIPS.empath[Number(k.split(':')[1])].en) && false));
});

test('a real information screen is unchanged: it shows the real information, nothing to read', async () => {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'empath');
  const app = await loadApp('en');
  const text = app.show(viewFor(s, byChar(s, 'empath').id), { seen: true });
  assert.ok(text.includes('Your Information'));
  assert.ok(!/💡|🎭|📖/.test(text), 'no tip on a real information screen');
  assert.ok(!/Tip from the|Bluffing advice|Definition from the/.test(text));
});

test('a decoy that stands in for a result screen (Fortune Teller / Ravenkeeper step) also shows something to read', async () => {
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
  const what = shown(text, 'soldier', 'en');
  assert.ok(what, 'a Soldier entry or a term');
  assert.ok(text.includes(CREDIT[what.kind].en), 'credited');
  assert.ok(!text.includes('Nothing to learn'));
});

test('a character without any entry (should never happen) still gets a glossary term rather than an empty screen', async () => {
  const app = await loadApp('en');
  const v = decoyView('imp');
  v.myCharacter!.id = 'nobody' as CharacterId;
  const text = app.show(v, { seen: true });
  assert.ok(allTerms('en').some((t) => text.includes(termText(t))), 'a term is shown');
});

test('a player can tap the game words inside what they read (the underlined terms still work)', async () => {
  const app = await loadApp('en');
  seedApp(app, 11);
  let underlined = 0;
  for (let i = 0; i < 40; i++) {
    app.show(decoyView('washerwoman', `2-${i}`), { seen: true });
    underlined += app.root.find((n) => n.hasClass('term')).length;
  }
  assert.ok(underlined > 20, `only ${underlined} tappable terms across 40 screens`);
});

test('over whole games, no player is ever dealt a perceived character without entries', () => {
  for (let n = 5; n <= 15; n++) {
    const s = playGame(1, n);
    for (const p of s.players) assert.ok(p.perceived in TIPS, `${p.perceived} has no entries`);
  }
});

test('the app loads terms.js: it is served, and the page includes it before app.js', () => {
  const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
  assert.ok(html.indexOf('/terms.js') > 0 && html.indexOf('/terms.js') < html.indexOf('/app.js'));
  assert.ok(html.indexOf('/tips.js') < html.indexOf('/app.js'));
});
