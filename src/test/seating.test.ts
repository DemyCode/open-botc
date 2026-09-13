import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPlayer, declareNeighbor, startGame } from '../game/engine.js';
import { mk } from './helpers.js';

/** Declares a full, mutually-consistent circle in the given player order (index i's right is i+1). */
function declareFullCircle(state: ReturnType<typeof mk>, order = state.players): void {
  const n = order.length;
  for (let i = 0; i < n; i++) {
    const self = order[i];
    const left = order[(i - 1 + n) % n];
    const right = order[(i + 1) % n];
    declareNeighbor(state, self.id, 'left', left.id);
    declareNeighbor(state, self.id, 'right', right.id);
  }
}

test('a fully agreed-upon circle resolves and assigns seats matching the declared order', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b, c, d, e] = s.players;
  declareFullCircle(s, [a, b, c, d, e]);
  assert.equal(s.seatingConfirmed, true);
  assert.deepEqual(
    s.players.slice().sort((p, q) => p.seat - q.seat).map((p) => p.id),
    [a.id, b.id, c.id, d.id, e.id]
  );
});

test('seating is not confirmed until every player has declared both sides', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b, c, d, e] = s.players;
  declareNeighbor(s, a.id, 'left', e.id);
  declareNeighbor(s, a.id, 'right', b.id);
  declareNeighbor(s, b.id, 'left', a.id);
  // c, d, e never declare
  assert.equal(s.seatingConfirmed, false);
});

test('a disagreement (broken cycle) does not resolve', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b, c, d, e] = s.players;
  declareFullCircle(s, [a, b, c, d, e]);
  assert.equal(s.seatingConfirmed, true);

  // b changes their mind and claims d is to their right instead of c — breaks the circle.
  declareNeighbor(s, b.id, 'right', d.id);
  assert.equal(s.seatingConfirmed, false);
});

test('a one-sided mismatch (right says X, but X does not say left back) does not resolve', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b, c, d, e] = s.players;
  declareFullCircle(s, [a, b, c, d, e]);
  // c insists their left is e (wrong — should be b), contradicting b's claim that c is to their right.
  declareNeighbor(s, c.id, 'left', e.id);
  assert.equal(s.seatingConfirmed, false);
});

test('declaring one side automatically fills in the reciprocal for the other player', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b] = s.players;
  declareNeighbor(s, a.id, 'right', b.id); // "b is to my right"
  assert.equal(b.seatLeftId, a.id, "b should automatically see a as being on b's left");
});

test('a full circle can be confirmed with only one declaration per edge, thanks to reciprocal auto-fill', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const order = s.players;
  // Each player only declares their own right neighbor — every left side is auto-filled.
  for (let i = 0; i < order.length; i++) {
    declareNeighbor(s, order[i].id, 'right', order[(i + 1) % order.length].id);
  }
  assert.equal(s.seatingConfirmed, true);
  assert.deepEqual(
    s.players.slice().sort((p, q) => p.seat - q.seat).map((p) => p.id),
    order.map((p) => p.id)
  );
});

test('a later conflicting reciprocal overwrite correctly breaks a previously resolved circle', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const order = s.players;
  const [a, , , d] = order;
  for (let i = 0; i < order.length; i++) {
    declareNeighbor(s, order[i].id, 'right', order[(i + 1) % order.length].id);
  }
  assert.equal(s.seatingConfirmed, true);

  // d mistakenly claims a is to their right, silently overwriting a's declared left (was e).
  declareNeighbor(s, d.id, 'right', a.id);
  assert.equal(a.seatLeftId, d.id, "a's left should now reflect d's claim");
  assert.equal(s.seatingConfirmed, false);
});

test('you cannot declare yourself as your own neighbor', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a] = s.players;
  assert.throws(() => declareNeighbor(s, a.id, 'left', a.id));
});

test('left and right must be different people', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b] = s.players;
  declareNeighbor(s, a.id, 'left', b.id);
  assert.throws(() => declareNeighbor(s, a.id, 'right', b.id));
});

test('adding a new player invalidates a previously confirmed seating', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b, c, d, e] = s.players;
  declareFullCircle(s, [a, b, c, d, e]);
  assert.equal(s.seatingConfirmed, true);

  addPlayer(s, 'Newcomer');
  assert.equal(s.seatingConfirmed, false);
});

test('the game cannot start until seating is confirmed', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  assert.throws(() => startGame(s), /[Ss]eating/);

  const [a, b, c, d, e] = s.players;
  declareFullCircle(s, [a, b, c, d, e]);
  startGame(s); // should not throw now
  assert.equal(s.phase, 'night');
});
