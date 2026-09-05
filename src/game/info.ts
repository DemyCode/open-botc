import {
  CHARACTERS,
  charsOfTeam,
  teamLabel,
  type CharacterId,
} from './characters.js';
import { nextInt, pick, sample, shuffle } from './rng.js';
import {
  abilityWorks,
  apparentCharacter,
  charactersInPlay,
  registersAs,
  tokenCharacter,
  type RegCtx,
} from './registration.js';
import { seatOrder, type GameState, type PlayerState } from './types.js';

export interface InfoDraft {
  title: string;
  body: string;
  players?: string[];
  character?: CharacterId;
}

const nameOf = (p: PlayerState) => p.name;

function others(s: GameState, self: PlayerState): PlayerState[] {
  return s.players.filter((p) => p.id !== self.id);
}

function usableChars(s: GameState, team: 'townsfolk' | 'outsider' | 'minion'): CharacterId[] {
  const banned = new Set(s.options.banned);
  return charsOfTeam(team).filter((c) => !banned.has(c));
}

/**
 * "You learn that 1 of these 2 players is the X." Shared shape for the
 * Washerwoman, Librarian and Investigator.
 */
function pairInfo(
  s: GameState,
  self: PlayerState,
  team: 'townsfolk' | 'outsider' | 'minion',
  title: string,
): InfoDraft {
  const ctx: RegCtx = { asker: self.id, night: s.night, slot: team };
  const pool = others(s, self);
  const working = abilityWorks(self);

  let target: PlayerState | null = null;
  let shown: CharacterId | null = null;

  if (working) {
    const candidates = pool.filter((p) => registersAs(s, p, team, ctx));
    if (candidates.length > 0) {
      target = pick(s, candidates);
      shown = apparentCharacter(s, target, ctx);
    }
  } else {
    // Drunk or poisoned: fabricate something that looks like real info.
    const inPlay = charactersInPlay(s);
    const fakePool = usableChars(s, team);
    // Prefer a character that isn't actually in play, so the lie is a lie.
    const notInPlay = fakePool.filter((c) => !inPlay.has(c));
    const chooseFrom = notInPlay.length > 0 && nextInt(s, 4) > 0 ? notInPlay : fakePool;
    if (pool.length > 0 && chooseFrom.length > 0) {
      target = pick(s, pool);
      shown = pick(s, chooseFrom);
    }
  }

  if (!target || !shown) {
    // Genuinely nobody of that team (only possible for the Librarian).
    return {
      title,
      body: `You learn that there are no ${teamLabel(
        team === 'townsfolk' ? 'townsfolk' : team === 'outsider' ? 'outsider' : 'minion',
      )}s in play.`,
    };
  }

  const decoyPool = pool.filter((p) => p.id !== target!.id);
  const decoy = decoyPool.length > 0 ? pick(s, decoyPool) : null;
  const shownPlayers = decoy ? shuffle(s, [target, decoy]) : [target];
  const c = CHARACTERS[shown];

  return {
    title,
    body:
      shownPlayers.length === 2
        ? `One of ${nameOf(shownPlayers[0])} and ${nameOf(shownPlayers[1])} is the ${c.name}.`
        : `${nameOf(shownPlayers[0])} is the ${c.name}.`,
    players: shownPlayers.map((p) => p.id),
    character: shown,
  };
}

export function washerwomanInfo(s: GameState, self: PlayerState): InfoDraft {
  return pairInfo(s, self, 'townsfolk', 'Washerwoman');
}

export function investigatorInfo(s: GameState, self: PlayerState): InfoDraft {
  return pairInfo(s, self, 'minion', 'Investigator');
}

export function librarianInfo(s: GameState, self: PlayerState): InfoDraft {
  const ctx: RegCtx = { asker: self.id, night: s.night, slot: 'outsider' };
  const working = abilityWorks(self);

  if (working) {
    const candidates = others(s, self).filter((p) => registersAs(s, p, 'outsider', ctx));
    if (candidates.length === 0) {
      return { title: 'Librarian', body: 'You learn that there are no Outsiders in play.' };
    }
  } else if (nextInt(s, 5) === 0) {
    // A drunk/poisoned Librarian is sometimes told "zero" — a very juicy lie.
    return { title: 'Librarian', body: 'You learn that there are no Outsiders in play.' };
  }
  return pairInfo(s, self, 'outsider', 'Librarian');
}

