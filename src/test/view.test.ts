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
