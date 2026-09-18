// Trouble Brewing.
import { EVIL_INTRO_MIN_PLAYERS } from '../constants.js';
import { setWinner } from '../win.js';
import { appendLog } from '../log.js';
import { demonAttack, executePlayer, msg, protectionFor } from '../deaths.js';
import { record } from '../history.js';
import {
  chefInfo, demonInfo, empathInfo, fortuneTellerInfo, investigativeInfo,
  minionInfo, ravenkeeperInfo, spyInfo, undertakerInfo,
} from '../info.js';
import { abilityLostReason, abilityWorks, registersAs } from '../registration.js';
import type { CharacterDef } from '../hooks.js';
import type { GameState, Msg, PlayerState } from '../types.js';

/** Stores a choose-step's result so it shows right after answering, and in the log and replay. */
export function giveResult(state: GameState, self: PlayerState, text: Msg, step: string): void {
  appendLog(state, self.id, text);
  self.nightResult = text;
  record(state, 'info', { actor: self.id, character: self.perceived, step, msg: text, lost: abilityLostReason(state, self) });
}

const slotOf = (state: GameState, step: string) => `${step}-n${state.night}`;

export const TB: CharacterDef[] = [
  { id: 'washerwoman', name: 'Washerwoman', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 110, otherNight: 0,
    ability: 'You start knowing that 1 of 2 players is a particular Townsfolk.',
    hooks: { night: { info: (s, self, slot) => investigativeInfo(s, self, 'townsfolk', slot) } } },
  { id: 'librarian', name: 'Librarian', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 120, otherNight: 0,
    ability: 'You start knowing that 1 of 2 players is a particular Outsider (or that there are no Outsiders).',
    hooks: { night: { info: (s, self, slot) => investigativeInfo(s, self, 'outsider', slot) } } },
  { id: 'investigator', name: 'Investigator', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 130, otherNight: 0,
    ability: 'You start knowing that 1 of 2 players is a particular Minion.',
    hooks: { night: { info: (s, self, slot) => investigativeInfo(s, self, 'minion', slot) } } },
  { id: 'chef', name: 'Chef', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 140, otherNight: 0,
    ability: 'You start knowing how many pairs of evil players are sitting next to each other.',
    hooks: { night: { info: (s, self, slot) => chefInfo(s, self, slot) } } },
  { id: 'empath', name: 'Empath', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 160, otherNight: 160,
    ability: 'Each night, you learn how many of your 2 alive neighbours are evil.',
    hooks: { night: { info: (s, self, slot) => empathInfo(s, self, slot) } } },
  { id: 'fortuneteller', name: 'Fortune Teller', team: 'townsfolk', shape: 'choose', edition: 'tb', firstNight: 170, otherNight: 170,
    ability: 'Each night, choose 2 players: you learn if either is the Demon. There is a good player that registers as a Demon to you.',
    hooks: { night: {
      recordsChoice: true, result: true,
      prompt: () => ({ min: 2, max: 2, body: msg('fortuneTellerChoose') }),
      apply: (s, self, targets, slot) => giveResult(s, self, fortuneTellerInfo(s, self, targets, slot), 'fortuneteller'),
    } } },
  { id: 'undertaker', name: 'Undertaker', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 180,
    ability: 'Each night*, you learn which character died by execution today.',
    hooks: { night: {
      // "Each night except the first, if any player died by execution today, wake the Undertaker."
      actors: (s) => (s.lastExecutedId ? s.players.filter((p) => p.alive && p.perceived === 'undertaker') : []),
      info: (s, self, slot) => undertakerInfo(s, self, s.lastExecutedId ? s.players.find((p) => p.id === s.lastExecutedId) ?? null : null, slot),
    } } },
  { id: 'monk', name: 'Monk', team: 'townsfolk', shape: 'choose', edition: 'tb', firstNight: 0, otherNight: 90,
    ability: 'Each night*, choose a player (not yourself): they are safe from the Demon tonight.',
    hooks: {
      night: {
        recordsChoice: true, notSelf: true,
        prompt: () => ({ min: 1, max: 1, body: msg('monkChoose') }),
        apply: (s, self, targets) => { if (abilityWorks(s, self)) s.monkProtectedId = targets[0] ?? null; },
      },
      protects: (s, _owner, victim, cause) => (cause === 'demon' && s.monkProtectedId === victim.id ? 'monk' : null),
    } },
  { id: 'ravenkeeper', name: 'Ravenkeeper', team: 'townsfolk', shape: 'choose', edition: 'tb', firstNight: 0, otherNight: 120,
    ability: 'If you die at night, you are woken to choose a player: you learn their character.',
    hooks: { night: {
      recordsChoice: true, result: true,
      actors: (s) => s.players.filter((p) => !p.alive && s.deathsTonight.includes(p.id) && p.perceived === 'ravenkeeper'),
      prompt: () => ({ min: 1, max: 1, body: msg('ravenkeeperChoose') }),
      apply: (s, self, targets, slot) => giveResult(s, self, ravenkeeperInfo(s, self, targets[0], slot), 'ravenkeeper'),
    } } },
  { id: 'virgin', name: 'Virgin', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 0,
    ability: 'The first time you are nominated, if the nominator is a Townsfolk, they are executed immediately.',
    hooks: { onNominated: (s, owner, nominator) => {
      if (!owner.alive || owner.virginUsed) return;
      owner.virginUsed = true;
      const ctx = { asker: nominator.id, slot: `virgin-d${s.day}` };
      const lost = abilityLostReason(s, owner);
      const townsfolk = lost === null && registersAs(s, nominator, 'townsfolk', ctx);
      record(s, 'virgin', { virgin: owner.id, nominator: nominator.id, executed: townsfolk, reason: townsfolk ? null : (lost ?? 'notTownsfolk') });
      if (!townsfolk) return;
      s.publicLog.push(msg('virginExecutesNominator', { name: nominator.name }));
      // That's today's one execution: the day ends right here.
      executePlayer(s, nominator.id, 'virgin');
      return 'endsDay';
    } } },
  { id: 'slayer', name: 'Slayer', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 0,
    ability: 'Once per game, during the day, publicly choose a player: if they are the Demon, they die.' },
  { id: 'soldier', name: 'Soldier', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 0,
    ability: 'You are safe from the Demon.',
    hooks: { protects: (s, owner, victim, cause) => (cause === 'demon' && owner.id === victim.id && abilityWorks(s, owner) ? 'soldier' : null) } },
  { id: 'mayor', name: 'Mayor', team: 'townsfolk', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 0,
    ability: 'If only 3 players live and no execution happens, your team wins. If you die at night, another player might die instead.',
    hooks: {
      redirectsKill: (s, owner, victim, killer) => {
        if (!abilityWorks(s, owner)) return null;
        const alternatives = s.players.filter((p) => p.alive && p.id !== owner.id && p.id !== killer.id && !protectionFor(s, p, 'demon'));
        return alternatives.length ? alternatives[Math.floor(Math.random() * alternatives.length)] : owner;
      },
      endOfDayWin: (s, owner, executedId) => {
        if (executedId || !owner.alive || s.players.filter((p) => p.alive).length !== 3 || !abilityWorks(s, owner)) return false;
        setWinner(s, 'good', msg('goodWinsMayor'));
        return true;
      },
    } },
  { id: 'butler', name: 'Butler', team: 'outsider', shape: 'choose', edition: 'tb', firstNight: 220, otherNight: 150,
    ability: 'Each night, choose a player (not yourself): you may only vote when they do, tomorrow.',
    hooks: {
      night: {
        recordsChoice: true, notSelf: true,
        before: (s) => { s.butlerMasterId = null; },
        prompt: () => ({ min: 1, max: 1, body: msg('butlerChoose') }),
        apply: (s, self, targets) => { if (abilityWorks(s, self)) s.butlerMasterId = targets[0] ?? null; },
      },
      // A living Butler may only vote when their master does. (A dead Butler has no ability: unrestricted.)
      voteCounts: (s, voter, votes) => {
        if (!voter.alive || !abilityWorks(s, voter)) return true;
        return s.butlerMasterId ? (votes[s.butlerMasterId] ?? false) : false;
      },
    } },
  { id: 'drunk', name: 'Drunk', team: 'outsider', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 0,
    ability: 'You do not know you are the Drunk. You think you are a Townsfolk, but your ability malfunctions.',
    hooks: { noAbility: true, setup: { thinksTheyAre: 'townsfolk' } } },
  { id: 'recluse', name: 'Recluse', team: 'outsider', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 0,
    ability: 'You might register as evil and as a Minion or Demon, even if dead.',
    hooks: { misregister: { from: 'good', kinds: ['evil', 'minion', 'demon'] } } },
  { id: 'saint', name: 'Saint', team: 'outsider', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 0,
    ability: 'If you die by execution, your team loses.',
    hooks: { onDeath: (s, owner, cause) => {
      if ((cause === 'execution' || cause === 'virgin') && abilityWorks(s, owner)) setWinner(s, 'evil', msg('saintWins', { name: owner.name }));
    } } },
  { id: 'poisoner', name: 'Poisoner', team: 'minion', shape: 'choose', edition: 'tb', firstNight: 40, otherNight: 40,
    ability: 'Each night, choose a player: they are poisoned tonight and tomorrow day.',
    hooks: {
      night: {
        recordsChoice: true,
        before: (s) => { s.poisonedId = null; },
        prompt: () => ({ min: 1, max: 1, body: msg('poisonerChoose') }),
        apply: (s, self, targets) => { if (abilityWorks(s, self)) s.poisonedId = targets[0] ?? null; },
      },
      // Poison lasts only while the Poisoner lives: the replay notes when it ends.
      onDeath: (s, owner) => { if (s.poisonedId) record(s, 'poisonEnded', { poisoner: owner.id, target: s.poisonedId }); },
    } },
  { id: 'spy', name: 'Spy', team: 'minion', shape: 'info', edition: 'tb', firstNight: 230, otherNight: 230,
    ability: 'Each night, you see the whole grimoire. You might register as good and as a Townsfolk or Outsider.',
    hooks: {
      night: { info: (s, self, slot) => spyInfo(s, self, slot) },
      misregister: { from: 'evil', kinds: ['good', 'townsfolk', 'outsider'], invertedKinds: ['evil'] },
    } },
  { id: 'scarletwoman', name: 'Scarlet Woman', team: 'minion', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 0,
    ability: 'If there are 5 or more players alive and the Demon dies, you become the Demon.',
    hooks: { onAnyDeath: (s, owner, dead) => {
      if (dead.alive || !isDemon(dead) || s.players.some((p) => p.alive && isDemon(p))) return;
      // "5 or more players alive" is counted at the moment the Demon dies — the Demon is one of them.
      const aliveWhenDemonDied = s.players.filter((p) => p.alive).length + 1;
      if (aliveWhenDemonDied < 5 || !abilityWorks(s, owner)) return;
      owner.character = dead.character;
      owner.perceived = dead.character;
      record(s, 'promotion', { player: owner.id, reason: 'scarletWoman' });
      appendLog(s, owner.id, msg('scarletWomanPromoted'));
      appendLog(s, owner.id, demonInfo(s, owner));
    } } },
  { id: 'baron', name: 'Baron', team: 'minion', shape: 'info', edition: 'tb', firstNight: 0, otherNight: 0,
    ability: 'There are extra Outsiders in play. [+2 Outsiders]',
    hooks: { setup: { outsiderDelta: 2 } } },
  { id: 'imp', name: 'Imp', team: 'demon', shape: 'choose', edition: 'tb', firstNight: 20, otherNight: 100,
    ability: 'Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.',
    hooks: {
      night: {
        // The Imp only "acts" on the first night to receive the Demon info — nothing to do without it.
        actors: (s, step) => (s.night === 1 && s.players.length < EVIL_INTRO_MIN_PLAYERS ? [] : s.players.filter((p) => p.alive && p.perceived === step)),
        shape: (s) => (s.night === 1 ? 'info' : 'choose'),
        info: (s, self) => demonInfo(s, self),
        prompt: () => ({ min: 1, max: 1, body: msg('impChoose') }),
        apply: (s, self, targets) => demonAttack(s, self, targets[0], { starPass: true }),
      },
      // A Minion becomes the Imp when the Imp kills themself (unless the Scarlet Woman already took over).
      afterDeath: (s, owner, cause) => {
        if (cause !== 'starPass' || s.players.some((p) => p.alive && isDemon(p))) return;
        const others = s.players.filter((p) => p.alive && p.character !== owner.character && isMinion(p));
        if (!others.length) return;
        const promoted = others[Math.floor(Math.random() * others.length)];
        promoted.character = 'imp';
        promoted.perceived = 'imp';
        record(s, 'promotion', { player: promoted.id, reason: 'starPass' });
        appendLog(s, promoted.id, msg('becameImp'));
        appendLog(s, promoted.id, demonInfo(s, promoted));
      },
    } },
];

// (Team lookups without importing the registry, which imports this file.)
import { CHARACTERS } from '../characters.js';
function isDemon(p: PlayerState): boolean { return CHARACTERS[p.character]?.team === 'demon'; }
function isMinion(p: PlayerState): boolean { return CHARACTERS[p.character]?.team === 'minion'; }
void slotOf;
void minionInfo;
void undertakerInfo;
