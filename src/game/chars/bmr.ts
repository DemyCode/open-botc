// Bad Moon Rising.
import { CHARACTERS } from '../characters.js';
import { abilityKill, demonAttack, hooksOf, isExecution, notifyChosen, tryKill } from '../deaths.js';
import { msg } from '../messages.js';
import { addDrunk, addPoison } from '../effects.js';
import { record } from '../history.js';
import { infoIsFalse, infoUnreliable, livingNeighbors, upTo, wrongAnswer } from '../info.js';
import { appendLog } from '../log.js';
import { abilityWorks } from '../registration.js';
import { evaluateWin } from '../win.js';
import { statementForMessage, evalStatement, parseStatement } from '../statements.js';
import type { CharacterDef } from '../hooks.js';
import type { GameState, PlayerState } from '../types.js';
import { GameError } from '../types.js';
import { giveResult } from './tb.js';
import { alivePlayers, byId, choose, demonChoosePrompt, isDemon, isGood, resurrect, roll, setAlignment, teamOf } from './util.js';

const never = () => [] as PlayerState[];

/** Resolves what the Pukka poisoned last night: they die now (unless something protects them). */
function pukkaResolvePrevious(s: GameState, pukka: PlayerState): void {
  const victimId = pukka.flags.pukkaVictim as string | undefined;
  if (!victimId || !abilityWorks(s, pukka)) return;
  pukka.flags.pukkaVictim = undefined;
  demonAttack(s, pukka, victimId);
  // "The previously poisoned player dies then becomes healthy": one who dies is still poisoned at their time
  // of death (a Sage or Ravenkeeper killed by the Pukka is told unreliable information), and healthy again by
  // dawn; one who survives (protected) is healthy at once.
  const victim = s.players.find((p) => p.id === victimId);
  const died = !!victim && (!victim.alive || !!victim.flags.hiddenAlive);
  const mine = (e: { source: string | null; sourceChar: string }) => e.source === pukka.id && e.sourceChar === 'pukka';
  if (died) {
    for (const e of s.effects) if (mine(e)) e.untilDawn = true;
  } else {
    s.effects = s.effects.filter((e) => !mine(e));
  }
}

