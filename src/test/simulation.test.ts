// Plays hundreds of complete random games — lobby to victory, every player count — through the
// same engine calls the server makes, and checks the game's invariants after every single step
// (see driver.ts). Illegal random moves must be refused with a GameError, never crash the game.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playGame } from './driver.js';

// Every one of these must happen in at least one simulated game — proof that the random games
// really reach the rare corners of the rules, not just the easy path.
const MUST_SEE_PUBLIC = [
  'slayerHit', 'slayerMiss', 'virginExecutesNominator', 'onBlock', 'tieClearsBlock', 'notEnoughVotes',
  'noExecutionToday', 'foundDead', 'nobodyDiedLastNight',
  'goodWinsDemonDead', 'evilWinsTwoLeft', 'goodWinsMayor', 'saintWins',
];
const MUST_SEE_PRIVATE = ['scarletWomanPromoted', 'becameImp', 'demonInfo', 'fortuneTellerYes', 'ravenkeeperInfo'];

test('hundreds of random full games, 5 to 15 players, all end cleanly with every rule invariant holding', () => {
  const seen = new Set<string>();
  for (let playerCount = 5; playerCount <= 15; playerCount++) {
    for (let seed = Number(process.env.SIM_FROM || 0); seed < Number(process.env.SIM_SEEDS || 60); seed++) {
      const s = playGame(seed, playerCount);
      for (const m of s.publicLog) seen.add(m.key);
      for (const p of s.players) for (const e of p.log) seen.add(e.msg.key);
    }
  }
  const missing = [...MUST_SEE_PUBLIC, ...MUST_SEE_PRIVATE].filter((k) => !seen.has(k));
  assert.deepEqual(missing, [], 'these situations never came up in any simulated game');
});
