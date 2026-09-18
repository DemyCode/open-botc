// Situations where a game could get STUCK waiting for someone: a player whose phone dropped, a
// speech nobody starts, a vote nobody answers. Phones drop all the time (screen lock, tunnel,
// wifi) — a game must never freeze because of it. Timers are driven by explicit clock values.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markReadyForSpeech, nominate, skipSpeech, tick, toggleEndDayRequest } from '../game/engine.js';
import { fastForwardToVote, markAllReady, mkDay, voteInOrder } from './helpers.js';

const five = () => mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);

// ---- the ready gate before each speech ----

test('the accusation starts once every CONNECTED player is ready — a dropped phone does not block it', () => {
  const s = five();
  const [imp, , empath, washerwoman, soldier] = s.players;
  s.players[1].connected = false;
  nominate(s, empath.id, imp.id);
  for (const p of [imp, empath, washerwoman, soldier]) markReadyForSpeech(s, p.id);
  assert.equal(s.currentNomination!.state, 'accusing');
});

test('if a phone drops AFTER everyone else is ready, the speech starts on the next tick', () => {
  const s = five();
  const [imp, poisoner, empath, washerwoman, soldier] = s.players;
  nominate(s, empath.id, imp.id);
  for (const p of [imp, empath, washerwoman, soldier]) markReadyForSpeech(s, p.id);
  assert.equal(s.currentNomination!.state, 'readyForAccusation', 'still waiting for the Poisoner');
  poisoner.connected = false;
  tick(s, Date.now());
  assert.equal(s.currentNomination!.state, 'accusing');
});

test('a dead player who is connected still has to be ready (the rules: everyone hears the speech)', () => {
  const s = five();
  const [imp, poisoner, empath, washerwoman, soldier] = s.players;
  washerwoman.alive = false;
  nominate(s, empath.id, imp.id);
  for (const p of [imp, poisoner, empath, soldier]) markReadyForSpeech(s, p.id);
  assert.equal(s.currentNomination!.state, 'readyForAccusation');
  markReadyForSpeech(s, washerwoman.id);
  assert.equal(s.currentNomination!.state, 'accusing');
});

test('if nobody is connected, nothing advances by itself', () => {
  const s = five();
  const [imp, , empath] = s.players;
  nominate(s, empath.id, imp.id);
  for (const p of s.players) p.connected = false;
  tick(s, Date.now());
  assert.equal(s.currentNomination!.state, 'readyForAccusation');
});

test('there is NO ready step before the defense: it starts the moment the accusation ends, with a full 45 seconds', () => {
  const s = five();
  const [imp, , empath] = s.players;
  nominate(s, empath.id, imp.id);
  markAllReady(s);
  const before = Date.now();
  skipSpeech(s, empath.id);
  const nom = s.currentNomination!;
  assert.equal(nom.state, 'defending');
  assert.deepEqual(nom.readyBy, []);
  assert.ok(nom.phaseEndsAt >= before + 44_900 && nom.phaseEndsAt <= Date.now() + 45_100, 'the 45 seconds start now');
});