export const BMR: CharacterDef[] = [
  // ------------------------------------------------------------------------------------ Townsfolk
  // (She only wakes on the first night: her grief on later nights is the onAnyDeath hook, not a wake.)
  { id: 'grandmother', name: 'Grandmother', team: 'townsfolk', shape: 'info', edition: 'bmr', firstNight: 400, otherNight: 0,
    ability: 'You start knowing a good player & their character. If the Demon kills them, you die too.',
    hooks: {
      night: { info: (s, self, slot) => {
        const good = s.players.filter((p) => p.id !== self.id && isGood(p));
        const pool = good.length ? good : s.players.filter((p) => p.id !== self.id);
        const child = choose(s, pool, slot, self.id, 'grandchild');
        self.flags.grandchildId = child.id;
        if (!infoUnreliable(s, self)) return msg('grandmotherInfo', { name: child.name, role: child.character });
        // A drunk or poisoned Grandmother may be told a false character; under a Vortox it is always a wrong one.
        const goodRoles = s.scriptChars.filter((c) => CHARACTERS[c].team === 'townsfolk' || CHARACTERS[c].team === 'outsider');
        const fake = infoIsFalse(s, self) ? wrongAnswer(s, self, child.character, goodRoles, child.character, slot) : choose(s, goodRoles, slot, self.id, 'fake');
        return msg('grandmotherInfo', { name: child.name, role: fake });
      } },
      onAnyDeath: (s, owner, dead, cause) => {
        if (cause === 'demon' && owner.flags.grandchildId === dead.id && abilityWorks(s, owner)) {
          record(s, 'grief', { grandmother: owner.id, grandchild: dead.id });
          tryKill(s, owner, 'grandmother');
          evaluateWin(s);
        }
      },
    } },
  { id: 'sailor', name: 'Sailor', team: 'townsfolk', shape: 'choose', edition: 'bmr', firstNight: 110, otherNight: 40,
    ability: "Each night, choose an alive player: either you or they are drunk until dusk. You can't die.",
    hooks: {
      night: {
        recordsChoice: true,
        prompt: () => ({ min: 1, max: 1, body: msg('sailorChoose'), eligible: (_s, _self, t) => t.alive }),
        apply: (s, self, targets) => {
          if (!abilityWorks(s, self)) return;
          const target = byId(s, targets[0]);
          // "If they choose a Townsfolk, the Storyteller will usually make the Townsfolk drunk; otherwise the Sailor."
          const drunk = target.id !== self.id && teamOf(target) === 'townsfolk' ? target : self;
          addDrunk(s, drunk, self, 'sailor', s.night);
        },
      },
      protects: (s, owner, victim) => (owner.id === victim.id && abilityWorks(s, owner) ? 'sailor' : null),
    } },
  { id: 'chambermaid', name: 'Chambermaid', team: 'townsfolk', shape: 'choose', edition: 'bmr', firstNight: 510, otherNight: 700,
    ability: 'Each night, choose 2 alive players (not yourself): you learn how many woke tonight due to their ability.',
    hooks: { night: {
      recordsChoice: true, result: true, notSelf: true,
      actors: (s) => (alivePlayers(s).length >= 3 ? s.players.filter((p) => p.alive && p.perceived === 'chambermaid') : []),
      prompt: () => ({ min: 2, max: 2, body: msg('chambermaidChoose'), eligible: (_s, self, t) => t.alive && t.id !== self.id }),
      apply: (s, self, targets, slot) => {
        const woke: string[] = s.data.woke ?? [];
        const real = targets.filter((id) => woke.includes(id)).length;
        const count = infoIsFalse(s, self) ? wrongAnswer(s, self, real, upTo(2), real + 1, slot)
          : !infoUnreliable(s, self) ? real : Math.floor(roll(s, slot, self.id, 'fake') * 3);
        giveResult(s, self, msg('chambermaidInfo', { count }), 'chambermaid');
      },
    } } },
  { id: 'exorcist', name: 'Exorcist', team: 'townsfolk', shape: 'choose', edition: 'bmr', firstNight: 0, otherNight: 210,
    ability: "Each night*, choose a player (different to last night): the Demon, if chosen, learns who you are then doesn't wake tonight.",
    hooks: { night: {
      recordsChoice: true,
      prompt: () => ({ min: 1, max: 1, body: msg('exorcistChoose'), eligible: (_s, self, t) => t.id !== self.flags.exLast }),
      apply: (s, self, targets) => {
        self.flags.exLast = targets[0];
        if (!abilityWorks(s, self)) return;
        const target = byId(s, targets[0]);
        if (!isDemon(target)) return;
        (s.data.exorcised ??= []).push(target.id);
        appendLog(s, target.id, msg('exorcisedInfo', { name: self.name }));
        record(s, 'exorcised', { exorcist: self.id, demon: target.id });
      },
    } } },
  { id: 'innkeeper', name: 'Innkeeper', team: 'townsfolk', shape: 'choose', edition: 'bmr', firstNight: 0, otherNight: 90,
    ability: "Each night*, choose 2 players: they can't die tonight, but 1 is drunk until dusk.",
    hooks: {
      night: {
        recordsChoice: true,
        prompt: () => ({ min: 2, max: 2, body: msg('innkeeperChoose') }),
        apply: (s, self, targets) => {
          if (!abilityWorks(s, self)) return;
          const chosen = targets.map((id) => byId(s, id));
          (s.data.safe ??= []).push(...targets);
          // One of them is drunk: usually a good player.
          const good = chosen.filter(isGood);
          addDrunk(s, choose(s, good.length ? good : chosen, 'innkeeper', s.night, self.id), self, 'innkeeper', s.night);
        },
      },
      protects: (s, owner, victim) => (s.phase === 'night' && (s.data.safe ?? []).includes(victim.id) && abilityWorks(s, owner) ? 'innkeeper' : null),
    } },
  { id: 'gambler', name: 'Gambler', team: 'townsfolk', shape: 'choose', edition: 'bmr', firstNight: 0, otherNight: 100,
    ability: 'Each night*, choose a player & guess their character: if you guess wrong, you die.',
    hooks: { night: {
      recordsChoice: true,
      prompt: () => ({ min: 1, max: 1, body: msg('gamblerChoose'), pickCharacter: true }),
      apply: (s, self, targets, _slot, character) => {
        if (!abilityWorks(s, self)) return;
        if (byId(s, targets[0]).character !== character) { tryKill(s, self, 'gambler'); evaluateWin(s); }
      },
    } } },
  { id: 'gossip', name: 'Gossip', team: 'townsfolk', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 380,
    ability: 'Each day, you may make a public statement. Tonight, if it was true, a player dies.',
    hooks: {
      day: {
        offeredTo: 'alive', targets: 0, statement: true,
        use: (s, self, _targets, payload) => {
          const stmt = parseStatement(s, payload.statement);
          const ctx = { asker: self.id, slot: `gossip-d${s.day}` };
          const real = self.character === 'gossip';
          const truth = evalStatement(s, stmt, ctx);
          s.publicLog.push(msg('gossipSays', { name: self.name, stmt: statementForMessage(s, stmt) }));
          record(s, 'statement', { by: self.id, character: 'gossip', stmt: statementForMessage(s, stmt), real, truth });
          if (real && truth) (s.data.gossipTrue ??= []).push(self.id);
        },
      },
      night: {
        actors: never,
        // "If the Gossip made a true statement today, a player dies tonight" — chosen by the Storyteller
        // among those who will really die (not a protected one).
        before: (s) => {
          const ids: string[] = s.data.gossipTrue ?? [];
          s.data.gossipTrue = [];
          for (const id of ids) {
            const gossip = byId(s, id);
            if (!gossip.alive || !abilityWorks(s, gossip)) continue;
            const targets = s.players.filter((p) => p.alive && p.id !== gossip.id);
            const notProtected = targets.filter((p) => !isSafe(s, p));
            const pool = notProtected.length ? notProtected : targets;
            if (pool.length) abilityKill(s, gossip, choose(s, pool, 'gossip', s.night, gossip.id), 'gossip');
          }
        },
      },
    } },
  { id: 'courtier', name: 'Courtier', team: 'townsfolk', shape: 'choose', edition: 'bmr', firstNight: 190, otherNight: 80,
    ability: 'Once per game, at night, choose a character: they are drunk for 3 nights & 3 days.',
    hooks: { night: {
      recordsChoice: true,
      actors: (s) => s.players.filter((p) => p.alive && p.perceived === 'courtier' && !p.flags.courtierUsed),
      prompt: () => ({ min: 0, max: 0, body: msg('courtierChoose'), pickCharacter: true, optionalCharacter: true }),
      apply: (s, self, _t, _slot, character) => {
        if (!character) return;
        self.flags.courtierUsed = true;
        if (!abilityWorks(s, self)) return;
        const inPlay = s.players.filter((p) => p.character === character);
        const target = inPlay.find((p) => p.alive) ?? inPlay[0];
        if (target) {
          addDrunk(s, target, self, 'courtier', s.night + 2, { needsSourceWorking: true, needsTargetChar: character });
          // Choosing a character is choosing its player for "the 1st player to choose you" (the Goon).
          notifyChosen(s, self, target.id, 'courtier');
        }
      },
    } } },
  { id: 'professor', name: 'Professor', team: 'townsfolk', shape: 'choose', edition: 'bmr', firstNight: 0, otherNight: 430,
    ability: 'Once per game, at night*, choose a dead player: if they are a Townsfolk, they are resurrected.',
    hooks: { night: {
      recordsChoice: true,
      actors: (s) => s.players.filter((p) => p.alive && p.perceived === 'professor' && !p.flags.professorUsed),
      prompt: () => ({ min: 0, max: 1, body: msg('professorChoose'), eligible: (_s, _self, t) => !t.alive && !t.flags.hiddenAlive }),
      apply: (s, self, targets) => {
        if (!targets.length) return;
        self.flags.professorUsed = true;
        if (!abilityWorks(s, self)) return;
        const target = byId(s, targets[0]);
        if (!target.alive && teamOf(target) === 'townsfolk') resurrect(s, target, 'professor');
      },
    } } },
  { id: 'minstrel', name: 'Minstrel', team: 'townsfolk', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 0,
    ability: 'When a Minion dies by execution, all other players (except Travellers) are drunk until dusk tomorrow.',
    hooks: { onAnyDeath: (s, owner, dead, cause) => {
      if (!isExecution(cause) || teamOf(dead) !== 'minion' || !abilityWorks(s, owner)) return;
      for (const p of s.players) if (p.id !== owner.id) addDrunk(s, p, owner, 'minstrel', s.night + 1);
    } } },
  { id: 'tealady', name: 'Tea Lady', team: 'townsfolk', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 0,
    ability: "If both your alive neighbours are good, they can't die.",
    hooks: { protects: (s, owner, victim) => {
      if (!owner.alive || !abilityWorks(s, owner)) return null;
      const [a, b] = livingNeighbors(s, owner);
      return a.id !== b.id && isGood(a) && isGood(b) && (victim.id === a.id || victim.id === b.id) ? 'tealady' : null;
    } } },
  { id: 'pacifist', name: 'Pacifist', team: 'townsfolk', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 0,
    ability: 'Executed good players might not die.',
    hooks: { lastResort: (s, owner, victim, cause) => {
      if (!isExecution(cause) || !isGood(victim) || !abilityWorks(s, owner) || owner.flags.pacifistUsed) return null;
      // The Storyteller chooses, and "once per game is usually about right".
      owner.flags.pacifistUsed = true;
      return 'pacifist';
    } } },
  { id: 'fool', name: 'Fool', team: 'townsfolk', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 0,
    ability: "The 1st time you die, you don't.",
    hooks: { lastResort: (s, owner, victim) => {
      if (owner.id !== victim.id || owner.flags.foolUsed || !abilityWorks(s, owner)) return null;
      owner.flags.foolUsed = true;
      return 'fool';
    } } },

  // ------------------------------------------------------------------------------------ Outsiders
  { id: 'goon', name: 'Goon', team: 'outsider', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 0,
    ability: 'Each night, the 1st player to choose you with their ability is drunk until dusk. You become their alignment.',
    hooks: { onChosen: (s, owner, chooser) => {
      if (s.data.goonUsed || chooser.id === owner.id || !owner.alive) return;
      if (!abilityWorks(s, owner)) return;
      s.data.goonUsed = true;
      addDrunk(s, chooser, owner, 'goon', s.night);
      const before = owner.alignment;
      setAlignment(s, owner, chooser.alignment, 'goon');
      if (before !== owner.alignment) appendLog(s, owner.id, owner.alignment === 'evil' ? msg('goonEvil') : msg('goonGood'));
    } } },
  { id: 'lunatic', name: 'Lunatic', team: 'outsider', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 0,
    ability: 'You think you are a Demon, but you are not. The Demon knows who you are & who you choose at night.',
    hooks: {
      noAbility: 'lunatic', setup: { thinksTheyAre: 'demon' },
      // The real Demon is told what the Lunatic chose.
      onOwnNightAction: (s, owner, _step, targets) => {
        if (!targets.length) return;
        for (const d of s.players.filter((p) => p.alive && isDemon(p))) {
          appendLog(s, d.id, msg('lunaticChose', { name: owner.name, names: targets.map((id) => byId(s, id).name) }));
        }
        record(s, 'lunaticChoice', { lunatic: owner.id, targets });
      },
    } },
  { id: 'tinker', name: 'Tinker', team: 'outsider', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 490,
    ability: 'You might die at any time.',
    hooks: { night: {
      actors: never,
      // The Storyteller may kill the Tinker at any time — never when it would end the game.
      before: (s) => {
        for (const p of s.players.filter((q) => q.alive && q.character === 'tinker')) {
          if (!abilityWorks(s, p) || alivePlayers(s).length <= 3) continue;
          if (roll(s, 'tinker', s.night, p.id) < 0.25) {
            record(s, 'tinker', { player: p.id });
            tryKill(s, p, 'tinker');
            evaluateWin(s);
          }
        }
      },
    } } },
  { id: 'moonchild', name: 'Moonchild', team: 'outsider', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 500,
    ability: 'When you learn that you died, publicly choose 1 alive player. Tonight, if it was a good player, they die.',
    hooks: {
      onDeath: (_s, owner) => { owner.flags.moonchildPending = true; },
      day: {
        offeredTo: 'dead', targets: 1,
        use: (s, self, targets) => {
          const target = byId(s, targets[0]);
          if (!target.alive) throw new GameError('Choose a living player');
          const real = self.character === 'moonchild' && !!self.flags.moonchildPending;
          s.publicLog.push(msg('moonchildChooses', { name: self.name, target: target.name }));
          record(s, 'claim', { by: self.id, character: 'moonchild', targets, real });
          if (!real) return;
          self.flags.moonchildPending = false;
          if (isGood(target)) (s.data.moonchildKills ??= []).push({ moonchild: self.id, target: target.id });
        },
      },
      night: {
        actors: never,
        before: (s) => {
          const kills: { moonchild: string; target: string }[] = s.data.moonchildKills ?? [];
          s.data.moonchildKills = [];
          for (const k of kills) {
            const source = byId(s, k.moonchild);
            // Sober and healthy at night is what counts, even if the choice was made drunk.
            if (abilityWorks(s, source)) abilityKill(s, source, byId(s, k.target), 'moonchild');
          }
        },
      },
    } },

  // ------------------------------------------------------------------------------------ Minions
  { id: 'godfather', name: 'Godfather', team: 'minion', shape: 'choose', edition: 'bmr', firstNight: 210, otherNight: 370,
    ability: 'You start knowing which Outsiders are in play. If 1 died today, choose a player tonight: they die. [-1 or +1 Outsider]',
    hooks: {
      setup: { outsiderDelta: 'randomPlusMinusOne' },
      night: {
        recordsChoice: true,
        shape: (s) => (s.night === 1 ? 'info' : 'choose'),
        actors: (s) => {
          const gf = s.players.filter((p) => p.alive && p.perceived === 'godfather');
          if (s.night === 1) return gf;
          // "Whenever an Outsider is executed and dies" — an Outsider who died another way (the Witch's curse) does not count.
          const executed = (id: string) => isExecution(s.data.deathCause?.[id] ?? '');
          const died: string[] = s.data.diedToday ?? [];
          return died.some((id) => teamOf(byId(s, id)) === 'outsider' && executed(id)) ? gf : [];
        },
        info: (s) => {
          const outs = s.players.filter((p) => teamOf(p) === 'outsider').map((p) => p.character);
          return outs.length ? msg('godfatherInfo', { roles: outs }) : msg('godfatherNone');
        },
        prompt: () => ({ min: 1, max: 1, body: msg('godfatherChoose') }),
        apply: (s, self, targets) => { if (abilityWorks(s, self)) abilityKill(s, self, byId(s, targets[0]), 'godfather'); },
        abilityWake: (s) => s.night > 1,
      },
    } },
  { id: 'devilsadvocate', name: "Devil's Advocate", team: 'minion', shape: 'choose', edition: 'bmr', firstNight: 220, otherNight: 130,
    ability: "Each night, choose a living player (different to last night): if executed tomorrow, they don't die.",
    hooks: {
      night: {
        recordsChoice: true,
        prompt: () => ({ min: 1, max: 1, body: msg('advocateChoose'), eligible: (_s, self, t) => t.alive && t.id !== self.flags.daLast }),
        apply: (s, self, targets) => {
          self.flags.daLast = targets[0];
          if (abilityWorks(s, self)) s.data.daProtected = targets[0];
        },
      },
      protects: (s, owner, victim, cause) => (isExecution(cause) && s.data.daProtected === victim.id && abilityWorks(s, owner) ? 'devilsadvocate' : null),
    } },
  { id: 'assassin', name: 'Assassin', team: 'minion', shape: 'choose', edition: 'bmr', firstNight: 0, otherNight: 360,
    ability: 'Once per game, at night*, choose a player: they die, even if for some reason they could not.',
    hooks: { night: {
      recordsChoice: true,
      actors: (s) => s.players.filter((p) => p.alive && p.perceived === 'assassin' && !p.flags.assassinUsed),
      prompt: () => ({ min: 0, max: 1, body: msg('assassinChoose') }),
      apply: (s, self, targets) => {
        if (!targets.length) return;
        self.flags.assassinUsed = true;
        if (abilityWorks(s, self)) abilityKill(s, self, byId(s, targets[0]), 'assassin', { bypass: true });
      },
    } } },
  { id: 'mastermind', name: 'Mastermind', team: 'minion', shape: 'info', edition: 'bmr', firstNight: 0, otherNight: 0,
    ability: 'If the Demon dies by execution (ending the game), play for 1 more day. If a player is then executed, their team loses.',
    hooks: { delaysGoodWin: (s, owner) => abilityWorks(s, owner) } },

  // ------------------------------------------------------------------------------------ Demons
  { id: 'zombuul', name: 'Zombuul', team: 'demon', shape: 'choose', edition: 'bmr', firstNight: 0, otherNight: 250,
    ability: "Each night*, if no-one died today, choose a player: they die. The 1st time you die, you live but register as dead.",
    hooks: {
      night: {
        actors: (s) => ((s.data.diedToday ?? []).length ? [] : s.players.filter((p) => (p.alive || p.flags.hiddenAlive) && p.perceived === 'zombuul')),
        prompt: demonChoosePrompt,
        apply: (s, self, targets) => demonAttack(s, self, targets[0]),
      },
      lastResort: (s, owner, victim) => {
        if (owner.id !== victim.id || owner.flags.zombuulUsed || !abilityWorks(s, owner)) return null;
        owner.flags.zombuulUsed = true;
        return { by: 'zombuul', appearsDead: true };
      },
    } },
  { id: 'pukka', name: 'Pukka', team: 'demon', shape: 'choose', edition: 'bmr', firstNight: 280, otherNight: 260,
    ability: 'Each night, choose a player: they are poisoned. The previously poisoned player dies then becomes healthy.',
    // (No ownDemonInfo: the Pukka's own step is a "choose" one, so its Minions and bluffs come from the shared Demon-info step.)
    hooks: { night: {
      before: (s) => {
        // An exorcised Pukka doesn't wake, but last night's victim still dies.
        for (const p of s.players.filter((q) => q.alive && q.character === 'pukka' && (s.data.exorcised ?? []).includes(q.id))) pukkaResolvePrevious(s, p);
      },
      // The Pukka never poisons itself: that would switch off its own ability forever (it is its
      // own poison's source) and the game could never resolve the previous victim.
      prompt: () => ({ min: 1, max: 1, body: msg('pukkaChoose'), eligible: (_s, self, t) => t.id !== self.id }),
      apply: (s, self, targets) => {
        pukkaResolvePrevious(s, self);
        if (s.winner || !abilityWorks(s, self)) return;
        self.flags.pukkaVictim = targets[0];
        addPoison(s, byId(s, targets[0]), self, 'pukka', null, { needsSourceAlive: true });
      },
    } } },
  { id: 'shabaloth', name: 'Shabaloth', team: 'demon', shape: 'choose', edition: 'bmr', firstNight: 0, otherNight: 270,
    ability: 'Each night*, choose 2 players: they die. A dead player you chose last night might be regurgitated.',
    hooks: { night: {
      before: (s) => {
        // "Just before waking the Shabaloth": the Storyteller may bring one of last night's victims back — rarely.
        for (const p of s.players.filter((q) => q.alive && q.character === 'shabaloth' && abilityWorks(s, q))) {
          const ate = ((p.flags.shabAte as string[] | undefined) ?? []).map((id) => byId(s, id)).filter((v) => !v.alive && !v.flags.hiddenAlive);
          p.flags.shabAte = [];
          if (!ate.length || (p.flags.shabBack as number | undefined ?? 0) >= 2 || roll(s, 'shabaloth', s.night, p.id) >= 0.3) continue;
          p.flags.shabBack = ((p.flags.shabBack as number | undefined) ?? 0) + 1;
          resurrect(s, choose(s, ate, 'shabaloth-back', s.night, p.id), 'shabaloth');
        }
      },
      prompt: () => ({ min: 2, max: 2, body: msg('shabalothChoose') }),
      sequentialTargets: true,
      apply: (s, self, targets) => {
        self.flags.shabAte = targets;
        for (const id of targets) { notifyChosen(s, self, id, 'shabaloth'); demonAttack(s, self, id); }
      },
    } } },
  { id: 'po', name: 'Po', team: 'demon', shape: 'choose', edition: 'bmr', firstNight: 0, otherNight: 280,
    ability: 'Each night*, you may choose a player: they die. If your last choice was no-one, choose 3 players tonight.',
    hooks: { night: {
      sequentialTargets: true,
      prompt: (_s, self) => (self.flags.poThree ? { min: 3, max: 3, body: msg('poChooseThree') } : { min: 0, max: 1, body: msg('poChoose') }),
      apply: (s, self, targets) => {
        // Choosing no-one charges the next night even while drunk (the wiki example): the kill
        // itself still needs a working ability, which demonAttack checks.
        if (!targets.length) { self.flags.poThree = true; return; }
        self.flags.poThree = false;
        for (const id of targets) { notifyChosen(s, self, id, 'po'); demonAttack(s, self, id); }
      },
    } } },
];

/** Whether an ability could not kill this player right now (used to steer the Storyteller's own kills). */
function isSafe(s: GameState, p: PlayerState): boolean {
  return s.players.some((o) => o.alive && hooksOf(o.character).protects?.(s, o, p, 'gossip'));
}

