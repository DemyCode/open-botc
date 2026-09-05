import { BUZZ, type BuzzKind } from './buzz.js';
import {
  CHARACTERS,
  DEMON_INFO_FIRST_NIGHT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MINION_INFO_FIRST_NIGHT,
  type CharacterId,
} from './characters.js';
import {
  chefInfo,
  demonInfoDraft,
  empathInfo,
  fortuneTellerInfo,
  investigatorInfo,
  librarianInfo,
  minionInfoDraft,
  ravenkeeperInfo,
  spyGrimoire,
  undertakerInfo,
  washerwomanInfo,
  type InfoDraft,
} from './info.js';
import { nextFloat, nextInt, pick, randomToken, makeSeed } from './rng.js';
import { abilityWorks, registersAs, tokenCharacter } from './registration.js';
import { dealCharacters } from './setup.js';
import {
  DEFAULT_OPTIONS,
  alivePlayers,
  playerById,
  seatOrder,
  type GameState,
  type NightStep,
  type Nomination,
  type PlayerState,
  type Prompt,
  type PromptChoice,
  type RoomOptions,
} from './types.js';

export class GameError extends Error {}

function fail(msg: string): never {
  throw new GameError(msg);
}

let idCounter = 0;
function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(
    Math.random() * 1296,
  ).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createGame(code: string, options?: Partial<RoomOptions>): GameState {
  return {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hostId: '',
    phase: 'lobby',
    night: 0,
    day: 0,
    players: [],
    options: { ...DEFAULT_OPTIONS, ...options },
    rng: makeSeed(),
    secret: randomToken(32),
    steps: [],
    stepIndex: 0,
    pending: null,
    pendingDeaths: [],
    impTarget: null,
    demonBluffs: [],
    drunkFake: null,
    hasNominated: [],
    hasBeenNominated: [],
    nomination: null,
    onTheBlock: null,
    voteBar: 0,
    endDayVotes: [],
    executedToday: null,
    executionHappened: false,
    ready: [],
    phaseDeadline: null,
    log: [],
    outbox: [],
    winner: null,
    winReason: null,
    finalGrimoire: false,
  };
}

export function addPlayer(s: GameState, name: string): PlayerState {
  if (s.phase !== 'lobby') fail('The game has already started.');
  const clean = name.trim().slice(0, 20);
  if (!clean) fail('Please enter a name.');
  if (s.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    fail(`Someone in this room is already called "${clean}".`);
  }
  if (s.players.length >= MAX_PLAYERS) {
    fail(`Trouble Brewing supports at most ${MAX_PLAYERS} players.`);
  }

  const p: PlayerState = {
    id: uid('p'),
    token: randomToken(),
    name: clean,
    seat: s.players.length,
    connected: true,
    lastSeen: Date.now(),
    character: null,
    perceived: null,
    alignment: 'good',
    alive: true,
    ghostVoteUsed: false,
    poisoned: false,
    protected: false,
    redHerring: false,
    virginUsed: false,
    slayerUsed: false,
    butlerMaster: null,
    diedTonight: false,
    log: [],
    // Every player gets their own secret topic up front, so setting up
    // notifications is one tap and never involves typing a topic name.
    push: { ntfyTopic: `botc-${randomToken(18).toLowerCase()}` },
  };
  s.players.push(p);
  if (!s.hostId) s.hostId = p.id;
  logPublic(s, `${p.name} joined.`);
  return p;
}

export function removePlayer(s: GameState, playerId: string): void {
  if (s.phase !== 'lobby') fail('You cannot leave a game in progress.');
  const p = playerById(s, playerId);
  if (!p) return;
  s.players = s.players.filter((x) => x.id !== playerId);
  s.players.forEach((x, i) => (x.seat = i));
  if (s.hostId === playerId) s.hostId = s.players[0]?.id ?? '';
  logPublic(s, `${p.name} left.`);
}

export function moveSeat(s: GameState, playerId: string, delta: number): void {
  if (s.phase !== 'lobby') fail('Seats are fixed once the game starts.');
  const ring = seatOrder(s);
  const i = ring.findIndex((p) => p.id === playerId);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= ring.length) return;
  const tmp = ring[i];
  ring[i] = ring[j];
  ring[j] = tmp;
  ring.forEach((p, k) => (p.seat = k));
}

/** Return a finished game to the lobby, keeping the same players and seats. */
export function resetToLobby(s: GameState, playerId: string): void {
  requireHost(s, playerId);
  if (s.phase !== 'over') fail('The game is still running.');

  for (const p of s.players) {
    p.character = null;
    p.perceived = null;
    p.alignment = 'good';
    p.alive = true;
    p.ghostVoteUsed = false;
    p.poisoned = false;
    p.protected = false;
    p.redHerring = false;
    p.virginUsed = false;
    p.slayerUsed = false;
    p.butlerMaster = null;
    p.diedTonight = false;
    p.log = [];
  }

  s.phase = 'lobby';
  s.night = 0;
  s.day = 0;
  s.steps = [];
  s.stepIndex = 0;
  s.pending = null;
  s.pendingDeaths = [];
  s.impTarget = null;
  s.demonBluffs = [];
  s.drunkFake = null;
  s.hasNominated = [];
  s.hasBeenNominated = [];
  s.nomination = null;
  s.onTheBlock = null;
  s.voteBar = 0;
  s.endDayVotes = [];
  s.executedToday = null;
  s.executionHappened = false;
  s.ready = [];
  s.phaseDeadline = null;
  s.log = [];
  s.winner = null;
  s.winReason = null;
  s.finalGrimoire = false;
  s.secret = randomToken(32);
  s.rng = makeSeed();
  logPublic(s, 'Back to the lobby — new game.');
}