export function chefInfo(s: GameState, self: PlayerState): InfoDraft {
  const ctx: RegCtx = { asker: self.id, night: s.night, slot: 'chef' };
  const ring = seatOrder(s);
  let pairs = 0;

  if (abilityWorks(self)) {
    const evil = ring.map((p) => registersAs(s, p, 'evil', ctx));
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      if (evil[i] && evil[j]) pairs++;
    }
    // A 2-player ring would double-count the single adjacency; TB is 5+.
  } else {
    const evilCount = s.players.filter((p) => p.alignment === 'evil').length;
    pairs = nextInt(s, Math.max(2, evilCount));
  }

  return {
    title: 'Chef',
    body: `${pairs}`,
  };
}

/** The two nearest living neighbours, skipping the dead, excluding self. */
export function livingNeighbours(
  s: GameState,
  self: PlayerState,
): [PlayerState | null, PlayerState | null] {
  const ring = seatOrder(s);
  const n = ring.length;
  const idx = ring.findIndex((p) => p.id === self.id);
  if (idx < 0) return [null, null];

  let left: PlayerState | null = null;
  for (let k = 1; k < n; k++) {
    const p = ring[(idx - k + n * 2) % n];
    if (p.alive && p.id !== self.id) {
      left = p;
      break;
    }
  }
  let right: PlayerState | null = null;
  for (let k = 1; k < n; k++) {
    const p = ring[(idx + k) % n];
    if (p.alive && p.id !== self.id) {
      right = p;
      break;
    }
  }
  return [left, right];
}

export function empathInfo(s: GameState, self: PlayerState): InfoDraft {
  const ctx: RegCtx = { asker: self.id, night: s.night, slot: 'empath' };
  const [left, right] = livingNeighbours(s, self);
  let count = 0;

  if (abilityWorks(self)) {
    // When only two players are alive both neighbours are the same person,
    // and they are counted twice — this is the official ruling.
    if (left) count += registersAs(s, left, 'evil', { ...ctx, slot: 'empath-l' }) ? 1 : 0;
    if (right) count += registersAs(s, right, 'evil', { ...ctx, slot: 'empath-r' }) ? 1 : 0;
  } else {
    count = nextInt(s, 3);
  }

  const neighbours = [left, right].filter((p): p is PlayerState => !!p);
  const uniq = [...new Set(neighbours.map((p) => p.id))];

  return {
    title: 'Empath',
    body: `${count}`,
    players: uniq,
  };
}

export function fortuneTellerInfo(
  s: GameState,
  self: PlayerState,
  targets: PlayerState[],
): InfoDraft {
  const ctx: RegCtx = { asker: self.id, night: s.night, slot: 'ft' };
  let yes: boolean;

  if (abilityWorks(self)) {
    yes = targets.some(
      (t) => t.redHerring || registersAs(s, t, 'demon', { ...ctx, slot: `ft-${t.id}` }),
    );
  } else {
    yes = nextInt(s, 2) === 0;
  }

  const names = targets.map(nameOf).join(' and ');
  return {
    title: 'Fortune Teller',
    body: yes ? `YES — one of ${names} is the Demon.` : `NO — neither ${names} is the Demon.`,
    players: targets.map((p) => p.id),
  };
}

export function undertakerInfo(
  s: GameState,
  self: PlayerState,
  executed: PlayerState,
): InfoDraft {
  const ctx: RegCtx = { asker: self.id, night: s.night, slot: 'undertaker' };
  let shown: CharacterId;

  if (abilityWorks(self)) {
    shown = apparentCharacter(s, executed, ctx);
  } else {
    const inPlay = charactersInPlay(s);
    const pool = [
      ...usableChars(s, 'townsfolk'),
      ...usableChars(s, 'outsider'),
      ...usableChars(s, 'minion'),
    ].filter((c) => c !== tokenCharacter(s, executed));
    const notInPlay = pool.filter((c) => !inPlay.has(c));
    shown = pick(s, notInPlay.length > 0 ? notInPlay : pool);
  }

  return {
    title: 'Undertaker',
    body: `${nameOf(executed)} was executed today. They were the ${CHARACTERS[shown].name}.`,
    players: [executed.id],
    character: shown,
  };
}

