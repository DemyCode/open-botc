// The reading material shown on night screens that carry no real information: every tip of every
// character (public/tips.js — all the Tips & Tricks bullets of the wiki) and the game-term definitions
// of the wiki Glossary (public/glossary.js + public/terms.js), each with a label saying what it is.
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
import { advanceUntil, byChar, mk, playRounds, runFullNight, startNight } from './helpers.js';

type Lang = 'en' | 'fr';
type Entry = { kind: 'tip' | 'bluff'; en: string; fr: string };
type Term = { en: { title: string; def: string }; fr: { title: string; def: string } };

const sandbox: Record<string, unknown> = {};
for (const [file, names] of [['tips.js', ['TIPS', 'BLUFFS']], ['terms.js', ['WIKI_TERMS']], ['glossary.js', ['GLOSSARY']]] as [string, string[]][]) {
  const exports = names.map((n) => `this.${n} = ${n};`).join('\n');
  vm.runInNewContext(fs.readFileSync(path.resolve('public', file), 'utf8') + '\n' + exports, sandbox);
}
const TIPS = sandbox.TIPS as Record<string, Entry[]>;
const BLUFFS = sandbox.BLUFFS as Record<string, Entry[]>;
const WIKI_TERMS = sandbox.WIKI_TERMS as Term[];
const GLOSSARY = sandbox.GLOSSARY as Term[];
const LANGS: Lang[] = ['en', 'fr'];
// Every character with a wiki "Tips & Tricks" page (all three editions).
const withTips = (Object.keys(CHARACTERS) as CharacterId[]).filter((c) => c !== 'drunk');
// The Trouble Brewing subset: the reading-material pool for a Trouble Brewing game (see below).
const tbTips = withTips.filter((c) => CHARACTERS[c].edition === 'tb');
const allTerms = (lang: Lang) => GLOSSARY.map((g) => g[lang]).concat(WIKI_TERMS.map((g) => g[lang]));
const termText = (t: { title: string; def: string }) => t.def;

// ---------------------------------------------------------------- the data

/** How many bullets of the wiki's "Bluffing as the ..." section each character has (the roles sheet shows them).
 *  Only good Trouble Brewing characters have such a section: nobody bluffs being a Minion or the Demon. */
const BLUFF_COUNTS: Record<string, number> = {
  washerwoman: 6, librarian: 7, investigator: 8, chef: 9, empath: 7, fortuneteller: 9, undertaker: 6, monk: 6,
  ravenkeeper: 8, virgin: 8, slayer: 6, soldier: 6, mayor: 8, butler: 8, recluse: 7, saint: 10, drunk: 9,
};

/** How many bullets each wiki page has under "Tips & Tricks" — [tips, bluffs of the old scrape]. */
const WIKI_COUNTS: Record<string, [number, number]> = {
  washerwoman: [16, 6], librarian: [10, 7], investigator: [9, 8], chef: [9, 6], empath: [9, 7], fortuneteller: [10, 9],
  undertaker: [12, 6], monk: [10, 6], ravenkeeper: [11, 7], virgin: [13, 8], slayer: [13, 5], soldier: [11, 6],
  mayor: [6, 8], butler: [8, 8], recluse: [7, 7], saint: [5, 12], poisoner: [10, 0], spy: [16, 0],
  scarletwoman: [5, 0], baron: [10, 0], imp: [12, 0],
  // Bad Moon Rising
  grandmother: [8, 0], sailor: [6, 0], chambermaid: [6, 0], exorcist: [7, 0], innkeeper: [5, 0], gambler: [6, 0],
  gossip: [7, 0], courtier: [7, 0], professor: [7, 0], minstrel: [5, 0], tealady: [5, 0], pacifist: [6, 0],
  fool: [8, 0], goon: [5, 0], lunatic: [5, 0], tinker: [5, 0], moonchild: [6, 0], godfather: [7, 0],
  devilsadvocate: [6, 0], assassin: [5, 0], mastermind: [7, 0], zombuul: [4, 0], pukka: [6, 0], shabaloth: [7, 0], po: [3, 0],
  // Sects & Violets
  clockmaker: [6, 0], dreamer: [11, 0], snakecharmer: [8, 0], mathematician: [8, 0], flowergirl: [6, 0], towncrier: [7, 0],
  oracle: [5, 0], savant: [10, 0], seamstress: [7, 0], philosopher: [8, 0], artist: [8, 0], juggler: [9, 0], sage: [4, 0],
  mutant: [5, 0], sweetheart: [6, 0], barber: [6, 0], klutz: [6, 0], eviltwin: [10, 0], witch: [7, 0], cerenovus: [12, 0],
  pithag: [11, 0], fanggu: [7, 0], vigormortis: [4, 0], nodashii: [5, 0], vortox: [6, 0],
};