export function setOptions(
  s: GameState,
  playerId: string,
  patch: Partial<RoomOptions>,
): void {
  requireHost(s, playerId);
  if (s.phase !== 'lobby') fail('Settings are locked once the game starts.');
  s.options = { ...s.options, ...patch };
}

function requireHost(s: GameState, playerId: string): void {
  if (s.hostId !== playerId) fail('Only the host can do that.');
}

// ---------------------------------------------------------------------------
// Logging & notifications
// ---------------------------------------------------------------------------

function logPublic(s: GameState, text: string, important = false): void {
  s.log.push({
    id: uid('l'),
    ts: Date.now(),
    phase: s.phase,
    night: s.night,
    day: s.day,
    text,
    important,
  });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

function giveInfo(s: GameState, p: PlayerState, draft: InfoDraft, buzzToo = true): void {
  p.log.push({
    id: uid('i'),
    night: s.night,
    title: draft.title,
    body: draft.body,
    players: draft.players,
    character: draft.character,
    ts: Date.now(),
  });
  if (buzzToo) {
    buzz(s, [p.id], 'info', draft.title, firstLine(draft.body));
  }
}

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i < 0 ? s : s.slice(0, i) + ' …';
}

/**
 * Queue a buzz. The kind picks the vibration rhythm, so that a player can tell
 * what happened without looking — see `buzz.ts` for the vocabulary.
 *
 * Kinds marked `wake: false` are dropped here: their screens still update via
 * the normal state broadcast, but no phone is disturbed. A buzz has to mean the
 * game is waiting on you, or people stop trusting it.
 */
function buzz(
  s: GameState,
  playerIds: string[],
  kind: BuzzKind,
  title: string,
  body: string,
): void {
  if (playerIds.length === 0 || !BUZZ[kind].wake) return;
  s.outbox.push({
    k: 'buzz',
    playerIds,
    title,
    body,
    pattern: BUZZ[kind].pattern,
    push: true,
    tag: kind,
  });
}

