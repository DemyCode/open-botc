import assert from 'node:assert/strict';
import { test } from 'node:test';
import { viewFor } from '../game/view.js';
import { mk } from './helpers.js';

test('myGhostVoteUsed reflects whether this player has used their one post-death vote', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  const dead = s.players[2];
  dead.alive = false;
  assert.equal(viewFor(s, dead.id).myGhostVoteUsed, false);
  dead.ghostVoteUsed = true;
  assert.equal(viewFor(s, dead.id).myGhostVoteUsed, true);
});

test('dawn message: a player who died this night sees "You died tonight."', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'day';
  const victim = s.players[2];
  victim.alive = false;
  victim.diedTonight = true;
  const view = viewFor(s, victim.id);
  assert.deepEqual(view.dawnMessage, { key: 'diedTonight' });
});

test('dawn message: a player who survived sees "You survived the night."', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'day';
  const view = viewFor(s, s.players[0].id);
  assert.deepEqual(view.dawnMessage, { key: 'survivedNight' });
});

test('dawn message: someone already dead from an earlier night gets no message (not "survived", not "died tonight")', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'day';
  const longDead = s.players[2];
  longDead.alive = false;
  longDead.diedTonight = false; // died on some earlier night, reset since then
  const view = viewFor(s, longDead.id);
  assert.equal(view.dawnMessage, null);
});

test('dawn message only appears during the day', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'night';
  const view = viewFor(s, s.players[0].id);
  assert.equal(view.dawnMessage, null);
});

test('dusk message: the executed player sees "The village executed you."', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'night';
  s.night = 2;
  const executed = s.players[2];
  executed.alive = false;
  s.lastExecutedId = executed.id;
  const view = viewFor(s, executed.id);
  assert.deepEqual(view.duskMessage, { key: 'executedYou' });
});

test('dusk message: everyone else sees who was executed', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'night';
  s.night = 2;
  const executed = s.players[2];
  executed.alive = false;
  s.lastExecutedId = executed.id;
  const view = viewFor(s, s.players[0].id);
  assert.deepEqual(view.duskMessage, { key: 'executedOther', vars: { name: executed.name } });
});

test('dusk message: nobody executed shows the sleep message to everyone', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'night';
  s.night = 2;
  s.lastExecutedId = null;
  const view = viewFor(s, s.players[0].id);
  assert.deepEqual(view.duskMessage, { key: 'noExecutionSleep' });
});

test('dusk message only appears during the night', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'day';
  s.lastExecutedId = null;
  const view = viewFor(s, s.players[0].id);
  assert.equal(view.duskMessage, null);
});

test('a player killed tonight must not see their own death until dawn — same as the physical game', () => {
  // Regression: amIAlive reflected the raw, live alive flag, so a freshly-killed player's status
  // bar and night screen flipped to "you are dead" the instant the Demon acted, mid-night — a
  // reveal the Storyteller never actually makes until morning.
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'night';
  const victim = s.players[2];
  victim.alive = false;
  victim.diedTonight = true;
  assert.equal(viewFor(s, victim.id).amIAlive, true, 'must still appear alive to themselves while it is still night');

  s.phase = 'day';
  assert.equal(viewFor(s, victim.id).amIAlive, false, 'once dawn arrives the truth is revealed as normal');
});

test('a long-dead player (from an earlier night) correctly still shows as dead at night', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'night';
  const longDead = s.players[2];
  longDead.alive = false;
  longDead.diedTonight = false; // died on an earlier night — already public knowledge
  assert.equal(viewFor(s, longDead.id).amIAlive, false);
});

test('the Ravenkeeper is the deliberate exception — their own death is revealed immediately, since that is the whole point of their ability', () => {
  const s = mk(['imp', 'ravenkeeper', 'empath', 'soldier', 'washerwoman']);
  s.phase = 'night';
  const rk = s.players.find((p) => p.character === 'ravenkeeper')!;
  rk.alive = false;
  rk.diedTonight = true;
  assert.equal(viewFor(s, rk.id).amIAlive, false, 'the Ravenkeeper must see their own death right away, unlike everyone else');
});
