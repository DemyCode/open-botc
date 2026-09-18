// The glossary lives in the browser (public/glossary.js, a plain script), so it's loaded here in a
// sandbox exactly as the page runs it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { CHARACTERS } from '../game/characters.js';

interface Entry { title: string; def: string; match: string[] }
interface Term { id: string; en: Entry; fr: Entry }
interface Segment { text: string; id?: string }

const publicDir = path.resolve('public');
const sandbox: Record<string, unknown> = {};
vm.runInNewContext(fs.readFileSync(path.join(publicDir, 'glossary.js'), 'utf8') + '\nthis.GLOSSARY = GLOSSARY;', sandbox);
const GLOSSARY = sandbox.GLOSSARY as Term[];
const sandboxSegments = sandbox.glossarySegments as (text: string, lang: string, excludeId?: string) => Segment[];
// Re-create the results as this realm's plain arrays/objects, so deepEqual compares them normally.
const segments = (text: string, lang: string, excludeId?: string): Segment[] =>
  Array.from(sandboxSegments(text, lang, excludeId), (s) => (s.id ? { text: s.text, id: s.id } : { text: s.text }));
const LANGS = ['en', 'fr'] as const;

const termsIn = (text: string, lang: string) => segments(text, lang).filter((s) => s.id).map((s) => s.id);

// The French character texts are only in app.js; pull that one object literal out of it.
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const frBlock = appJs.slice(appJs.indexOf('const CHAR_I18N_FR = {') + 'const CHAR_I18N_FR = '.length);
const CHAR_I18N_FR = vm.runInNewContext('(' + frBlock.slice(0, frBlock.indexOf('\n};') + 2) + ')') as Record<string, { ability: string }>;

test('every glossary term has a title, a definition and word forms in both languages', () => {
  const ids = new Set<string>();
  for (const g of GLOSSARY) {
    assert.ok(!ids.has(g.id), `duplicate id ${g.id}`);
    ids.add(g.id);
    for (const lang of LANGS) {
      const e = g[lang];
      assert.ok(e?.title && e.def && e.match.length, `${g.id} is incomplete in ${lang}`);
    }
  }
});

test('no word form belongs to two different terms in the same language', () => {
  for (const lang of LANGS) {
    const owner = new Map<string, string>();
    for (const g of GLOSSARY) {
      for (const form of g[lang].match) {
        const f = form.toLowerCase();
        assert.ok(!owner.has(f) || owner.get(f) === g.id, `"${f}" (${lang}) is claimed by ${owner.get(f)} and ${g.id}`);
        owner.set(f, g.id);
      }
    }
  }
});

test('every word form of every term is recognised on its own', () => {
  for (const lang of LANGS) {
    for (const g of GLOSSARY) {
      for (const form of g[lang].match) {
        assert.deepEqual(termsIn(`— ${form} —`, lang), [g.id], `"${form}" (${lang}) should be recognised as ${g.id}`);
      }
    }
  }
});

test('splitting text into terms never loses or changes a single character', () => {
  const texts = [
    ...GLOSSARY.flatMap((g) => LANGS.map((l) => g[l].def)),
    ...Object.values(CHARACTERS).map((c) => c.ability),
    ...Object.values(CHAR_I18N_FR).map((c) => c.ability),
    '', 'no terms here', 'Demon', 'DEMON!',
  ];
  for (const lang of LANGS) {
    for (const text of texts) {
      assert.equal(segments(text, lang).map((s) => s.text).join(''), text);
    }
  }
});

test('terms are matched as whole words only, in any case', () => {
  assert.deepEqual(termsIn('a devoted voter, an evildoer, a goodbye', 'en'), []);
  assert.deepEqual(termsIn('Bonjour, abonné !', 'fr'), []);
  assert.deepEqual(termsIn('The DEMON is Evil.', 'en'), ['demon', 'evil']);
});

test('only the first occurrence of each term is underlined', () => {
  const segs = segments('The Demon, the Demon, and the Demon again.', 'en');
  assert.equal(segs.filter((s) => s.id === 'demon').length, 1);
  assert.equal(segs.find((s) => s.id)!.text, 'Demon');
});

test('the longest matching phrase wins over a shorter term inside it', () => {
  assert.deepEqual(segments('your 2 alive neighbours', 'en').filter((s) => s.id), [{ text: 'alive neighbours', id: 'neighbours' }]);
  assert.deepEqual(termsIn('you still have your last vote', 'en'), ['ghostVote']);
  assert.deepEqual(termsIn('Each night*, choose a player', 'en'), ['nightStar']);
});

test('a definition never links to itself', () => {
  for (const g of GLOSSARY) {
    for (const lang of LANGS) assert.ok(!segments(g[lang].def, lang, g.id).some((s) => s.id === g.id));
  }
});

test('an unknown language falls back to English', () => {
  assert.deepEqual(termsIn('The Demon is evil.', 'de'), ['demon', 'evil']);
});

test('character abilities get their key terms underlined, in both languages', () => {
  const expect: Record<string, { en: string[]; fr: string[] }> = {
    virgin: { en: ['nominate', 'townsfolk', 'execution'], fr: ['nominate', 'townsfolk', 'execution'] },
    undertaker: { en: ['nightStar', 'execution'], fr: ['nightStar', 'execution'] },
    empath: { en: ['neighbours', 'evil'], fr: ['neighbours', 'evil'] },
    slayer: { en: ['oncePerGame', 'demon'], fr: ['oncePerGame', 'demon'] },
    recluse: { en: ['might', 'register', 'evil', 'minion', 'demon', 'dead'], fr: ['might', 'register', 'evil', 'minion', 'demon', 'dead'] },
    poisoner: { en: ['poisoned'], fr: ['poisoned'] },
  };
  for (const [id, want] of Object.entries(expect)) {
    const en = termsIn(CHARACTERS[id as keyof typeof CHARACTERS].ability, 'en');
    const fr = termsIn(CHAR_I18N_FR[id].ability, 'fr');
    for (const t of want.en) assert.ok(en.includes(t), `${id} (en) should underline ${t}: got ${en}`);
    for (const t of want.fr) assert.ok(fr.includes(t), `${id} (fr) should underline ${t}: got ${fr}`);
  }
});

test('every glossary term can be reached: it appears in the game\'s text or in another term\'s definition', () => {
  // Otherwise it's a definition nobody can ever tap.
  const gameText = appJs + JSON.stringify(Object.values(CHARACTERS).map((c) => c.ability));
  for (const lang of LANGS) {
    for (const g of GLOSSARY) {
      const otherDefs = GLOSSARY.filter((o) => o.id !== g.id).map((o) => o[lang].def).join(' ');
      assert.ok(
        termsIn(gameText, lang).includes(g.id) || termsIn(otherDefs, lang).includes(g.id),
        `nothing ever shows the ${lang} term "${g[lang].title}"`
      );
    }
  }
});
