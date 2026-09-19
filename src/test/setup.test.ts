// Dealing a game: for every player count and script, over many secrets, the deal obeys the official
// distribution and never breaks a setup rule.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHARACTERS, DISTRIBUTION } from '../game/characters.js';
import { hooksOf } from '../game/deaths.js';
import { SCRIPTS } from '../game/scripts.js';
import { dealCharacters } from '../game/setup.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const teamCount = (chars: string[], team: string) => chars.filter((c) => CHARACTERS[c].team === team).length;

for (const script of Object.values(SCRIPTS)) {
  test(`${script.name}: every deal from 5 to 15 players has the right teams, distinct characters, and legal fakes and bluffs`, () => {
    for (let n = 5; n <= 15; n++) {
      for (let k = 0; k < 40; k++) {
        const deal = dealCharacters(ids(n), `s${n}-${k}`, script.characters);
        const dealt = Object.values(deal.characters);
        assert.equal(dealt.length, n);
        assert.equal(new Set(dealt).size, n, `${n}p/${k}: a character was dealt twice`);
        for (const c of dealt) assert.ok(script.characters.includes(c), `${c} is not on the script`);

        // The official table, shifted only by the characters' own setup hooks.
        const [tf, out, min, dem] = DISTRIBUTION[n];
        assert.equal(teamCount(dealt, 'minion'), min);
        assert.equal(teamCount(dealt, 'demon'), dem);
        const shifted = teamCount(dealt, 'outsider') - out;
        const townsfolkShift = tf - teamCount(dealt, 'townsfolk');
        assert.equal(shifted, townsfolkShift, `${n}p/${k}: outsiders gained must equal townsfolk lost`);
        const wanted = dealt.filter((c) => CHARACTERS[c].team === 'minion' || CHARACTERS[c].team === 'demon')
          .map((c) => hooksOf(c).setup?.outsiderDelta).filter((d) => d !== undefined);
        if (!wanted.some((d) => typeof d !== 'number')) {
          const expected = Math.max(-out, Math.min((wanted as number[]).reduce((a, b) => a + b, 0), tf - 1)) || 0;
          assert.equal(shifted, expected + 0, `${n}p/${k}: outsider shift`);
        }

        // Someone told they are another character (the Drunk, the Lunatic): a real, unused character of the right team.
        for (const [pid, real] of Object.entries(deal.characters)) {
          const seen = deal.perceived[pid];
          const want = hooksOf(real).setup?.thinksTheyAre;
          if (!want) { assert.equal(seen, real); continue; }
          assert.equal(CHARACTERS[seen].team, want, `${real} must believe a ${want}`);
          assert.ok(script.characters.includes(seen));
          if (want === 'townsfolk') assert.ok(!dealt.includes(seen), `${n}p/${k}: the Drunk believes ${seen}, who is really in play`);
        }

        // The Demon's bluffs: three different good characters that are not in play.
        assert.equal(new Set(deal.bluffs).size, deal.bluffs.length);
        assert.ok(deal.bluffs.length <= 3);
        for (const b of deal.bluffs) {
          assert.ok(['townsfolk', 'outsider'].includes(CHARACTERS[b].team), `${b} is not good`);
          assert.ok(!dealt.includes(b), `bluff ${b} is in play`);
        }
        // The Fortune Teller's red herring is a good player.
        if (deal.redHerringId) assert.ok(['townsfolk', 'outsider'].includes(CHARACTERS[deal.characters[deal.redHerringId]].team));
      }
    }
  });
}

test('illegal: fewer than 5 or more than 15 players cannot be dealt', () => {
  assert.throws(() => dealCharacters(ids(4), 'x'), /Unsupported/);
  assert.throws(() => dealCharacters(ids(16), 'x'), /Unsupported/);
});

test('the deal is a pure function of the secret', () => {
  assert.deepEqual(dealCharacters(ids(9), 'same'), dealCharacters(ids(9), 'same'));
  assert.notDeepEqual(dealCharacters(ids(9), 'one'), dealCharacters(ids(9), 'two'));
});
