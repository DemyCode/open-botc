import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPlayer, declareNeighbor, startGame } from '../game/engine.js';
import { mk } from './helpers.js';

/** Declares a full circle in the given player order: each player's right is the next in `order`. */
function declareFullCircle(state: ReturnType<typeof mk>, order = state.players): void {
  const n = order.length;
  for (let i = 0; i < n; i++) {
    declareNeighbor(state, order[i].id, order[(i + 1) % n].id);
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

test('seating is not confirmed until every player has declared their right', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b] = s.players;
  declareNeighbor(s, a.id, b.id);
  // c, d, e never declare
  assert.equal(s.seatingConfirmed, false);
});

test('a disagreement (broken cycle) does not resolve', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b, , d, e] = s.players;
  declareFullCircle(s, [a, b, s.players[2], d, e]);
  assert.equal(s.seatingConfirmed, true);

  // b changes their mind and claims d is to their right instead of c — breaks the circle.
  declareNeighbor(s, b.id, d.id);
  assert.equal(s.seatingConfirmed, false);
});

test('a full circle needs only one declaration per person (their own right)', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const order = s.players;
  declareFullCircle(s, order);
  assert.equal(s.seatingConfirmed, true);
  assert.deepEqual(
    s.players.slice().sort((p, q) => p.seat - q.seat).map((p) => p.id),
    order.map((p) => p.id)
  );
});

test('regression: changing your mind and then reverting correctly re-confirms the original circle', () => {
  // This is the actual bug reported in play: seating was declared correctly, then one person
  // changed their answer and changed it back, and the circle stayed stuck on "not confirmed".
  // Root cause was storing a derived "left" value that never got cleaned up when someone moved
  // their "right" pointer away from a target — the target's stale stored left survived even
  // after the mistake was corrected. Now there is no stored "left" at all, only "right", so
  // there's nothing to go stale.
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const [a, b, c, d, e, f] = s.players;
  declareFullCircle(s, [a, b, c, d, e, f]); // a->b->c->d->e->f->a
  assert.equal(s.seatingConfirmed, true);

  declareNeighbor(s, d.id, c.id); // d changes their mind: claims c is to their right instead of e
  assert.equal(s.seatingConfirmed, false, 'the circle should break while the mistake stands');

  declareNeighbor(s, d.id, e.id); // d reverts back to their original, correct answer
  assert.equal(s.seatingConfirmed, true, 'reverting the mistake must re-confirm the original circle');
  assert.deepEqual(
    s.players.slice().sort((p, q) => p.seat - q.seat).map((p) => p.id),
    [a, b, c, d, e, f].map((p) => p.id)
  );
});

test('you cannot declare yourself as your own neighbor', () => {
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a] = s.players;
  assert.throws(() => declareNeighbor(s, a.id, a.id));
});

test('picking the same person twice in a row (a mutual pair) is allowed as input, but never resolves', () => {
  // Input is unrestricted beyond "not yourself" — the only real check happens later, all at
  // once, in tryResolveSeating. A mutual pair naturally just never confirms with more than
  // 2 players, rather than being blocked at the moment someone picks it.
  const s = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman']);
  const [a, b] = s.players;
  declareNeighbor(s, a.id, b.id);
  assert.doesNotThrow(() => declareNeighbor(s, b.id, a.id));
  assert.equal(s.seatingConfirmed, false);
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