test('every character has entries — except the Drunk, who is shown those of the character they believe they are', () => {
  assert.deepEqual(Object.keys(TIPS).sort(), [...withTips].sort());
  assert.ok(!('drunk' in TIPS), 'a Drunk must never see "you are the Drunk" entries');
});

test('EVERY Tips & Tricks bullet of the wiki is there — and no bluffing ideas any more', () => {
  for (const c of withTips) {
    assert.equal(TIPS[c].length, WIKI_COUNTS[c][0], `${c}: tips`);
    assert.ok(TIPS[c].every((e) => e.kind === 'tip'), `${c}: only tips`);
  }
  assert.equal(WIKI_TERMS.length, 52, 'the rest of the wiki Glossary');
});

test('the wiki bullets are word for word — the Ravenkeeper tips are there in full', () => {
  const rk = TIPS.ravenkeeper;
  assert.ok(rk.some((e) => e.kind === 'tip' && e.en.startsWith('If the Demon knows you are the Ravenkeeper, they are very unlikely to kill you. It is to your benefit to bluff as a character who is a constant threat to the evil team, such as the Empath, Fortune Teller, Slayer, or Undertaker.')));
  assert.ok(rk.some((e) => e.kind === 'tip' && e.en.startsWith('If you have told nobody that you are the Ravenkeeper, and you are still alive late in the game, then it is probable that a Spy is in play')));
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
        if (text.length < 20 || text.length > 6000) problems.push(`${c}/${lang}#${i}: length ${text.length}`);
        if (text !== text.trim() || /\s{2}/.test(text)) problems.push(`${c}/${lang}#${i}: stray whitespace`);
        if (!/[.!?»)…"”]$/.test(text)) problems.push(`${c}/${lang}#${i}: does not end like a sentence: …${text.slice(-30)}`);
        if (/\{\{|\}\}|\[\[|\]\]|Category:|<\/?\w+>|'''/.test(text)) problems.push(`${c}/${lang}#${i}: markup`);
        if (e.kind !== 'tip') problems.push(`${c}#${i}: kind ${e.kind}`);
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

test('the wiki glossary terms do not repeat the app\'s own terms', () => {
  const own = new Set(GLOSSARY.map((g) => g.en.title.toLowerCase().replace(/[ *]+$/, '')));
  for (const t of WIKI_TERMS) assert.ok(!own.has(t.en.title.toLowerCase()), `${t.en.title} is already defined by the app`);
});

// ---------------------------------------------------------------- what a player sees

/** A tip screen (the Soldier's, during the Empath's step) for a player whose role banner says `character`. */
function decoyView(character: CharacterId, stepKey = '2-1'): GameView {
  const s = mk(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier', 'monk', 'chef']);
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'empath');
  const v = JSON.parse(JSON.stringify(viewFor(s, byChar(s, 'soldier').id))) as GameView;
  assert.equal(v.nightTurn!.kind, 'tip');
  v.nightTurn!.stepKey = stepKey;
  v.myCharacter = { id: character, name: CHARACTERS[character].name, ability: CHARACTERS[character].ability, alignment: 'good' } as GameView['myCharacter'];
  return v;
}

type Shown = { kind: 'tip' | 'term'; index: number; character?: string };
/** Which entry a screen's text carries: an entry of ANY character, or a term. */
function shown(text: string, lang: Lang): Shown | null {
  for (const c of withTips) {
    const i = TIPS[c].findIndex((e) => text.includes(e[lang]));
    if (i >= 0) return { kind: 'tip', index: i, character: c };
  }
  const j = allTerms(lang).findIndex((t) => text.includes(termText(t)));
  return j >= 0 ? { kind: 'term', index: j } : null;
}
const id = (s: Shown | null) => (s ? `${s.kind}:${s.character ?? ''}:${s.index}` : 'none');
/** The label above what is shown: says what it is and what it is about. */
const label = (what: Shown, lang: Lang) => {
  if (what.kind === 'tip') return lang === 'en' ? `Tip for "${CHARACTERS[what.character as CharacterId].name}":` : null;
  return lang === 'en' ? `Definition of "${allTerms('en')[what.index].title}":` : `Définition de « ${allTerms('fr')[what.index].title} » :`;
};
/** Makes every random draw of the app deterministic (mulberry32), so coverage tests can't flake. */
const seedApp = (app: { run<T>(c: string): T }, seed: number) =>
  app.run(`(function(){ var a = ${seed}; Math.random = function(){ a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })()`);
// The wiki repeats one Spy bullet word for word on two pages; a screen can't tell those two apart.
// (decoyView below plays a Trouble Brewing game, so only the Trouble Brewing tips are in its pool.)
const POOL = new Set(tbTips.flatMap((c) => TIPS[c].map((e) => e.en))).size + GLOSSARY.length + WIKI_TERMS.length;

test('the decoy information screen shows something to read instead of "nothing to learn" labelled — both languages', async () => {
  const app = await loadApp('en');
  seedApp(app, 2);
  for (const character of withTips) {
    for (const lang of LANGS) {
      for (let i = 0; i < 4; i++) {
        const text = app.show(decoyView(character, `2-${i}`), { seen: true, lang });
        const what = shown(text, lang);
        assert.ok(what, `${character}/${lang}: nothing readable on the screen`);
        assert.ok(!/Nothing to learn|Rien à apprendre/.test(text));
        const l = label(what, lang);
        if (l) assert.ok(text.includes(l), `label "${l}" is on the screen`);
        assert.ok(/📖|💡/.test(text));
      }
    }
  }
});

test('the draw mixes EVERYTHING: tips of every character and glossary terms — each one comes up, whatever your own character', async () => {
  const app = await loadApp('en');
  seedApp(app, 1);
  const seen = new Set<string>();
  const kinds = { tip: 0, term: 0 };
  const characters = new Set<string>();
  const N = 12000;
  for (let i = 0; i < N; i++) {
    const what = shown(app.show(decoyView('empath', `2-${i}`), { seen: true }), 'en')!;
    assert.ok(what);
    seen.add(id(what));
    kinds[what.kind]++;
    if (what.character) characters.add(what.character);
  }
  assert.equal(characters.size, 21, 'entries of all 21 characters, not only the Empath');
  assert.equal(seen.size, POOL, 'every single entry and term comes up');
  assert.ok(kinds.tip > 0 && kinds.term > 0, JSON.stringify(kinds));
});

test('what you read does not depend on your character: an Imp and a Soldier draw from the same pool (nothing hints at your role)', async () => {
  const app = await loadApp('en');
  seedApp(app, 4);
  for (const mine of ['imp', 'soldier'] as CharacterId[]) {
    const others = new Set<string>();
    for (let i = 0; i < 400; i++) others.add(shown(app.show(decoyView(mine, `2-${i}`), { seen: true }), 'en')!.character ?? 'term');
    assert.ok(others.size > 15, `${mine}: only ${others.size} sources`);
  }
});

test('never the same entry twice in a row, and the first one a player sees is random too', async () => {
  const app = await loadApp('en');
  seedApp(app, 7);
  let last = 'none';
  for (let i = 0; i < 300; i++) {
    const now = id(shown(app.show(decoyView('saint', `2-${i}`), { seen: true }), 'en'));
    assert.notEqual(now, 'none');
    assert.notEqual(now, last, `twice ${now} in a row at screen ${i}`);
    last = now;
  }
  const first = new Set<string>();
  for (let n = 0; n < 40; n++) {
    const fresh = await loadApp('en');
    seedApp(fresh, 100 + n);
    first.add(id(shown(fresh.show(decoyView('imp', '2-1'), { seen: true }), 'en')));
  }
  assert.ok(first.size >= 20, `the first entry was one of only ${first.size} different ones in 40 fresh starts`);
});

test('a tip says "Tip for <character>:" and a term says "Definition of <term>:" — in English and French', async () => {
  const app = await loadApp('en');
  seedApp(app, 6);
  let tips = 0, terms = 0;
  for (let i = 0; i < 400 && (tips < 25 || terms < 25); i++) {
    const view = decoyView('chef', `2-${i}`);
    const text = app.show(view, { seen: true });
    const what = shown(text, 'en')!;
    if (what.kind === 'tip') {
      assert.ok(text.includes(`💡 Tip for "${CHARACTERS[what.character as CharacterId].name}":`), 'English tip label');
      const fr = app.show(view, { seen: true, lang: 'fr' });
      assert.ok(/💡 Astuce de « [^»]+ » :/.test(fr), 'French tip label: ' + fr.slice(0, 200));
      app.show(view, { seen: true, lang: 'en' });
      tips++;
    } else {
      assert.ok(text.includes(`📖 Definition of "${allTerms('en')[what.index].title}":`), 'English term label');
      const fr = app.show(view, { seen: true, lang: 'fr' });
      assert.ok(fr.includes(`📖 Définition de « ${allTerms('fr')[what.index].title} » :`), 'French term label');
      app.show(view, { seen: true, lang: 'en' });
      terms++;
    }
  }
  assert.ok(tips >= 25 && terms >= 25, `${tips} tips, ${terms} terms`);
});

test('the French tip label uses the French name of the character', async () => {
  const app = await loadApp('fr');
  seedApp(app, 8);
  for (let i = 0; i < 60; i++) {
    const text = app.show(decoyView('chef', `2-${i}`), { seen: true, lang: 'fr' });
    const m = text.match(/💡 Astuce de « ([^»]+) » :/);
    if (m) assert.ok(!/^(Washerwoman|Fortune Teller|Slayer|Imp|Empath)$/.test(m[1].trim()), m[1]);
  }
});

test('while the same screen refreshes (the countdown ticks) the entry does not change', async () => {
  const app = await loadApp('en');
  const view = decoyView('slayer', '2-7');
  const first = id(shown(app.show(view, { seen: true }), 'en'));
  for (let i = 0; i < 20; i++) assert.equal(id(shown(app.show(view, { seen: true }), 'en')), first);
});

test('switching language keeps the same entry, translated — tips and terms alike', async () => {
  const app = await loadApp('en');
  seedApp(app, 5);
  const kinds = new Set<string>();
  for (let i = 0; i < 80; i++) {
    const view = decoyView('mayor', `2-${i}`);
    const en = shown(app.show(view, { seen: true, lang: 'en' }), 'en');
    const fr = shown(app.show(view, { seen: true, lang: 'fr' }), 'fr');
    assert.ok(en && fr);
    assert.equal(id(fr), id(en));
    kinds.add(en.kind);
  }
  assert.equal(kinds.size, 2, 'the check covered tips and terms');
});

test('a Drunk draws from the same pool as everyone else', async () => {
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
    const what = shown(app.show(v, { seen: true }), 'en');
    assert.ok(what);
    seen.add(id(what));
  }
  assert.ok(seen.size > 40);
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

test('while the Fortune Teller reads her result, everyone else reads something too (a round of its own)', async () => {
  const s = mk(['imp', 'poisoner', 'fortuneteller', 'washerwoman', 'soldier', 'monk', 'chef']);
  const ft = byChar(s, 'fortuneteller');
  startNight(s);
  runFullNight(s);
  startNight(s);
  advanceUntil(s, 'fortuneteller');
  playRounds(s, 2, { [ft.id]: [[byChar(s, 'imp').id], [byChar(s, 'chef').id]] });
  assert.equal(viewFor(s, ft.id).nightTurn!.kind, 'result');
  const v = viewFor(s, byChar(s, 'soldier').id);
  assert.equal(v.nightTurn!.kind, 'tip');
  const app = await loadApp('en');
  app.run(`handleTurnChange(${JSON.stringify(v)}); state.turnReadyAt = 0;`);
  const text = app.show(v, { seen: true });
  const what = shown(text, 'en');
  assert.ok(what, 'something readable');
  const l = label(what, "en");
  assert.ok(l && text.includes(l), "labelled");
  assert.ok(!text.includes('Nothing to learn'));
});

test('a character unknown to the app still gets something to read rather than an empty screen', async () => {
  const app = await loadApp('en');
  const v = decoyView('imp');
  v.myCharacter!.id = 'nobody' as CharacterId;
  assert.ok(shown(app.show(v, { seen: true }), 'en'));
});

test('a player can tap the game words inside what they read (the underlined terms still work)', async () => {
  const app = await loadApp('en');
  seedApp(app, 11);
  let underlined = 0;
  for (let i = 0; i < 40; i++) {
    app.show(decoyView('washerwoman', `2-${i}`), { seen: true });
    underlined += app.root.find((n) => n.hasClass('term')).length;
  }
  assert.ok(underlined > 15, `only ${underlined} tappable terms across 40 screens`);
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

// ---------------------------------------------------------------- bluffing advice (the roles sheet)

test('every good Trouble Brewing character has the wiki\'s "Bluffing as the ..." bullets; the evil ones have none', () => {
  assert.deepEqual(Object.keys(BLUFFS).sort(), Object.keys(BLUFF_COUNTS).sort());
  for (const [c, n] of Object.entries(BLUFF_COUNTS)) assert.equal(BLUFFS[c].length, n, `${c}: bluffing bullets`);
  for (const c of ['poisoner', 'spy', 'scarletwoman', 'baron', 'imp']) {
    assert.ok(!(c in BLUFFS), `${c} is evil: the wiki has no bluffing section for it`);
  }
  // The Drunk has no night tips (they must never read "you are the Drunk"), but the sheet does carry
  // the wiki's advice on bluffing as the Drunk — public knowledge, the same for everyone.
  assert.ok(!('drunk' in TIPS) && BLUFFS.drunk.length > 0);
});

test('every bluffing entry is real: marked as a bluff, both languages, no markup or debris, no duplicates', () => {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [c, entries] of Object.entries(BLUFFS)) {
    for (const e of entries) {
      if (e.kind !== 'bluff') problems.push(`${c}: not marked as a bluff`);
      for (const lang of LANGS) {
        const text = e[lang];
        const why = !text ? 'missing' : brokenText(text) ?? (/\[\[|\]\]|https?:|\]\(/.test(text) ? 'wiki markup' : null);
        if (why) problems.push(`${c}.${lang}: ${why}`);
        // (The wiki repeats one Spy sentence word for word on two pages, so duplicates are per character.)
        if (text && seen.get(text) === c) problems.push(`${c}.${lang}: the same bullet twice`);
        if (text) seen.set(text, c);
      }
      if (e.en && e.fr && e.en === e.fr) problems.push(`${c}: the French text was never translated`);
    }
  }
  assert.deepEqual(problems, []);
});

test('bluffing advice never appears on a night screen — the reading pool is tips and glossary only', async () => {
  const bluffText = new Set(Object.values(BLUFFS).flat().map((e) => e.en));
  const app = await loadApp('en');
  seedApp(app, 3);
  for (let i = 0; i < 150; i++) {
    const text = app.show(decoyView('empath', `2-${i}`), { seen: true });
    for (const b of bluffText) assert.ok(!text.includes(b.slice(0, 60)), `a bluffing bullet was shown at night: ${b.slice(0, 60)}`);
  }
});
