// Scripts (an edition or a custom mix), statements a client may send, and seating input: the ways
// they are accepted, and every way they are refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_CHARACTER_IDS, CHARACTERS } from '../game/characters.js';
import { addPlayer, createGame, declareNeighbor, setScript, startGame } from '../game/engine.js';
import { CUSTOM_SCRIPT_ID, SCRIPTS, resolveScript } from '../game/scripts.js';
import { parseStatement } from '../game/statements.js';
import { GameError } from '../game/types.js';
import { playGame } from './driver.js';
import { mk } from './helpers.js';

const teamOf = (id: string) => CHARACTERS[id].team;
const some = (team: string, n: number) => ALL_CHARACTER_IDS.filter((id) => teamOf(id) === team).slice(0, n);
const valid = () => [...some('demon', 1), ...some('minion', 1), ...some('townsfolk', 3)];

// ---------------------------------------------------------------- custom scripts

test('legal: a custom script of one Demon, one Minion and three Townsfolk (from any edition) is accepted, duplicates removed', () => {
  const ids = valid();
  const script = resolveScript(CUSTOM_SCRIPT_ID, [...ids, ids[0]]);
  assert.deepEqual(script.characters, ids);
  assert.equal(script.id, CUSTOM_SCRIPT_ID);
});

test('legal: every edition resolves by id', () => {
  for (const id of ['tb', 'bmr', 'sv']) assert.equal(resolveScript(id).characters.length, SCRIPTS[id].characters.length);
});

test('illegal: unknown script, unknown character, no Demon, no Minion, fewer than 3 Townsfolk', () => {
  assert.throws(() => resolveScript('nope'), /Unknown script/);
  assert.throws(() => resolveScript(CUSTOM_SCRIPT_ID, [...valid(), 'ghost']), /Unknown character/);
  assert.throws(() => resolveScript(CUSTOM_SCRIPT_ID, valid().filter((id) => teamOf(id) !== 'demon')), /Demon/);
  assert.throws(() => resolveScript(CUSTOM_SCRIPT_ID, valid().filter((id) => teamOf(id) !== 'minion')), /Minion/);
  assert.throws(() => resolveScript(CUSTOM_SCRIPT_ID, valid().slice(0, 4)), /3 Townsfolk/);
  assert.throws(() => resolveScript(CUSTOM_SCRIPT_ID, undefined), GameError);
});

test('illegal: the script can only be chosen in the lobby', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'monk', 'soldier']);
  s.phase = 'day';
  assert.throws(() => setScript(s, 'bmr'), /before the game starts/);
});

test('illegal: a script with too few characters for the table cannot start (15 players from a 5-character script)', () => {
  const s = createGame('SMALL');
  const players = Array.from({ length: 15 }, (_, i) => addPlayer(s, `P${i}`));
  players.forEach((p, i) => declareNeighbor(s, p.id, players[(i + 1) % 15].id));
  setScript(s, CUSTOM_SCRIPT_ID, valid());
  assert.throws(() => startGame(s), /too few characters/);
  assert.equal(s.phase, 'lobby', 'the game did not start');
});

test('legal: games on a mixed-edition custom script play to the end', () => {
  // Every other character of each team: a bit of everything, from all three editions.
  const mix = ['townsfolk', 'outsider', 'minion', 'demon'].flatMap((team) => ALL_CHARACTER_IDS.filter((id) => teamOf(id) === team).filter((_, i) => i % 2 === 0));
  for (const n of [5, 8, 11, 15]) for (let seed = 0; seed < 8; seed++) assert.equal(playGame(seed, n, undefined, undefined, CUSTOM_SCRIPT_ID, mix).phase, 'ended');
});

test('legal: games on a script holding EVERY character in the game play to the end without breaking a rule', () => {
  for (let n = 5; n <= 15; n++) for (let seed = 0; seed < 25; seed++) assert.equal(playGame(seed, n, undefined, undefined, CUSTOM_SCRIPT_ID, ALL_CHARACTER_IDS).phase, 'ended');
});

// ---------------------------------------------------------------- seating input

test('illegal: nobody is their own neighbour, and the neighbour must exist', () => {
  const s = createGame('SEAT');
  const a = addPlayer(s, 'Ana');
  addPlayer(s, 'Ben');
  assert.throws(() => declareNeighbor(s, a.id, a.id), /own neighbor/);
  assert.throws(() => declareNeighbor(s, a.id, 'nobody'), GameError);
  assert.throws(() => declareNeighbor(s, 'nobody', a.id), GameError);
});

// ---------------------------------------------------------------- statements a client sends (Gossip, Artist)

test('legal: every statement shape a client may send is accepted', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'monk', 'soldier']);
  const [a, b] = s.players.map((p) => p.id);
  const shapes: unknown[] = [
    { t: 'alignment', p: a, v: 'evil' }, { t: 'team', p: a, v: 'demon' }, { t: 'character', p: a, v: 'imp' },
    { t: 'alive', p: a, v: true }, { t: 'neighbours', a, b },
    { t: 'count', what: 'alive', op: '>=', n: 3 }, { t: 'count', what: 'evilAlive', op: '=', n: 0 },
    { t: 'both', a: { t: 'alive', p: a, v: true }, b: { t: 'alive', p: b, v: false } },
    { t: 'not', s: { t: 'alignment', p: a, v: 'good' } },
  ];
  for (const raw of shapes) assert.doesNotThrow(() => parseStatement(s, raw), JSON.stringify(raw));
});

test('illegal: malformed statements are refused, never crash', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'monk', 'soldier']);
  const a = s.players[0].id;
  const bad: unknown[] = [
    null, 5, 'x', [], {}, { t: 'nope' },
    { t: 'alignment', p: a, v: 'purple' }, { t: 'alignment', p: 'ghost', v: 'evil' },
    { t: 'team', p: a, v: 'traveller' }, { t: 'character', p: a, v: 'ghost' }, { t: 'character', p: a, v: 7 },
    { t: 'alive', p: a, v: 'yes' }, { t: 'neighbours', a, b: 'ghost' },
    { t: 'count', what: 'alive', op: '>', n: 1 }, { t: 'count', what: 'nobody', op: '=', n: 1 },
    { t: 'count', what: 'alive', op: '=', n: -1 }, { t: 'count', what: 'alive', op: '=', n: 2.5 }, { t: 'count', what: 'alive', op: '=', n: 21 },
    { t: 'not', s: null },
  ];
  for (const raw of bad) assert.throws(() => parseStatement(s, raw), GameError, JSON.stringify(raw));
});

test('illegal: statements nested more than two levels deep are refused', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'monk', 'soldier']);
  const leaf = { t: 'alive', p: s.players[0].id, v: true };
  const wrap = (x: unknown) => ({ t: 'not', s: x });
  assert.doesNotThrow(() => parseStatement(s, wrap(wrap(leaf))));
  assert.throws(() => parseStatement(s, wrap(wrap(wrap(leaf)))), GameError);
});