test('a "ready" tap while someone is speaking is refused — the ready step exists only before the accusation', () => {
  const s = five();
  const [imp, , empath, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  markAllReady(s);
  assert.throws(() => markReadyForSpeech(s, washerwoman.id), /Not waiting/);
  skipSpeech(s, empath.id);
  assert.throws(() => markReadyForSpeech(s, washerwoman.id), /Not waiting/);
});

test('the defense can still be ended early by the accused, and only by them', () => {
  const s = five();
  const [imp, , empath, washerwoman] = s.players;
  nominate(s, empath.id, imp.id);
  markAllReady(s);
  skipSpeech(s, empath.id);
  assert.throws(() => skipSpeech(s, washerwoman.id), /Only the accused/);
  assert.throws(() => skipSpeech(s, empath.id), /Only the accused/);
  skipSpeech(s, imp.id);
  assert.equal(s.currentNomination!.state, 'voting');
});

// ---- the timers ----

test('the accusation ends by itself after 45 seconds — not a moment before', () => {
  const s = five();
  const [imp, , empath] = s.players;
  nominate(s, empath.id, imp.id);
  markAllReady(s);
  const end = s.currentNomination!.phaseEndsAt;
  tick(s, end - 1);
  assert.equal(s.currentNomination!.state, 'accusing');
  tick(s, end);
  assert.equal(s.currentNomination!.state, 'defending', 'the defense follows at once');
  assert.ok(s.currentNomination!.phaseEndsAt > end - 1, 'with its own fresh 45 seconds');
});

test('the defense ends by itself after 45 seconds and the vote begins', () => {
  const s = five();
  const [imp, , empath] = s.players;
  nominate(s, empath.id, imp.id);
  markAllReady(s);
  skipSpeech(s, empath.id);
  const end = s.currentNomination!.phaseEndsAt;
  tick(s, end - 1);
  assert.equal(s.currentNomination!.state, 'defending');
  tick(s, end);
  assert.equal(s.currentNomination!.state, 'voting');
});

test('a voter who never answers is counted as NO after 15 seconds, and the next voter is asked', () => {
  const s = five();
  const [imp, , empath] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  const first = s.currentNomination!.currentVoterId!;
  const deadline = s.currentNomination!.voterDeadline!;
  tick(s, deadline - 1);
  assert.equal(s.currentNomination!.currentVoterId, first, 'not a moment early');
  tick(s, deadline);
  assert.notEqual(s.currentNomination!.currentVoterId, first);
  assert.equal(s.currentNomination!.votes[first], false);
});

test('a vote where nobody ever answers still finishes, with nobody on the block', () => {
  const s = five();
  const [imp, , empath] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  let guard = 0;
  while (s.currentNomination && guard++ < 20) tick(s, s.currentNomination.voterDeadline!);
  assert.equal(s.currentNomination, null);
  assert.equal(s.onBlockId, null);
  assert.ok(s.publicLog.some((m) => m.key === 'notEnoughVotes'));
});

test('each voter gets a fresh 15 seconds, not what is left of the last one', () => {
  const s = five();
  const [imp, , empath] = s.players;
  nominate(s, empath.id, imp.id);
  fastForwardToVote(s);
  const d1 = s.currentNomination!.voterDeadline!;
  tick(s, d1);
  const d2 = s.currentNomination!.voterDeadline!;
  assert.ok(d2 >= Date.now() + 14_000, 'a new full window');
});

test('ticks do nothing in the lobby, when the game is over, or when nothing is going on', () => {
  const s = five();
  tick(s, Date.now() + 1e9);
  assert.equal(s.phase, 'day');
  s.phase = 'ended';
  tick(s, Date.now() + 1e9);
  assert.equal(s.phase, 'ended');
  s.phase = 'lobby';
  assert.doesNotThrow(() => tick(s, Date.now()));
});

// ---- ending the day ----

test('the day ends when every CONNECTED living player agrees — a dropped phone cannot freeze the game', () => {
  const s = five();
  s.players[4].connected = false;
  for (const p of s.players.slice(0, 4)) toggleEndDayRequest(s, p.id);
  assert.equal(s.phase, 'night');
});

test('if a phone drops after everyone else agreed, the day ends on the next tick', () => {
  const s = five();
  for (const p of s.players.slice(0, 4)) toggleEndDayRequest(s, p.id);
  assert.equal(s.phase, 'day');
  s.players[4].connected = false;
  tick(s, Date.now());
  assert.equal(s.phase, 'night');
});

test('one player agreeing alone does NOT end the day while the others are connected', () => {
  const s = five();
  toggleEndDayRequest(s, s.players[0].id);
  tick(s, Date.now());
  assert.equal(s.phase, 'day');
});

test('nobody agreeing never ends the day, even if everyone but one dropped', () => {
  const s = five();
  for (const p of s.players.slice(1)) p.connected = false;
  tick(s, Date.now());
  assert.equal(s.phase, 'day', 'someone must actually agree');
});

test('a disconnected player who already agreed still counts when they come back', () => {
  const s = five();
  toggleEndDayRequest(s, s.players[4].id);
  s.players[4].connected = false;
  for (const p of s.players.slice(0, 4)) toggleEndDayRequest(s, p.id);
  assert.equal(s.phase, 'night');
});

test('ending the day still executes whoever is on the block when a phone dropped', () => {
  const s = five();
  const [, poisoner, empath, washerwoman, soldier] = s.players;
  nominate(s, empath.id, poisoner.id);
  fastForwardToVote(s);
  voteInOrder(s, [empath.id, washerwoman.id, soldier.id]);
  assert.equal(s.onBlockId, poisoner.id);
  soldier.connected = false;
  for (const p of s.players.filter((q) => q.connected)) toggleEndDayRequest(s, p.id);
  assert.equal(poisoner.alive, false);
  assert.equal(s.phase, 'night');
});