function buzzEveryone(s: GameState, kind: BuzzKind, title: string, body: string): void {
  buzz(s, s.players.map((p) => p.id), kind, title, body);
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

export function startGame(s: GameState, playerId: string, now = Date.now()): void {
  requireHost(s, playerId);
  if (s.phase !== 'lobby') fail('The game has already started.');
  if (s.players.length < MIN_PLAYERS) {
    fail(`Trouble Brewing needs at least ${MIN_PLAYERS} players.`);
  }

  const deal = dealCharacters(s, s.players);
  for (const p of s.players) {
    p.character = deal.assignments[p.id];
    p.perceived = deal.perceived[p.id];
    p.alignment = CHARACTERS[p.character].team === 'minion' || CHARACTERS[p.character].team === 'demon'
      ? 'evil'
      : 'good';
    p.redHerring = deal.redHerring === p.id;
  }
  s.demonBluffs = deal.demonBluffs;
  s.drunkFake = deal.drunkFake;
  s.ready = [];

  s.phase = 'reveal';
  s.phaseDeadline = now + s.options.revealSeconds * 1000;
  logPublic(
    s,
    `Game on — ${s.players.length} players: ${deal.counts.townsfolk} Townsfolk, ` +
      `${deal.counts.outsider} Outsider${deal.counts.outsider === 1 ? '' : 's'}, ` +
      `${deal.counts.minion} Minion${deal.counts.minion === 1 ? '' : 's'}, 1 Demon.`,
    true,
  );

  for (const p of s.players) {
    const c = CHARACTERS[p.perceived!];
    buzz(s, [p.id], 'reveal', 'Your character', `You are the ${c.name}.`);
  }
}

export function markReady(s: GameState, playerId: string, now = Date.now()): void {
  if (s.phase !== 'reveal') return;
  if (!s.ready.includes(playerId)) s.ready.push(playerId);
  if (s.ready.length >= s.players.length) beginNight(s, now);
}

// ---------------------------------------------------------------------------
// Night
// ---------------------------------------------------------------------------

function buildNightSteps(s: GameState): NightStep[] {
  const first = s.night === 1;
  const steps: NightStep[] = [];

  if (first) {
    const minions = s.players.filter((p) => CHARACTERS[p.character!].team === 'minion');
    if (minions.length > 0) {
      steps.push({
        id: uid('st'),
        order: MINION_INFO_FIRST_NIGHT,
        kind: 'minion_info',
        playerIds: minions.map((p) => p.id),
      });
    }
    const demon = s.players.find((p) => CHARACTERS[p.character!].team === 'demon');
    if (demon) {
      steps.push({
        id: uid('st'),
        order: DEMON_INFO_FIRST_NIGHT,
        kind: 'demon_info',
        playerIds: [demon.id],
      });
    }
  }

  for (const p of s.players) {
    // The Drunk wakes on the schedule of the character they *think* they are.
    const acting = (p.perceived ?? p.character) as CharacterId;
    const c = CHARACTERS[acting];
    const order = first ? c.firstNight : c.otherNight;
    if (order > 0) {
      steps.push({ id: uid('st'), order, kind: 'character', character: acting, playerId: p.id });
    }
  }

  steps.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return steps;
}

export function beginNight(s: GameState, now = Date.now()): void {
  s.night += 1;
  s.phase = 'night';
  s.pending = null;
  s.phaseDeadline = null;

  // Poison lasts "tonight and tomorrow day", so it clears as the next night begins.
  for (const p of s.players) {
    p.poisoned = false;
    p.protected = false;
    p.diedTonight = false;
  }
  s.pendingDeaths = [];
  s.impTarget = null;

  s.steps = buildNightSteps(s);
  s.stepIndex = 0;

  logPublic(s, `Night ${s.night} falls.`, true);
  buzzEveryone(s, 'night', `Night ${s.night}`, 'Eyes closed. Wait for your phone.');

  advanceNight(s, now);
}

function advanceNight(s: GameState, now: number): void {
  while (s.stepIndex < s.steps.length) {
    if (s.winner) return;
    const step = s.steps[s.stepIndex];
    const outcome = runStep(s, step, now);
    if (outcome === 'wait') return;
    s.stepIndex++;
  }
  dawn(s, now);
}

type StepOutcome = 'done' | 'wait';

function runStep(s: GameState, step: NightStep, now: number): StepOutcome {
  if (step.kind === 'minion_info') {
    for (const id of step.playerIds ?? []) {
      const p = playerById(s, id);
      if (p && p.alive) giveInfo(s, p, minionInfoDraft(s, p));
    }
    return 'done';
  }

  if (step.kind === 'demon_info') {
    for (const id of step.playerIds ?? []) {
      const p = playerById(s, id);
      if (p && p.alive) giveInfo(s, p, demonInfoDraft(s, p, s.demonBluffs));
    }
    return 'done';
  }

  const p = playerById(s, step.playerId!);
  if (!p) return 'done';
  const cid = step.character!;

  // The Ravenkeeper is the one character that wakes *because* they are dead.
  if (cid === 'ravenkeeper') {
    if (!p.diedTonight) return 'done';
    return askChoice(s, p, step, {
      title: 'Ravenkeeper',
      body: 'You died tonight. Choose a player — you learn their character.',
      count: 1,
      allowSelf: true,
      now,
    });
  }

  if (!p.alive) return 'done';

  switch (cid) {
    case 'poisoner':
      return askChoice(s, p, step, {
        title: 'Poisoner',
        body: 'Choose a player to poison tonight and tomorrow.',
        count: 1,
        allowSelf: true,
        now,
      });

    case 'monk':
      return askChoice(s, p, step, {
        title: 'Monk',
        body: 'Choose a player (not yourself) to protect from the Demon tonight.',
        count: 1,
        allowSelf: false,
        now,
      });

    case 'imp':
      return askChoice(s, p, step, {
        title: 'Imp',
        body: 'Choose a player to kill. Choosing yourself passes the Imp to a Minion.',
        count: 1,
        allowSelf: true,
        now,
      });

    case 'fortuneteller':
      return askChoice(s, p, step, {
        title: 'Fortune Teller',
        body: 'Choose 2 players. You learn if either registers as the Demon.',
        count: 2,
        allowSelf: true,
        now,
      });

    case 'butler':
      return askChoice(s, p, step, {
        title: 'Butler',
        body: 'Choose your master (not yourself). Tomorrow you may only vote if they do.',
        count: 1,
        allowSelf: false,
        now,
      });

    // --- information only: delivered without blocking the night
    case 'washerwoman':
      giveInfo(s, p, washerwomanInfo(s, p));
      return 'done';
    case 'librarian':
      giveInfo(s, p, librarianInfo(s, p));
      return 'done';
    case 'investigator':
      giveInfo(s, p, investigatorInfo(s, p));
      return 'done';
    case 'chef': {
      const d = chefInfo(s, p);
      giveInfo(s, p, {
        ...d,
        body: `${d.body} pair${d.body === '1' ? '' : 's'} of neighbouring evil players.`,
      });
      return 'done';
    }
    case 'empath': {
      const d = empathInfo(s, p);
      giveInfo(s, p, {
        ...d,
        body: `${d.body} of your 2 living neighbours ${d.body === '1' ? 'is' : 'are'} evil.`,
      });
      return 'done';
    }
    case 'undertaker': {
      if (!s.executedToday) return 'done';
      const executed = playerById(s, s.executedToday);
      if (!executed) return 'done';
      giveInfo(s, p, undertakerInfo(s, p, executed));
      return 'done';
    }
    case 'spy':
      giveInfo(s, p, spyGrimoire(s, p));
      return 'done';

    default:
      return 'done';
  }
}

interface AskOpts {
  title: string;
  body: string;
  count: number;
  allowSelf: boolean;
  now: number;
}

function askChoice(
  s: GameState,
  p: PlayerState,
  step: NightStep,
  o: AskOpts,
): StepOutcome {
  const choices: PromptChoice[] = seatOrder(s).map((t) => ({
    playerId: t.id,
    label: t.name,
    disabled: !o.allowSelf && t.id === p.id,
    reason: !o.allowSelf && t.id === p.id ? 'Not yourself' : undefined,
  }));

  const selectable = choices.filter((c) => !c.disabled);
  if (selectable.length < o.count) return 'done';

  s.pending = {
    id: uid('q'),
    playerId: p.id,
    stepId: step.id,
    character: step.character ?? null,
    title: o.title,
    body: o.body,
    count: o.count,
    choices,
    deadline: o.now + s.options.nightPromptSeconds * 1000,
  };

  buzz(s, [p.id], 'turn', `${o.title} — your turn`, o.body);
  return 'wait';
}

export function submitNightChoice(
  s: GameState,
  playerId: string,
  promptId: string,
  targetIds: string[],
  now = Date.now(),
): void {
  const pending = s.pending;
  if (!pending) fail('There is nothing to answer right now.');
  if (pending.id !== promptId) fail('That prompt has expired.');
  if (pending.playerId !== playerId) fail('That prompt is not for you.');

  const unique = [...new Set(targetIds)];
  if (unique.length !== pending.count) {
    fail(`Choose exactly ${pending.count} player${pending.count === 1 ? '' : 's'}.`);
  }
  for (const t of unique) {
    const c = pending.choices.find((x) => x.playerId === t);
    if (!c || c.disabled) fail('That is not a valid choice.');
  }

  applyNightChoice(s, pending, unique, now);
}

function autoResolvePrompt(s: GameState, now: number): void {
  const pending = s.pending;
  if (!pending) return;
  const pool = pending.choices.filter((c) => !c.disabled).map((c) => c.playerId);
  const chosen: string[] = [];
  while (chosen.length < pending.count && pool.length > 0) {
    const i = nextInt(s, pool.length);
    chosen.push(pool.splice(i, 1)[0]);
  }
  const p = playerById(s, pending.playerId);
  if (p) {
    giveInfo(
      s,
      p,
      {
        title: pending.title,
        body: 'You ran out of time, so your choice was made for you.',
      },
      false,
    );
  }
  applyNightChoice(s, pending, chosen, now);
}

function applyNightChoice(
  s: GameState,
  pending: Prompt,
  targetIds: string[],
  now: number,
): void {
  const actor = playerById(s, pending.playerId);
  s.pending = null;
  const targets = targetIds
    .map((id) => playerById(s, id))
    .filter((p): p is PlayerState => !!p);

  if (actor) {
    switch (pending.character) {
      case 'poisoner':
        if (abilityWorks(actor) && actor.alive && targets[0]) targets[0].poisoned = true;
        break;

      case 'monk':
        if (abilityWorks(actor) && actor.alive && targets[0]) targets[0].protected = true;
        break;

      case 'butler':
        actor.butlerMaster = targets[0]?.id ?? null;
        break;

      case 'fortuneteller':
        if (targets.length === 2) giveInfo(s, actor, fortuneTellerInfo(s, actor, targets));
        break;

      case 'ravenkeeper':
        if (targets[0]) giveInfo(s, actor, ravenkeeperInfo(s, actor, targets[0]));
        break;

      case 'imp':
        if (targets[0]) resolveImpKill(s, actor, targets[0], now);
        break;
    }
  }

  s.stepIndex++;
  advanceNight(s, now);
}

function resolveImpKill(
  s: GameState,
  imp: PlayerState,
  target: PlayerState,
  now: number,
): void {
  s.impTarget = target.id;
  // A drunk or poisoned Imp still kills — the Imp's ability is the kill itself,
  // but a poisoned Imp's kill fails, per the standard reading of "your ability
  // does not work".
  if (!abilityWorks(imp)) return;
  attemptDemonKill(s, target, imp, now);
}

function attemptDemonKill(
  s: GameState,
  target: PlayerState,
  imp: PlayerState,
  now: number,
): void {
  if (!target.alive) return;
  if (target.protected) return; // Monk
  if (target.character === 'soldier' && abilityWorks(target)) return;

  if (
    target.character === 'mayor' &&
    abilityWorks(target) &&
    nextFloat(s) < s.options.mayorBounceChance
  ) {
    const others = alivePlayers(s).filter(
      (p) =>
        p.id !== target.id &&
        !p.protected &&
        !(p.character === 'soldier' && abilityWorks(p)),
    );
    if (others.length > 0) {
      const bounced = pick(s, others);
      killPlayer(s, bounced, 'night', { starPass: false, now });
      return;
    }
  }

  const selfKill = target.id === imp.id;
  killPlayer(s, target, 'night', { starPass: selfKill, now });
}

interface KillOpts {
  starPass: boolean;
  now: number;
}

function killPlayer(
  s: GameState,
  p: PlayerState,
  cause: 'night' | 'execution' | 'slayer',
  opts: KillOpts,
): void {
  if (!p.alive) return;
  const aliveBefore = alivePlayers(s).length;
  p.alive = false;

  if (cause === 'night') {
    p.diedTonight = true;
    s.pendingDeaths.push(p.id);
  }

  if (CHARACTERS[p.character!].team === 'demon') {
    handleDemonDeath(s, p, aliveBefore, opts);
  }
}

function handleDemonDeath(
  s: GameState,
  dead: PlayerState,
  aliveBefore: number,
  opts: KillOpts,
): void {
  const livingMinions = s.players.filter(
    (p) => p.alive && CHARACTERS[p.character!].team === 'minion',
  );

  // The Imp's own star-pass takes priority over the Scarlet Woman.
  if (opts.starPass && livingMinions.length > 0) {
    becomeImp(s, pick(s, livingMinions), 'The Imp passed the star to you.');
    return;
  }

  if (aliveBefore >= 5) {
    const sw = livingMinions.find((p) => p.character === 'scarletwoman' && abilityWorks(p));
    if (sw) {
      becomeImp(s, sw, 'The Demon died while 5 or more players were alive.');
      return;
    }
  }
}

function becomeImp(s: GameState, p: PlayerState, why: string): void {
  p.character = 'imp';
  p.perceived = 'imp';

  // Record it silently; the buzz below decides whether to disturb them.
  giveInfo(
    s,
    p,
    { title: 'You are now the Imp', body: `${why} You are the Demon from now on.` },
    false,
  );

  // Only wake them if their eyes are actually shut. The Scarlet Woman usually
  // inherits the Demon in broad daylight — an execution, or a Slayer shot —
  // and then the player is already looking at the screen that just told them.
  if (s.phase === 'night') {
    buzz(s, [p.id], 'transform', 'You are now the Imp', 'The Demon has passed to you.');
  }
}

// ---------------------------------------------------------------------------
// Dawn & day
// ---------------------------------------------------------------------------

function dawn(s: GameState, now: number): void {
  s.phase = 'dawn';
  s.day = s.night;
  s.pending = null;

  for (const p of s.players) {
    p.protected = false;
  }

  const deaths = s.pendingDeaths
    .map((id) => playerById(s, id))
    .filter((p): p is PlayerState => !!p);

  if (deaths.length === 0) {
    logPublic(s, `Day ${s.day}: nobody died in the night.`, true);
  } else {
    for (const d of deaths) logPublic(s, `${d.name} died in the night.`, true);
  }

  // Reset per-day state now that the Undertaker has had their look.
  s.executedToday = null;
  s.executionHappened = false;
  s.hasNominated = [];
  s.hasBeenNominated = [];
  s.nomination = null;
  s.onTheBlock = null;
  s.voteBar = 0;
  s.endDayVotes = [];

  if (checkWin(s)) return;

  const summary =
    deaths.length === 0
      ? 'Nobody died in the night.'
      : `${deaths.map((d) => d.name).join(' and ')} died in the night.`;
  buzzEveryone(s, 'dawn', `Day ${s.day} — open your eyes`, summary);

  s.phaseDeadline = now + s.options.dawnSeconds * 1000;
}

function beginDiscussion(s: GameState, now: number): void {
  s.phase = 'day';
  logPublic(s, `Day ${s.day}: discussion.`);
  s.phaseDeadline =
    s.options.discussionSeconds > 0 ? now + s.options.discussionSeconds * 1000 : null;
}

export function openNominations(s: GameState, playerId: string, now = Date.now()): void {
  const p = playerById(s, playerId);
  if (!p) fail('Unknown player.');
  if (s.phase !== 'day') fail('Nominations cannot be opened right now.');
  if (!p.alive) fail('Dead players cannot open nominations.');
  doOpenNominations(s, now);
}

function doOpenNominations(s: GameState, _now: number): void {
  s.phase = 'nominations';
  s.phaseDeadline = null;
  logPublic(s, 'Nominations are open.', true);
  buzzEveryone(
    s,
    'speech',
    'Nominations are open',
    'Tap a player on your phone to nominate them.',
  );
}

export function nominate(
  s: GameState,
  playerId: string,
  targetId: string,
  now = Date.now(),
): void {
  if (s.phase !== 'nominations') fail('Nominations are not open.');
  const nominator = playerById(s, playerId);
  const nominee = playerById(s, targetId);
  if (!nominator || !nominee) fail('Unknown player.');
  if (!nominator.alive) fail('Dead players cannot nominate.');
  if (s.hasNominated.includes(nominator.id)) fail('You have already nominated today.');
  if (s.hasBeenNominated.includes(nominee.id)) {
    fail(`${nominee.name} has already been nominated today.`);
  }
  if (!nominee.alive) fail('You cannot nominate a dead player.');

  s.hasNominated.push(nominator.id);
  s.hasBeenNominated.push(nominee.id);
  s.endDayVotes = [];

  logPublic(s, `${nominator.name} nominates ${nominee.name}.`, true);
  buzzEveryone(
    s,
    'nomination',
    'Nomination',
    `${nominator.name} nominates ${nominee.name}. Listen to the accuser.`,
  );

  // --- Virgin
  if (nominee.character === 'virgin' && !nominee.virginUsed && nominee.alive) {
    nominee.virginUsed = true;
    const works = abilityWorks(nominee);
    const isTownsfolk =
      works &&
      registersAs(s, nominator, 'townsfolk', {
        asker: nominee.id,
        night: s.day,
        slot: 'virgin',
      });
    if (isTownsfolk) {
      logPublic(
        s,
        `${nominee.name} is the Virgin — ${nominator.name} is executed immediately!`,
        true,
      );
      buzzEveryone(s, 'death', 'Virgin!', `${nominator.name} is executed immediately.`);
      s.nomination = null;
      executeAndEndDay(s, nominator, now);
      return;
    }
  }

  s.nomination = {
    nominatorId: nominator.id,
    nomineeId: nominee.id,
    stage: 'accuser',
    votes: {},
    voteOrder: [],
    voteIndex: 0,
  };
  s.phase = 'speech';
  s.phaseDeadline = now + s.options.speechSeconds * 1000;
}

export function endSpeech(s: GameState, playerId: string, now = Date.now()): void {
  if (s.phase !== 'speech' || !s.nomination) fail('Nobody is speaking.');
  const n = s.nomination;
  const speaker = n.stage === 'accuser' ? n.nominatorId : n.nomineeId;
  if (playerId !== speaker && playerId !== s.hostId) {
    fail('Only the current speaker (or the host) can move on.');
  }
  nextSpeechStage(s, now);
}

function nextSpeechStage(s: GameState, now: number): void {
  const n = s.nomination;
  if (!n) return;
  if (n.stage === 'accuser') {
    n.stage = 'accusee';
    const nominee = playerById(s, n.nomineeId);
    logPublic(s, `${nominee?.name ?? '?'} defends themselves.`);
    buzzEveryone(s, 'speech', 'Defence', `${nominee?.name ?? '?'} now speaks.`);
    s.phaseDeadline = now + s.options.speechSeconds * 1000;
    return;
  }
  beginVoting(s, now);
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

function eligibleVoters(s: GameState): PlayerState[] {
  return s.players.filter((p) => p.alive || !p.ghostVoteUsed);
}

function beginVoting(s: GameState, now: number): void {
  const n = s.nomination;
  if (!n) return;
  n.stage = 'voting';
  s.phase = 'voting';

  const nominee = playerById(s, n.nomineeId);
  const required = requiredVotes(s);
  logPublic(
    s,
    `Voting on ${nominee?.name ?? '?'} — ${required} vote${required === 1 ? '' : 's'} needed.`,
  );

  if (s.options.votingMode === 'sequential') {
    const ring = seatOrder(s);
    const start = ring.findIndex((p) => p.id === n.nomineeId);
    const order: string[] = [];
    for (let k = 1; k <= ring.length; k++) {
      const p = ring[(start + k) % ring.length];
      if (p.alive || !p.ghostVoteUsed) order.push(p.id);
    }
    n.voteOrder = order;
    n.voteIndex = 0;
    promptSequentialVoter(s, now);
  } else {
    n.voteOrder = eligibleVoters(s).map((p) => p.id);
    n.voteIndex = -1;
    buzz(s, n.voteOrder, 'vote', 'Vote now', `Execute ${nominee?.name ?? '?'}?`);
    s.phaseDeadline = now + s.options.voteSeconds * 1000;
  }
}

function sequentialVoteSeconds(s: GameState): number {
  return Math.max(6, Math.round(s.options.voteSeconds / 3));
}

function promptSequentialVoter(s: GameState, now: number): void {
  const n = s.nomination;
  if (!n) return;
  while (n.voteIndex < n.voteOrder.length) {
    const id = n.voteOrder[n.voteIndex];
    const p = playerById(s, id);
    if (p && (p.alive || !p.ghostVoteUsed)) {
      const nominee = playerById(s, n.nomineeId);
      buzz(s, [id], 'vote', 'Your vote', `Execute ${nominee?.name ?? '?'}?`);
      s.phaseDeadline = now + sequentialVoteSeconds(s) * 1000;
      return;
    }
    n.voteIndex++;
  }
  resolveVote(s, now);
}

export function castVote(
  s: GameState,
  playerId: string,
  vote: boolean,
  now = Date.now(),
): void {
  if (s.phase !== 'voting' || !s.nomination) fail('There is no vote in progress.');
  const n = s.nomination;
  const p = playerById(s, playerId);
  if (!p) fail('Unknown player.');
  if (!p.alive && p.ghostVoteUsed) fail('You have already used your ghost vote.');

  if (s.options.votingMode === 'sequential') {
    if (n.voteOrder[n.voteIndex] !== playerId) fail('It is not your turn to vote.');
    n.votes[playerId] = vote;
    n.voteIndex++;
    promptSequentialVoter(s, now);
    return;
  }

  if (!n.voteOrder.includes(playerId)) fail('You cannot vote on this nomination.');
  n.votes[playerId] = vote;
  if (n.voteOrder.every((id) => id in n.votes)) resolveVote(s, now);
}

function requiredVotes(s: GameState): number {
  return Math.ceil(alivePlayers(s).length / 2);
}

function resolveVote(s: GameState, now: number): void {
  const n = s.nomination;
  if (!n) return;
  const nominee = playerById(s, n.nomineeId);
  if (!nominee) return;

  let yes = 0;
  const counted: string[] = [];
  const blocked: string[] = [];

  for (const [id, v] of Object.entries(n.votes)) {
    if (!v) continue;
    const voter = playerById(s, id);
    if (!voter) continue;

    // The Butler may only vote if their master voted yes. Dead Butlers have no
    // ability, and a drunk or poisoned Butler votes freely.
    if (
      voter.character === 'butler' &&
      voter.alive &&
      abilityWorks(voter) &&
      voter.butlerMaster
    ) {
      const masterVote = n.votes[voter.butlerMaster];
      if (masterVote !== true) {
        blocked.push(voter.name);
        continue;
      }
    }

    yes++;
    counted.push(voter.name);
    if (!voter.alive) voter.ghostVoteUsed = true;
  }

  const required = requiredVotes(s);
  let onBlock = false;
  let tied = false;

  if (yes >= required) {
    if (yes > s.voteBar) {
      s.voteBar = yes;
      s.onTheBlock = nominee.id;
      onBlock = true;
    } else if (yes === s.voteBar) {
      s.onTheBlock = null;
      tied = true;
    }
  }

  n.result = { yes, required, onBlock, tied };
  n.stage = 'result';

  let text = `${nominee.name}: ${yes} vote${yes === 1 ? '' : 's'} (${required} needed).`;
  if (onBlock) text += ` ${nominee.name} is on the block.`;
  else if (tied) text += ' Tied — nobody is on the block.';
  else if (yes < required) text += ' Not enough votes.';
  if (blocked.length > 0) {
    text += ` (${blocked.join(', ')} could not vote — Butler.)`;
  }
  logPublic(s, text, true);
  buzzEveryone(s, 'voteresult', 'Vote result', text);

  s.phase = 'nominations';
  s.phaseDeadline = null;

  maybeCloseDay(s, now);
}

/**
 * The day ends on its own once no further nomination is legal: either everyone
 * living has used their nomination, or everyone living has already been
 * nominated once.
 */
function maybeCloseDay(s: GameState, now: number): void {
  const alive = alivePlayers(s);
  if (alive.length === 0) return;

  if (alive.every((p) => s.hasNominated.includes(p.id))) {
    logPublic(s, 'Everyone has nominated. The day ends.');
    endDayNow(s, now);
    return;
  }
  if (alive.every((p) => s.hasBeenNominated.includes(p.id))) {
    logPublic(s, 'Everyone has been nominated. The day ends.');
    endDayNow(s, now);
  }
}

// ---------------------------------------------------------------------------
// Slayer
// ---------------------------------------------------------------------------

export function slay(
  s: GameState,
  playerId: string,
  targetId: string,
  now = Date.now(),
): void {
  if (s.phase !== 'day' && s.phase !== 'nominations') {
    fail('The Slayer can only act during the day.');
  }
  const slayer = playerById(s, playerId);
  const target = playerById(s, targetId);
  if (!slayer || !target) fail('Unknown player.');
  if (slayer.perceived !== 'slayer') fail('You are not the Slayer.');
  if (slayer.slayerUsed) fail('You have already used your Slayer ability.');
  if (!slayer.alive) fail('Dead players cannot use the Slayer ability.');

  slayer.slayerUsed = true;
  logPublic(s, `${slayer.name} claims Slayer and shoots ${target.name}!`, true);

  const works = abilityWorks(slayer);
  const isDemon =
    works &&
    target.alive &&
    registersAs(s, target, 'demon', { asker: slayer.id, night: s.day, slot: 'slayer' });

  if (isDemon) {
    killPlayer(s, target, 'slayer', { starPass: false, now });
    logPublic(s, `${target.name} dies! They were the Demon.`, true);
    buzzEveryone(s, 'death', 'Slayer!', `${slayer.name} shot ${target.name} — they die.`);
  } else {
    logPublic(s, 'Nothing happens.', true);
    buzzEveryone(
      s,
      'voteresult',
      'Slayer shot',
      `${slayer.name} shot ${target.name} — nothing happens.`,
    );
  }

  checkWin(s);
}

// ---------------------------------------------------------------------------
// Ending the day
// ---------------------------------------------------------------------------

export function requestEndDay(s: GameState, playerId: string, now = Date.now()): void {
  if (s.phase !== 'day' && s.phase !== 'nominations') {
    fail('The day is not running.');
  }
  const p = playerById(s, playerId);
  if (!p || !p.alive) fail('Only living players can end the day.');

  if (s.endDayVotes.includes(playerId)) {
    s.endDayVotes = s.endDayVotes.filter((id) => id !== playerId);
    return;
  }
  s.endDayVotes.push(playerId);

  const needed = Math.ceil(alivePlayers(s).length / 2);
  if (s.endDayVotes.length >= needed) {
    logPublic(s, 'The town agrees to end the day.');
    endDayNow(s, now);
  }
}

function endDayNow(s: GameState, now: number): void {
  s.phase = 'dusk';
  s.nomination = null;
  s.endDayVotes = [];

  const victim = s.onTheBlock ? playerById(s, s.onTheBlock) : null;
  if (victim && victim.alive) {
    doExecute(s, victim, now);
  } else {
    logPublic(s, 'No execution today.', true);
    buzzEveryone(s, 'voteresult', 'Dusk', 'No execution today.');
  }

  if (checkEndOfDayWins(s)) return;
  s.phaseDeadline = now + 8000;
}

/** The Virgin path: an immediate execution that also ends the day. */
function executeAndEndDay(s: GameState, victim: PlayerState, now: number): void {
  s.phase = 'dusk';
  s.nomination = null;
  s.endDayVotes = [];
  s.onTheBlock = null;
  doExecute(s, victim, now);
  if (checkEndOfDayWins(s)) return;
  s.phaseDeadline = now + 8000;
}

function doExecute(s: GameState, victim: PlayerState, now: number): void {
  killPlayer(s, victim, 'execution', { starPass: false, now });
  s.executedToday = victim.id;
  s.executionHappened = true;
  logPublic(s, `${victim.name} is executed.`, true);
  buzzEveryone(s, 'death', 'Execution', `${victim.name} is executed.`);
}

function checkEndOfDayWins(s: GameState): boolean {
  // Saint: executed by the town, good loses.
  if (s.executedToday) {
    const v = playerById(s, s.executedToday);
    if (v && v.character === 'saint' && abilityWorks(v)) {
      return endGame(s, 'evil', `${v.name} was the Saint and was executed.`);
    }
  }

  // Mayor: 3 alive and no execution.
  if (!s.executionHappened && alivePlayers(s).length === 3) {
    const mayor = s.players.find(
      (p) => p.character === 'mayor' && p.alive && abilityWorks(p),
    );
    if (mayor) {
      return endGame(
        s,
        'good',
        `${mayor.name} is the Mayor: 3 players alive and no execution.`,
      );
    }
  }

  return checkWin(s);
}

// ---------------------------------------------------------------------------
// Win conditions
// ---------------------------------------------------------------------------

export function checkWin(s: GameState): boolean {
  if (s.winner) return true;

  const demonAlive = s.players.some(
    (p) => p.alive && CHARACTERS[p.character!].team === 'demon',
  );
  if (!demonAlive) {
    return endGame(s, 'good', 'The Demon is dead.');
  }

  if (alivePlayers(s).length <= 2) {
    return endGame(s, 'evil', 'Only two players remain and the Demon is alive.');
  }

  return false;
}

function endGame(s: GameState, winner: 'good' | 'evil', reason: string): boolean {
  s.winner = winner;
  s.winReason = reason;
  s.phase = 'over';
  s.pending = null;
  s.phaseDeadline = null;
  s.finalGrimoire = true;
  logPublic(s, `${winner === 'good' ? 'GOOD' : 'EVIL'} wins — ${reason}`, true);
  buzzEveryone(s, 'gameover', `${winner === 'good' ? 'Good' : 'Evil'} wins!`, reason);
  s.outbox.push({ k: 'gameover' });
  return true;
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/** Drive time-based transitions. Safe to call every second. */
export function tick(s: GameState, now = Date.now()): boolean {
  const before = s.updatedAt;

  if (s.phase === 'night' && s.pending && now >= s.pending.deadline) {
    autoResolvePrompt(s, now);
    s.updatedAt = now;
    return true;
  }

  if (s.phaseDeadline !== null && now >= s.phaseDeadline) {
    switch (s.phase) {
      case 'reveal':
        beginNight(s, now);
        break;
      case 'dawn':
        beginDiscussion(s, now);
        break;
      case 'day':
        doOpenNominations(s, now);
        break;
      case 'speech':
        nextSpeechStage(s, now);
        break;
      case 'voting':
        if (s.options.votingMode === 'sequential' && s.nomination) {
          // The current voter timed out: count it as an abstention.
          s.nomination.voteIndex++;
          promptSequentialVoter(s, now);
        } else {
          resolveVote(s, now);
        }
        break;
      case 'dusk':
        if (!s.winner) beginNight(s, now);
        else s.phaseDeadline = null;
        break;
      default:
        s.phaseDeadline = null;
    }
    s.updatedAt = now;
    return true;
  }

  return s.updatedAt !== before;
}

export function drainOutbox(s: GameState) {
  const out = s.outbox;
  s.outbox = [];
  return out;
}

export { tokenCharacter };
