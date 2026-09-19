// The client only renders what the engine's view offers: who may nominate, who may be nominated and
// whether the Slayer shot is available are decided here, once, and the engine enforces the same rule.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nominate, useSlayer } from '../game/engine.js';
import { SCRIPTS } from '../game/scripts.js';
import { GameError } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { fastForwardToVote, mkDay, voteInOrder } from './helpers.js';

const table = () => mkDay(['imp', 'poisoner', 'empath', 'washerwoman', 'soldier']);

// ---------------------------------------------------------------- nomination

test('legal: a living player who has not nominated may nominate any player not yet nominated (the dead and themself included)', () => {
  const s = table();
  s.players[4].alive = false;
  const v = viewFor(s, s.players[2].id);
  assert.equal(v.canNominate, true);
  assert.deepEqual(new Set(v.nominatableIds), new Set(s.players.map((p) => p.id)), 'everyone, the dead and yourself included');
});

test('illegal: the dead cannot nominate — the view offers them nothing', () => {
  const s = table();
  s.players[2].alive = false;
  const v = viewFor(s, s.players[2].id);
  assert.equal(v.canNominate, false);
  assert.deepEqual(v.nominatableIds, []);
});

test('illegal: nobody may nominate while a nomination is in progress', () => {
  const s = table();
  nominate(s, s.players[0].id, s.players[1].id);
  for (const p of s.players) {
    const v = viewFor(s, p.id);
    assert.equal(v.canNominate, false);
    assert.deepEqual(v.nominatableIds, []);
  }
});

test('illegal: someone who already nominated today is offered nothing; someone already nominated is not offered as a target', () => {
  const s = table();
  const [a, b, c] = s.players;
  nominate(s, a.id, b.id);
  fastForwardToVote(s);
  voteInOrder(s, []);
  assert.equal(viewFor(s, a.id).canNominate, false, 'a nominated already');
  const vc = viewFor(s, c.id);
  assert.equal(vc.canNominate, true);
  assert.ok(!vc.nominatableIds.includes(b.id), 'b was already nominated today');
  assert.ok(vc.nominatableIds.includes(a.id), 'a nominated but was not nominated: still a legal target');
});

test('illegal: at night nothing can be nominated', () => {
  const s = table();
  s.phase = 'night';
  const v = viewFor(s, s.players[2].id);
  assert.equal(v.canNominate, false);
  assert.deepEqual(v.nominatableIds, []);
});

test('the view and the engine agree: every offered nomination is accepted, every other one is refused', () => {
  for (const seed of [0, 1, 2]) {
    const s = table();
    if (seed === 1) s.players[3].alive = false;
    if (seed === 2) { nominate(s, s.players[0].id, s.players[1].id); fastForwardToVote(s); voteInOrder(s, []); }
    for (const nominator of s.players) {
      const v = viewFor(s, nominator.id);
      for (const nominee of s.players) {
        const offered = v.canNominate && v.nominatableIds.includes(nominee.id);
        const copy = structuredClone(s);
        let accepted = true;
        try { nominate(copy, nominator.id, nominee.id); } catch (e) { if (!(e instanceof GameError)) throw e; accepted = false; }
        assert.equal(accepted, offered, `seed ${seed}: ${nominator.name} -> ${nominee.name}`);
      }
    }
  }
});

// ---------------------------------------------------------------- the Slayer shot

test('legal: every living player who has not fired is offered the Slayer shot when the Slayer is on the script', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'washerwoman', 'soldier']);
  for (const p of s.players) assert.equal(viewFor(s, p.id).slayerShotAvailable, true, p.name);
});

test('illegal: no Slayer shot on a script without the Slayer, and the engine refuses it too', () => {
  const s = mkDay(['po', 'grandmother', 'sailor', 'chambermaid', 'exorcist']);
  s.scriptChars = SCRIPTS.bmr.characters.slice();
  for (const p of s.players) assert.equal(viewFor(s, p.id).slayerShotAvailable, false, p.name);
  assert.throws(() => useSlayer(s, s.players[1].id, s.players[0].id), GameError);
});

test('illegal: no Slayer shot once spent, when dead, or at night', () => {
  const s = table();
  useSlayer(s, s.players[2].id, s.players[0].id);
  assert.equal(viewFor(s, s.players[2].id).slayerShotAvailable, false, 'spent');
  assert.equal(viewFor(s, s.players[3].id).slayerShotAvailable, true, 'others keep theirs');
  s.players[3].alive = false;
  assert.equal(viewFor(s, s.players[3].id).slayerShotAvailable, false, 'dead');
  s.phase = 'night';
  assert.equal(viewFor(s, s.players[4].id).slayerShotAvailable, false, 'night');
});

test('the Slayer shot is offered to everyone alike, so the offer proves nothing about who the Slayer is', () => {
  const s = mkDay(['imp', 'slayer', 'empath', 'washerwoman', 'soldier']);
  const offers = s.players.map((p) => viewFor(s, p.id).slayerShotAvailable);
  assert.equal(new Set(offers).size, 1);
});