export function ravenkeeperInfo(
  s: GameState,
  self: PlayerState,
  target: PlayerState,
): InfoDraft {
  const ctx: RegCtx = { asker: self.id, night: s.night, slot: 'ravenkeeper' };
  let shown: CharacterId;

  if (abilityWorks(self)) {
    shown = apparentCharacter(s, target, ctx);
  } else {
    const inPlay = charactersInPlay(s);
    const pool = [
      ...usableChars(s, 'townsfolk'),
      ...usableChars(s, 'outsider'),
      ...usableChars(s, 'minion'),
    ].filter((c) => c !== tokenCharacter(s, target));
    const notInPlay = pool.filter((c) => !inPlay.has(c));
    shown = pick(s, notInPlay.length > 0 ? notInPlay : pool);
  }

  return {
    title: 'Ravenkeeper',
    body: `${nameOf(target)} is the ${CHARACTERS[shown].name}.`,
    players: [target.id],
    character: shown,
  };
}

export function spyGrimoire(s: GameState, self: PlayerState): InfoDraft {
  if (!abilityWorks(self)) {
    // A poisoned Spy sees a shuffled, partly wrong grimoire.
    const shuffled = shuffle(s, s.players);
    const chars = shuffle(s, s.players.map((p) => tokenCharacter(s, p)));
    const lines = shuffled.map(
      (p, i) => `${p.name} — ${CHARACTERS[chars[i]].name}${p.alive ? '' : ' (dead)'}`,
    );
    return { title: 'Spy — the Grimoire', body: lines.join('\n') };
  }

  const lines = seatOrder(s).map((p) => {
    const c = CHARACTERS[p.character!];
    const tags: string[] = [];
    if (!p.alive) tags.push('dead');
    if (p.poisoned) tags.push('poisoned');
    if (p.protected) tags.push('protected');
    if (p.character === 'drunk' && p.perceived) tags.push(`thinks: ${CHARACTERS[p.perceived].name}`);
    if (p.redHerring) tags.push('red herring');
    if (p.character === 'virgin' && p.virginUsed) tags.push('ability used');
    if (p.character === 'slayer' && p.slayerUsed) tags.push('ability used');
    if (p.butlerMaster) {
      const m = s.players.find((x) => x.id === p.butlerMaster);
      if (m) tags.push(`master: ${m.name}`);
    }
    return `${p.name} — ${c.name}${tags.length ? ` (${tags.join(', ')})` : ''}`;
  });

  return { title: 'Spy — the Grimoire', body: lines.join('\n') };
}

export function minionInfoDraft(s: GameState, self: PlayerState): InfoDraft {
  const fellowMinions = s.players.filter(
    (p) => p.id !== self.id && CHARACTERS[p.character!].team === 'minion',
  );
  const demon = s.players.find((p) => CHARACTERS[p.character!].team === 'demon');

  const parts: string[] = [];
  if (demon) parts.push(`Your Demon is ${demon.name} (${CHARACTERS[demon.character!].name}).`);
  if (fellowMinions.length > 0) {
    parts.push(
      `Fellow ${fellowMinions.length === 1 ? 'Minion' : 'Minions'}: ` +
        fellowMinions
          .map((p) => `${p.name} (${CHARACTERS[p.character!].name})`)
          .join(', ') +
        '.',
    );
  } else {
    parts.push('You are the only Minion.');
  }

  return {
    title: 'Your evil team',
    body: parts.join('\n'),
    players: [...fellowMinions.map((p) => p.id), ...(demon ? [demon.id] : [])],
  };
}

export function demonInfoDraft(
  s: GameState,
  self: PlayerState,
  bluffs: CharacterId[],
): InfoDraft {
  const minions = s.players.filter((p) => CHARACTERS[p.character!].team === 'minion');
  const parts: string[] = [];
  parts.push(
    minions.length > 0
      ? `Your ${minions.length === 1 ? 'Minion is' : 'Minions are'} ` +
          minions.map((p) => `${p.name} (${CHARACTERS[p.character!].name})`).join(', ') +
          '.'
      : 'You have no Minions.',
  );
  parts.push(
    `These good characters are NOT in play — safe bluffs: ` +
      bluffs.map((b) => CHARACTERS[b].name).join(', ') +
      '.',
  );
  return {
    title: 'Your evil team & bluffs',
    body: parts.join('\n'),
    players: minions.map((p) => p.id),
  };
}

/** Used by the client to render "you are the X" cards. */
export function characterBlurb(id: CharacterId): string {
  const c = CHARACTERS[id];
  return `${c.emoji} ${c.name} — ${teamLabel(c.team)}\n${c.ability}`;
}

export { sample };
