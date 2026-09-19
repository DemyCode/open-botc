// Sects & Violets.
import { CHARACTERS, alignmentOfCharacter, isEvilTeam } from '../characters.js';
import { abilityKill, demonAttack, executePlayer, markDead } from '../deaths.js';
import { addDrunk, addPoison, removeEffects } from '../effects.js';
import { record } from '../history.js';
import { msg } from '../messages.js';
import { infoUnreliable, nearestLiving } from '../info.js';
import { appendLog } from '../log.js';
import { abilityWorks, malfunctionCount } from '../registration.js';
import { evalStatement, generateStatement, parseStatement, statementForMessage } from '../statements.js';
import { evaluateWin, setWinner } from '../win.js';
import type { CharacterDef } from '../hooks.js';
import type { CharacterId, GameState, PlayerState } from '../types.js';
import { GameError } from '../types.js';
import { giveResult } from './tb.js';
import { alivePlayers, byId, choose, demonChoosePrompt, isDemon, isMinion, roll, teamOf } from './util.js';

const seated = (s: GameState): PlayerState[] => s.players.slice().sort((a, b) => a.seat - b.seat);
const goodChars = (s: GameState): CharacterId[] => s.scriptChars.filter((c) => !isEvilTeam(CHARACTERS[c].team));

/** The nearest living Townsfolk on each side of `p` (up to two), skipping the dead and non-Townsfolk. */
const nearestTownsfolkNeighbors = (s: GameState, p: PlayerState): PlayerState[] =>
  nearestLiving(s, p, (q) => teamOf(q) === 'townsfolk');

/** How many seats from the Demon to its nearest Minion, going either way. */
function stepsToNearestMinion(s: GameState, demon: PlayerState): number {
  const order = seated(s);
  const idx = order.indexOf(demon);
  const dist = (dir: number): number => {
    for (let n = 1; n <= order.length; n++) {
      const q = order[(((idx + dir * n) % order.length) + order.length) % order.length];
      if (isMinion(q)) return n;
    }
    return 0;
  };
  const a = dist(1);
  const b = dist(-1);
  return a && b ? Math.min(a, b) : a || b;
}

/** Validates the Juggler's public guesses: up to five distinct players, each with a real character. */
function parseGuesses(s: GameState, raw: unknown): { p: string; v: string }[] {
  if (!Array.isArray(raw)) throw new GameError('Invalid guesses');
  if (raw.length > 5) throw new GameError('At most 5 guesses');
  const out: { p: string; v: string }[] = [];
  const seen = new Set<string>();
  for (const g of raw) {
    const o = g as { p?: unknown; v?: unknown };
    if (typeof o?.p !== 'string' || typeof o?.v !== 'string') throw new GameError('Invalid guess');
    if (!s.players.some((p) => p.id === o.p)) throw new GameError('Invalid guess: unknown player');
    if (!CHARACTERS[o.v]) throw new GameError('Invalid guess: unknown character');
    if (seen.has(o.p)) throw new GameError('Cannot guess the same player twice');
    seen.add(o.p);
    out.push({ p: o.p, v: o.v });
  }
  return out;
}

