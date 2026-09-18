// Every sentence a phone shows, in both languages. A missing key or a badly filled-in variable
// shows up on a player's screen as raw text ("decoyNote", "undefined"), so this checks the
// language tables against the code that uses them, and renders every message the engine really
// produces — over whole games — in English and in French.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { CHARACTERS } from '../game/characters.js';
import { DECOY_INFO, DECOY_PICK_ONE, DECOY_PICK_TWO } from '../game/night.js';
import type { GameState, Msg } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { playGame } from './driver.js';

const appJs = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

/** Pulls one top-level `const NAME = {...};` object literal out of app.js and evaluates it. */
function literal(name: string, sandbox: Record<string, unknown> = {}): Record<string, Record<string, unknown>> {
  const start = appJs.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `${name} not found in app.js`);
  const end = appJs.indexOf('\n};', start);
  const body = appJs.slice(start + `const ${name} = `.length, end + 2);
  return vm.runInNewContext('(' + body + ')', sandbox);
}

const unknownRoles = new Set<string>();
const roleNameFor = (id: string): string => {
  if (!CHARACTERS[id as keyof typeof CHARACTERS]) unknownRoles.add(id);
  return CHARACTERS[id as keyof typeof CHARACTERS]?.name ?? id;
};
const TEAM_SINGULAR = literal('TEAM_SINGULAR');
const TEAM_PLURAL = literal('TEAM_PLURAL');
const STRINGS = literal('STRINGS');
const MESSAGES = literal('MESSAGES', { TEAM_SINGULAR, TEAM_PLURAL, roleNameFor });
const CHAR_I18N_FR = literal('CHAR_I18N_FR') as unknown as Record<string, { name: string; ability: string }>;
const LANGS = ['en', 'fr'] as const;

const keysOf = (o: object) => Object.keys(o).sort();

/** Every message key the engine's source can emit: msg('key') and msg(cond ? 'a' : 'b'). */
function emittedKeys(): Set<string> {
  const emitted = new Set<string>();
  for (const file of fs.readdirSync('src/game')) {
    const src = fs.readFileSync(path.join('src/game', file), 'utf8');
    for (const call of src.matchAll(/\bmsg\(([^()]*)/g)) {
      for (const lit of call[1].matchAll(/'([A-Za-z]+)'/g)) emitted.add(lit[1]);
    }
  }
  return emitted;
}

/** True if `text` shows a template that was filled in wrongly. */
function looksBroken(text: unknown): string | null {
  if (typeof text !== 'string') return `not a string (${typeof text})`;
  if (!text.trim()) return 'empty';
  for (const bad of ['undefined', 'null', 'NaN', '[object', '${', 'Infinity']) if (text.includes(bad)) return `contains "${bad}": ${text}`;
  return null;
}

// ---------------------------------------------------------------- the interface strings (t('key'))

test('English and French have exactly the same interface strings', () => {
  assert.deepEqual(keysOf(STRINGS.fr), keysOf(STRINGS.en));
});

test('every t(\'key\') used in the app exists in both languages', () => {
  const used = new Set<string>();
  for (const call of appJs.matchAll(/\bt\(([^()]*)\)/g)) {
    for (const lit of call[1].matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)) used.add(lit[1]);
  }
  // Keys the app builds from the server: decoy questions and their labels.
  for (const k of [...DECOY_PICK_ONE, DECOY_PICK_TWO, DECOY_INFO, 'decoyNote', 'decoyResult', 'waitingEveryone']) used.add(k);
  const missing: string[] = [];
  for (const k of used) for (const lang of LANGS) if (!(k in STRINGS[lang])) missing.push(`${lang}:${k}`);
  assert.deepEqual(missing, []);
});

