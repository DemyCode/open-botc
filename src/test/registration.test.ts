import assert from 'node:assert/strict';
import { poison } from './helpers.js';
import { test } from 'node:test';
import { abilityWorks, registersAs } from '../game/registration.js';
import { mk } from './helpers.js';

test('Recluse misregistration as evil varies independently across questions', () => {
  const state = mk(['imp', 'recluse', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const recluse = state.players.find((p) => p.character === 'recluse')!;
  let sawTrue = false;
  let sawFalse = false;
  for (let i = 0; i < 60; i++) {
    const result = registersAs(state, recluse, 'evil', { asker: `asker-${i}`, slot: 'test' });
    if (result) sawTrue = true;
    else sawFalse = true;
  }
  assert.ok(sawTrue && sawFalse, 'Recluse misregistration should not be a single cached verdict');
});

test('Spy misregistration as good varies independently across questions', () => {
  const state = mk(['imp', 'spy', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const spy = state.players.find((p) => p.character === 'spy')!;
  let sawTrue = false;
  let sawFalse = false;
  for (let i = 0; i < 60; i++) {
    const result = registersAs(state, spy, 'good', { asker: `asker-${i}`, slot: 'test' });
    if (result) sawTrue = true;
    else sawFalse = true;
  }
  assert.ok(sawTrue && sawFalse, 'Spy misregistration should not be a single cached verdict');
});

test('registersAs is a pure deterministic function of its inputs', () => {
  const state = mk(['imp', 'recluse', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const recluse = state.players.find((p) => p.character === 'recluse')!;
  const a = registersAs(state, recluse, 'evil', { asker: 'x', slot: 'y' });
  const b = registersAs(state, recluse, 'evil', { asker: 'x', slot: 'y' });
  assert.equal(a, b);
});

test('a genuinely evil player always registers as evil, never misregisters as good', () => {
  const state = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const imp = state.players.find((p) => p.character === 'imp')!;
  for (let i = 0; i < 10; i++) {
    assert.equal(registersAs(state, imp, 'evil', { asker: `a${i}`, slot: 's' }), true);
  }
});

test('abilityWorks is false for the Drunk and for a poisoned player, true otherwise', () => {
  const state = mk(['imp', 'drunk', 'empath', 'soldier', 'monk', 'poisoner'], { drunkFakeChar: 'empath' });
  const drunk = state.players.find((p) => p.character === 'drunk')!;
  assert.equal(abilityWorks(state, drunk), false);

  const empath = state.players.find((p) => p.character === 'empath')!;
  assert.equal(abilityWorks(state, empath), true);

  poison(state, empath.id);
  assert.equal(abilityWorks(state, empath), false);
});

test('the Spy sometimes registers as GOOD when asked "is this player evil?" (the Chef\'s and the Empath\'s question)', () => {
  // Regression: the Spy could only register as good for good/Townsfolk/Outsider questions; asked the
  // Chef's or Empath's "evil?" question a Spy always answered yes. Wiki, Spy ex. 2.
  const state = mk(['imp', 'spy', 'empath', 'investigator', 'washerwoman', 'soldier']);
  const spy = state.players.find((p) => p.character === 'spy')!;
  const answers = new Set<boolean>();
  for (let i = 0; i < 60; i++) answers.add(registersAs(state, spy, 'evil', { asker: `asker-${i}`, slot: 'test' }));
  assert.deepEqual([...answers].sort(), [false, true]);
});

test('the Imp and the Poisoner always register as evil, whoever asks', () => {
  const state = mk(['imp', 'poisoner', 'empath', 'investigator', 'washerwoman', 'soldier']);
  for (const p of state.players.slice(0, 2)) {
    for (let i = 0; i < 40; i++) assert.equal(registersAs(state, p, 'evil', { asker: `a${i}`, slot: 's' }), true);
  }
});