export const SV: CharacterDef[] = [
  // ------------------------------------------------------------------------------------ Townsfolk
  { id: 'clockmaker', name: 'Clockmaker', team: 'townsfolk', shape: 'info', edition: 'sv', firstNight: 410, otherNight: 0,
    ability: 'You start knowing how many steps from the Demon to its nearest Minion.',
    hooks: { night: { info: (s, self, slot) => {
      const demon = s.players.find(isDemon);
      let count = demon ? stepsToNearestMinion(s, demon) : 0;
      if (infoUnreliable(s, self)) count = 1 + Math.floor(roll(s, slot, self.id, 'fake') * 3);
      return msg('clockmakerInfo', { count });
    } } } },
  { id: 'dreamer', name: 'Dreamer', team: 'townsfolk', shape: 'choose', edition: 'sv', firstNight: 420, otherNight: 560,
    ability: 'Each night, choose a player (not yourself or Travellers): you learn 1 good and 1 evil character, 1 of which is correct.',
    hooks: { night: {
      recordsChoice: true, result: true, notSelf: true,
      prompt: () => ({ min: 1, max: 1, body: msg('dreamerChoose'), eligible: (_s, _self, t) => t.alive }),
      apply: (s, self, targets, slot) => {
        const target = byId(s, targets[0]);
        const trueChar = target.character;
        const trueEvil = isEvilTeam(CHARACTERS[trueChar].team);
        const goodPool = s.scriptChars.filter((c) => !isEvilTeam(CHARACTERS[c].team) && c !== trueChar);
        const evilPool = s.scriptChars.filter((c) => isEvilTeam(CHARACTERS[c].team) && c !== trueChar);
        let goodChar: CharacterId;
        let evilChar: CharacterId;
        if (!infoUnreliable(s, self)) {
          // Exactly one of the two is the target's real character.
          goodChar = trueEvil ? choose(s, goodPool, slot, self.id, 'good') : trueChar;
          evilChar = trueEvil ? trueChar : choose(s, evilPool, slot, self.id, 'evil');
        } else {
          goodChar = choose(s, goodPool, slot, self.id, 'good');
          evilChar = choose(s, evilPool, slot, self.id, 'evil');
        }
        const pair = choose(s, [0, 1], slot, self.id, 'order') === 0 ? [goodChar, evilChar] : [evilChar, goodChar];
        giveResult(s, self, msg('dreamerInfo', { a: pair[0], b: pair[1] }), 'dreamer');
      },
    } } },
  { id: 'snakecharmer', name: 'Snake Charmer', team: 'townsfolk', shape: 'choose', edition: 'sv', firstNight: 200, otherNight: 110,
    ability: 'Each night, choose an alive player: a chosen Demon swaps characters & alignments with you & is then poisoned.',
    hooks: { night: {
      recordsChoice: true,
      prompt: () => ({ min: 1, max: 1, body: msg('snakecharmerChoose'), eligible: (_s, _self, t) => t.alive }),
      apply: (s, self, targets) => {
        if (!abilityWorks(s, self)) return;
        const target = byId(s, targets[0]);
        if (!isDemon(target)) return;
        const demonChar = target.character;
        const myChar = self.character;
        const myAlign = self.alignment;
        self.character = demonChar; self.perceived = demonChar; self.alignment = target.alignment; self.flags = {};
        target.character = myChar; target.perceived = myChar; target.alignment = myAlign;
        record(s, 'promotion', { player: self.id, reason: 'snakeCharmer' });
        record(s, 'promotion', { player: target.id, reason: 'snakeCharmer' });
        appendLog(s, self.id, msg('snakeCharmerBecame', { role: demonChar }));
        appendLog(s, target.id, msg('snakeCharmerYou', { role: myChar }));
        addPoison(s, target, self, 'snakecharmer', null, { needsSourceAlive: true });
      },
    } } },
  { id: 'mathematician', name: 'Mathematician', team: 'townsfolk', shape: 'info', edition: 'sv', firstNight: 520, otherNight: 710,
    ability: "Each night, you learn how many players' abilities worked abnormally (since dawn) due to another character's ability.",
    hooks: { night: { info: (s, self, slot) => {
      let count = malfunctionCount(s);
      if (infoUnreliable(s, self)) count = 1 + Math.floor(roll(s, slot, self.id, 'fake') * 3);
      return msg('mathematicianInfo', { count });
    } } } },
  { id: 'flowergirl', name: 'Flowergirl', team: 'townsfolk', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 570,
    ability: 'Each night*, you learn if a Demon voted today.',
    hooks: { night: { info: (s, self) => {
      const real = !!s.data.demonVotedToday;
      return msg('flowergirlInfo', { yes: (infoUnreliable(s, self) ? !real : real) ? 1 : 0 });
    } } } },
  { id: 'towncrier', name: 'Town Crier', team: 'townsfolk', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 580,
    ability: 'Each night*, you learn if a Minion nominated today.',
    hooks: { night: { info: (s, self) => {
      const real = !!s.data.minionNominatedToday;
      return msg('towncrierInfo', { yes: (infoUnreliable(s, self) ? !real : real) ? 1 : 0 });
    } } } },
  { id: 'oracle', name: 'Oracle', team: 'townsfolk', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 590,
    ability: 'Each night*, you learn how many dead players are evil.',
    hooks: { night: { info: (s, self, slot) => {
      let count = s.players.filter((p) => !p.alive && p.alignment === 'evil').length;
      if (infoUnreliable(s, self)) count = Math.floor(roll(s, slot, self.id, 'fake') * 4);
      return msg('oracleInfo', { count });
    } } } },
  { id: 'savant', name: 'Savant', team: 'townsfolk', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 0,
    ability: 'Each day, you may visit the Storyteller to learn 2 things in private: 1 is true & 1 is false.',
    hooks: { day: {
      offeredTo: 'alive', private: true, targets: 0, statement: true,
      use: (s, self) => {
        const ctx = { asker: self.id, slot: `savant-d${s.day}` };
        const a = statementForMessage(s, generateStatement(s, true, `${s.day}-a`, ctx));
        const b = statementForMessage(s, generateStatement(s, false, `${s.day}-b`, ctx));
        appendLog(s, self.id, msg('savantInfo', { a, b }));
        record(s, 'statement', { by: self.id, character: 'savant', a, b });
      },
    } } },
  { id: 'seamstress', name: 'Seamstress', team: 'townsfolk', shape: 'choose', edition: 'sv', firstNight: 430, otherNight: 600,
    ability: 'Once per game, at night, choose 2 players (not yourself): you learn if they are the same alignment.',
    hooks: { night: {
      recordsChoice: true, result: true, notSelf: true,
      actors: (s) => s.players.filter((p) => p.alive && p.perceived === 'seamstress' && !p.flags.seamstressUsed),
      prompt: () => ({ min: 2, max: 2, body: msg('seamstressChoose'), eligible: (_s, self, t) => t.id !== self.id }),
      apply: (s, self, targets) => {
        self.flags.seamstressUsed = true;
        const [a, b] = targets.map((id) => byId(s, id));
        let same = a.alignment === b.alignment;
        if (infoUnreliable(s, self)) same = !same;
        giveResult(s, self, msg('seamstressInfo', { same: same ? 1 : 0 }), 'seamstress');
      },
    } } },
  { id: 'philosopher', name: 'Philosopher', team: 'townsfolk', shape: 'choose', edition: 'sv', firstNight: 20, otherNight: 20,
    ability: 'Once per game, at night, choose a good character: gain that ability. If this character is in play, they are drunk.',
    hooks: { night: {
      recordsChoice: true,
      actors: (s) => s.players.filter((p) => p.alive && p.perceived === 'philosopher' && !p.flags.philosopherUsed),
      prompt: (s) => ({ min: 0, max: 0, body: msg('philosopherChoose'), pickCharacter: true, optionalCharacter: true, characterPool: goodChars(s) }),
      apply: (s, self, _targets, _slot, character) => {
        if (!character) return;
        const def = CHARACTERS[character];
        if (!def || isEvilTeam(def.team)) throw new GameError('Choose a good character');
        self.flags.philosopherUsed = true;
        if (!abilityWorks(s, self)) return;
        for (const p of s.players) if (p.character === character) addDrunk(s, p, self, 'philosopher', null, { needsSourceWorking: true, needsSourceAlive: true, needsTargetChar: character });
        self.character = character; self.perceived = character; self.alignment = alignmentOfCharacter(character);
        self.flags = {};
        record(s, 'promotion', { player: self.id, reason: 'philosopher' });
        appendLog(s, self.id, msg('philosopherGained', { role: character }));
      },
    } } },
  { id: 'artist', name: 'Artist', team: 'townsfolk', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 0,
    ability: 'Once per game, during the day, privately ask the Storyteller any yes/no question.',
    hooks: { day: {
      offeredTo: 'alive', private: true, targets: 0, statement: true,
      use: (s, self, _targets, payload) => {
        const stmt = parseStatement(s, payload.statement);
        const ctx = { asker: self.id, slot: `artist-d${s.day}` };
        const truth = evalStatement(s, stmt, ctx);
        const q = statementForMessage(s, stmt);
        appendLog(s, self.id, msg('artistAnswer', { question: q, truth: truth ? 1 : 0 }));
        record(s, 'statement', { by: self.id, character: 'artist', question: q, truth });
      },
    } } },
  { id: 'juggler', name: 'Juggler', team: 'townsfolk', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 610,
    ability: "On your 1st day, publicly guess up to 5 players' characters. That night, you learn how many you got correct.",
    hooks: {
      day: {
        offeredTo: 'alive', targets: 0, statement: true, onlyDay: 1,
        use: (s, self, _targets, payload) => {
          const guesses = parseGuesses(s, payload.guesses);
          self.flags.jugglerGuesses = guesses;
          s.publicLog.push(msg('jugglerGuesses', {
            name: self.name,
            names: guesses.map((g) => byId(s, g.p).name),
            roles: guesses.map((g) => g.v),
          }));
          record(s, 'statement', { by: self.id, character: 'juggler', guesses });
        },
      },
      night: { info: (s, self, slot) => {
        const guesses = (self.flags.jugglerGuesses as { p: string; v: string }[] | undefined) ?? [];
        let count = guesses.filter((g) => byId(s, g.p).character === g.v).length;
        if (infoUnreliable(s, self)) count = Math.floor(roll(s, slot, self.id, 'fake') * (guesses.length + 1));
        return msg('jugglerInfo', { count });
      } },
    } },
  { id: 'sage', name: 'Sage', team: 'townsfolk', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 420,
    ability: 'If the Demon kills you, you learn that it is 1 of 2 players.',
    hooks: { night: {
      wakesWhenDead: true,
      actors: (s) => s.players.filter((p) => !p.alive && s.deathsTonight.includes(p.id) && p.perceived === 'sage' && s.data.deathCause?.[p.id] === 'demon'),
      info: (s, self, slot) => {
        const living = s.players.filter((p) => p.alive && p.id !== self.id);
        const demon = living.find(isDemon);
        const nonDemon = living.filter((p) => p.id !== demon?.id);
        const pair = !infoUnreliable(s, self) && demon
          ? (choose(s, [0, 1], slot, self.id, 'order') === 0 ? [demon, choose(s, nonDemon, slot, self.id, 'other')] : [choose(s, nonDemon, slot, self.id, 'other'), demon])
          : (nonDemon.length >= 2 ? nonDemon : living).slice(0, 2);
        return msg('sageInfo', { a: pair[0]?.name ?? '', b: pair[1]?.name ?? '' });
      },
    } } },

  // ------------------------------------------------------------------------------------ Outsiders
  { id: 'mutant', name: 'Mutant', team: 'outsider', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 0,
    ability: 'If you are "mad" about being an Outsider, you might be executed.',
    hooks: { day: {
      // A public claim to be the Mutant: the real Mutant is "mad about being an Outsider" and is executed.
      offeredTo: 'alive', targets: 0,
      use: (s, self) => {
        s.publicLog.push(msg('mutantClaims', { name: self.name }));
        record(s, 'claim', { by: self.id, character: 'mutant', real: self.character === 'mutant' });
        if (self.character === 'mutant' && abilityWorks(s, self)) executePlayer(s, self.id, 'madness');
      },
    } } },
  { id: 'sweetheart', name: 'Sweetheart', team: 'outsider', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 0,
    ability: 'When you die, 1 player is drunk from now on.',
    hooks: { onDeath: (s, owner) => {
      const pool = s.players.filter((p) => p.alive && p.id !== owner.id);
      if (pool.length) addDrunk(s, choose(s, pool, 'sweetheart', owner.id), owner, 'sweetheart', null);
    } } },
  { id: 'barber', name: 'Barber', team: 'outsider', shape: 'choose', edition: 'sv', firstNight: 0, otherNight: 400,
    ability: 'If you died today or tonight, the Demon may choose 2 players (not another Demon) to swap characters.',
    hooks: { night: {
      actors: (s) => {
        const barber = s.players.find((p) => p.character === 'barber');
        const died = !!barber && ((s.data.diedToday ?? []).includes(barber.id) || s.deathsTonight.includes(barber.id));
        return died ? s.players.filter((p) => p.alive && isDemon(p)) : [];
      },
      prompt: () => ({ min: 2, max: 2, body: msg('barberChoose'), eligible: (_s, _self, t) => !isDemon(t) }),
      apply: (s, _self, targets) => {
        const [a, b] = targets.map((id) => byId(s, id));
        const ca = a.character;
        const cb = b.character;
        a.character = cb; a.perceived = cb;
        b.character = ca; b.perceived = ca;
        record(s, 'swap', { a: a.id, b: b.id });
      },
    } } },
  { id: 'klutz', name: 'Klutz', team: 'outsider', shape: 'info', edition: 'sv', firstNight: 0, otherNight: 0,
    ability: 'When you learn that you died, publicly choose 1 alive player: if they are evil, your team loses.',
    hooks: {
      onDeath: (_s, owner) => { owner.flags.klutzPending = true; },
      day: {
        offeredTo: 'dead', targets: 1,
        use: (s, self, targets) => {
          const target = byId(s, targets[0]);
          if (!target.alive) throw new GameError('Choose a living player');
          const real = self.character === 'klutz' && !!self.flags.klutzPending;
          s.publicLog.push(msg('klutzChooses', { name: self.name, target: target.name }));
          record(s, 'claim', { by: self.id, character: 'klutz', targets, real });
          if (!real) return;
          self.flags.klutzPending = false;
          if (isEvilTeam(teamOf(target))) setWinner(s, 'evil', msg('evilWinsKlutz', { name: self.name }));
        },
      },
    } },

  // ------------------------------------------------------------------------------------ Minions
  { id: 'eviltwin', name: 'Evil Twin', team: 'minion', shape: 'info', edition: 'sv', firstNight: 230, otherNight: 0,
    ability: "You & an opposing player know each other. If the good player is executed, evil wins. Good can't win if you both live.",
    hooks: {
      setup: { twinWith: 'good' },
      night: { info: (s, self) => {
        const twin = s.players.find((p) => p.id === self.flags.twinId);
        if (!twin) return msg('empty');
        appendLog(s, twin.id, msg('evilTwinInfo', { name: self.name, role: self.character }));
        return msg('evilTwinInfo', { name: twin.name, role: twin.character });
      } },
      onAnyDeath: (s, owner, dead, cause) => {
        if (!owner.alive || owner.flags.twinId !== dead.id) return;
        if (cause !== 'execution' && cause !== 'virgin') return;
        if (!abilityWorks(s, owner)) return;
        setWinner(s, 'evil', msg('evilWinsTwin'));
      },
      blocksGoodWin: (s, owner) => {
        if (!owner.alive) return false;
        const twin = s.players.find((p) => p.id === owner.flags.twinId);
        return !!twin && twin.alive;
      },
    } },
  { id: 'witch', name: 'Witch', team: 'minion', shape: 'choose', edition: 'sv', firstNight: 240, otherNight: 140,
    ability: 'Each night, choose a player: if they nominate tomorrow, they die. If just 3 players live, you lose this ability.',
    hooks: {
      night: {
        recordsChoice: true,
        prompt: () => ({ min: 1, max: 1, body: msg('witchChoose') }),
        apply: (s, self, targets) => {
          s.data.witchTarget = abilityWorks(s, self) && alivePlayers(s).length > 3 ? targets[0] : null;
        },
      },
      onNominate: (s, owner, nominator) => {
        if (s.data.witchTarget !== nominator.id) return;
        if (!abilityWorks(s, owner) || alivePlayers(s).length <= 3) return;
        s.data.witchTarget = null;
        record(s, 'witchCurse', { witch: owner.id, target: nominator.id });
        abilityKill(s, owner, nominator, 'witch');
      },
    } },
  { id: 'cerenovus', name: 'Cerenovus', team: 'minion', shape: 'choose', edition: 'sv', firstNight: 250, otherNight: 150,
    ability: 'Each night, choose a player & a good character: they are "mad" they are this character tomorrow, or might be executed.',
    hooks: {
      night: {
        recordsChoice: true,
        prompt: (s) => ({ min: 1, max: 1, body: msg('cerenovusChoose'), pickCharacter: true, characterPool: goodChars(s) }),
        apply: (s, self, targets, _slot, character) => {
          if (!character || !abilityWorks(s, self)) return;
          const target = byId(s, targets[0]);
          s.data.mad = { player: target.id, character, by: self.id };
          s.data.madClaimed = false;
          appendLog(s, target.id, msg('cerenovusMad', { role: character }));
          record(s, 'madness', { player: target.id, character });
        },
      },
      day: {
        offeredTo: 'alive', targets: 0,
        available: (s, self) => s.data.mad?.player === self.id,
        use: (s, self) => {
          const mad = s.data.mad;
          if (!mad || mad.player !== self.id) return;
          s.data.madClaimed = true;
          s.publicLog.push(msg('madClaims', { name: self.name, role: mad.character }));
          record(s, 'claim', { by: self.id, character: mad.character, real: true });
        },
      },
      beforeDayEnd: (s, owner) => {
        const mad = s.data.mad;
        if (!mad || mad.by !== owner.id || !abilityWorks(s, owner) || s.data.madClaimed) return;
        s.data.mad = null;
        record(s, 'madnessExecuted', { player: mad.player, character: mad.character });
        return mad.player;
      },
    } },
  { id: 'pithag', name: 'Pit-Hag', team: 'minion', shape: 'choose', edition: 'sv', firstNight: 0, otherNight: 160,
    ability: 'Each night*, choose a player & a character they become (if not in play). If a Demon is made, deaths tonight are arbitrary.',
    hooks: { night: {
      recordsChoice: true,
      prompt: (s) => ({ min: 1, max: 1, body: msg('pithagChoose'), pickCharacter: true, characterPool: s.scriptChars.filter((c) => !s.players.some((p) => p.character === c)) }),
      apply: (s, self, targets, _slot, character) => {
        if (!character || !abilityWorks(s, self)) return;
        const target = byId(s, targets[0]);
        // The Pit-Hag changes the character, not the alignment (a good player can become a good Demon).
        target.character = character; target.perceived = character;
        target.flags = {};
        record(s, 'promotion', { player: target.id, reason: 'pitHag' });
        appendLog(s, target.id, msg('pithagBecame', { role: character }));
        if (CHARACTERS[character].team === 'demon') s.data.arbitraryDeaths = true;
        evaluateWin(s);
      },
    } } },

  // ------------------------------------------------------------------------------------ Demons
  { id: 'fanggu', name: 'Fang Gu', team: 'demon', shape: 'choose', edition: 'sv', firstNight: 0, otherNight: 290,
    ability: 'Each night*, choose a player: they die. The 1st Outsider this kills becomes an evil Fang Gu & you die instead. [+1 Outsider]',
    hooks: {
      setup: { outsiderDelta: 1 },
      night: {
        prompt: demonChoosePrompt,
        apply: (s, self, targets) => {
          if (!abilityWorks(s, self)) { demonAttack(s, self, targets[0]); return; }
          const target = byId(s, targets[0]);
          if (teamOf(target) === 'outsider' && !self.flags.fangguJumped) {
            self.flags.fangguJumped = true;
            target.character = 'fanggu'; target.perceived = 'fanggu'; target.alignment = 'evil'; target.flags = {};
            record(s, 'promotion', { player: target.id, reason: 'fangGu' });
            appendLog(s, target.id, msg('fangGuBecame'));
            markDead(s, self, 'fangGuJump');
            evaluateWin(s);
            return;
          }
          demonAttack(s, self, targets[0]);
        },
      },
    } },
  { id: 'vigormortis', name: 'Vigormortis', team: 'demon', shape: 'choose', edition: 'sv', firstNight: 0, otherNight: 320,
    ability: 'Each night*, choose a player: they die. Minions you kill keep their ability & poison 1 Townsfolk neighbour. [-1 Outsider]',
    hooks: {
      setup: { outsiderDelta: -1 },
      night: {
        prompt: demonChoosePrompt,
        apply: (s, self, targets) => {
          const target = byId(s, targets[0]);
          const wasMinion = teamOf(target) === 'minion';
          demonAttack(s, self, targets[0]);
          if (!wasMinion || target.alive || !abilityWorks(s, self)) return;
          target.flags.keepsAbility = true;
          const neighbor = nearestTownsfolkNeighbors(s, target)[0];
          if (neighbor) addPoison(s, neighbor, self, 'vigormortis', null, { needsSourceAlive: true });
        },
      },
    } },
  { id: 'nodashii', name: 'No Dashii', team: 'demon', shape: 'choose', edition: 'sv', firstNight: 0, otherNight: 300,
    ability: 'Each night*, choose a player: they die. Your 2 Townsfolk neighbours are poisoned.',
    hooks: { night: {
      before: (s) => {
        removeEffects(s, { sourceChar: 'nodashii' });
        for (const d of s.players.filter((p) => p.alive && p.character === 'nodashii' && abilityWorks(s, p))) {
          for (const t of nearestTownsfolkNeighbors(s, d)) addPoison(s, t, d, 'nodashii', null, { needsSourceAlive: true });
        }
      },
      prompt: demonChoosePrompt,
      apply: (s, self, targets) => demonAttack(s, self, targets[0]),
    } } },
  { id: 'vortox', name: 'Vortox', team: 'demon', shape: 'choose', edition: 'sv', firstNight: 0, otherNight: 310,
    ability: 'Each night*, choose a player: they die. Townsfolk abilities yield false info. Each day, if no-one is executed, evil wins.',
    hooks: {
      falsifiesTownsfolkInfo: true,
      night: {
        prompt: demonChoosePrompt,
        apply: (s, self, targets) => demonAttack(s, self, targets[0]),
      },
      endOfDayWin: (s, _owner, executedId) => {
        if (executedId !== null) return false;
        setWinner(s, 'evil', msg('evilWinsVortox'));
        return true;
      },
    } },
];