test('every interface string is real text in both languages, and never blank or a placeholder', () => {
  const problems: string[] = [];
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      if (typeof value === 'function') continue;
      const why = looksBroken(value);
      if (why) problems.push(`${lang}.${key}: ${why}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('every interface string that takes arguments renders cleanly with real-looking arguments', () => {
  const problems: string[] = [];
  const samples: unknown[][] = [['Ana', 'Bo', 3, 12], ['Bo', 'Cy', 45, 2]];
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      if (typeof value !== 'function') continue;
      for (const args of samples) {
        try {
          const out = (value as (...a: unknown[]) => unknown)(...args.slice(0, Math.max(1, (value as () => void).length)));
          const why = looksBroken(out);
          if (why) problems.push(`${lang}.${key}(${args.join(',')}): ${why}`);
        } catch (e) {
          problems.push(`${lang}.${key} threw: ${(e as Error).message}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('the two languages agree on which strings are functions and how many arguments they take', () => {
  const problems: string[] = [];
  for (const key of keysOf(STRINGS.en)) {
    const en = STRINGS.en[key];
    const fr = STRINGS.fr[key];
    if ((typeof en === 'function') !== (typeof fr === 'function')) problems.push(`${key}: function in one language only`);
    else if (typeof en === 'function' && (en as () => void).length !== (fr as () => void).length) problems.push(`${key}: ${(en as () => void).length} vs ${(fr as () => void).length} arguments`);
  }
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------- game messages (tMsg)

test('English and French have exactly the same game messages', () => {
  assert.deepEqual(keysOf(MESSAGES.fr), keysOf(MESSAGES.en));
});

test('every message the engine can produce has a translation in both languages', () => {
  const emitted = emittedKeys();
  assert.ok(emitted.size > 30, `found only ${emitted.size} message keys — the scan is broken`);
  const missing: string[] = [];
  for (const key of emitted) for (const lang of LANGS) if (!(key in MESSAGES[lang])) missing.push(`${lang}:${key}`);
  assert.deepEqual(missing, []);
});

test('no game message in the tables is unused (dead text)', () => {
  const emitted = emittedKeys();
  assert.deepEqual(keysOf(MESSAGES.en).filter((k) => !emitted.has(k)), []);
});

/** Every distinct message a phone could be shown during one game. */
function collect(into: Map<string, Msg>): (s: GameState) => void {
  const add = (m: Msg | null | undefined) => {
    if (m) into.set(JSON.stringify(m), m);
  };
  return (s) => {
    for (const p of s.players) {
      const v = viewFor(s, p.id);
      v.publicLog.forEach(add);
      v.myLog.forEach((e) => add(e.msg));
      add(v.nightResult);
      add(v.dawnMessage);
      add(v.duskMessage);
      if (v.nightTurn && !v.nightTurn.decoy) add(v.nightTurn.body);
    }
  };
}

test('every message produced over 130 whole games renders cleanly in English and in French', () => {
  const seen = new Map<string, Msg>();
  const gather = collect(seen);
  for (let n = 5; n <= 15; n++) for (let seed = 0; seed < 12; seed++) playGame(seed, n, (s) => gather(s));
  assert.ok(seen.size > 100, `only ${seen.size} distinct messages were seen`);
  const problems: string[] = [];
  for (const lang of LANGS) {
    for (const m of seen.values()) {
      const fn = MESSAGES[lang][m.key] as ((v: unknown) => unknown) | undefined;
      if (!fn) { problems.push(`${lang}: no text for ${m.key}`); continue; }
      try {
        const why = looksBroken(fn(m.vars || {}));
        if (why) problems.push(`${lang} ${m.key} ${JSON.stringify(m.vars)}: ${why}`);
      } catch (e) {
        problems.push(`${lang} ${m.key} threw ${(e as Error).message}`);
      }
    }
  }
  assert.deepEqual(problems.slice(0, 10), []);
  assert.deepEqual([...unknownRoles], [], 'a message named a character that does not exist');
});

test('the message keys seen in real games cover every kind of message the game has', () => {
  const seen = new Map<string, Msg>();
  const gather = collect(seen);
  for (let n = 5; n <= 15; n++) for (let seed = 0; seed < 30; seed++) playGame(seed, n, (s) => gather(s));
  const kinds = new Set([...seen.values()].map((m) => m.key));
  for (const must of ['investigativeInfo', 'chefInfo', 'empathInfo', 'fortuneTellerYes', 'fortuneTellerNo', 'undertakerInfo', 'undertakerNone',
    'ravenkeeperInfo', 'minionInfoGroup', 'demonInfo', 'spyGrimoire', 'foundDead', 'wasExecuted', 'onBlock', 'diedTonight', 'survivedNight',
    'executedOther', 'noExecutionSleep', 'poisonerChoose', 'monkChoose', 'impChoose', 'butlerChoose', 'fortuneTellerChoose']) {
    assert.ok(kinds.has(must), `no game ever showed a "${must}" message`);
  }
});

// ---------------------------------------------------------------- characters

test('every character has a French name and ability, and the French names are all different', () => {
  const ids = Object.keys(CHARACTERS);
  assert.deepEqual(keysOf(CHAR_I18N_FR), [...ids].sort());
  for (const id of ids) {
    assert.ok(CHAR_I18N_FR[id].name.trim() && CHAR_I18N_FR[id].ability.trim(), id);
    assert.equal(looksBroken(CHAR_I18N_FR[id].ability), null, id);
  }
  assert.equal(new Set(ids.map((id) => CHAR_I18N_FR[id].name)).size, ids.length, 'two characters share a French name');
});

test('every character\'s English text is real, and the two languages agree on "each night*" and "[+2 Outsiders]" markers', () => {
  for (const c of Object.values(CHARACTERS)) {
    assert.equal(looksBroken(c.ability), null, c.id);
    assert.equal(c.ability.includes('night*'), CHAR_I18N_FR[c.id].ability.includes('nuit*'), `${c.id}: the "not on the first night" star differs`);
    assert.equal(/\[\+2/.test(c.ability), /\[\+2/.test(CHAR_I18N_FR[c.id].ability), `${c.id}: the Outsider marker differs`);
  }
});

test('the role reference sheet lists every character exactly once', () => {
  const names = Object.values(CHARACTERS).map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, 22);
});
