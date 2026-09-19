import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { createGame } from '../game/engine.js';
import { GameError } from '../game/types.js';
import { viewFor } from '../game/view.js';
import type { GameState } from '../game/types.js';

// Where rooms are saved between restarts. BOTC_DATA_DIR lets tests use a throwaway folder.
const DEFAULT_DATA_DIR = path.resolve(process.env.BOTC_DATA_DIR || 'data');
/** A room nobody is connected to is forgotten after this long without activity. */
const DEFAULT_TTL_MS = 24 * 3_600_000;
const DEFAULT_MAX_ROOMS = Number(process.env.BOTC_MAX_ROOMS) || 500;

export interface RoomManagerOptions {
  dataDir?: string;
  ttlMs?: number;
  maxRooms?: number;
  /** The clock (ms), injectable for tests. */
  now?: () => number;
}
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Bump this whenever GameState's shape changes. Persisted rooms are just a "survive an
 * incidental restart" convenience, not a durability guarantee — a room saved under an older
 * schema can be missing fields the current code expects, so rather than risk a startup crash
 * (or worse, a crash later mid-game when some code path first touches the missing field), we
 * just discard everything from a mismatched version and start fresh.
 */
export const SCHEMA_VERSION = 6; // 6: night steps are played in rounds (one tap per player per round, tips instead of decoy questions); 5: poison is an effect, Monk/Butler state lives in GameState.data (typed); 4: scripts (scriptId/scriptChars), effects, per-player flags; 3: GameState gained `history` (the replay); 2: night steps wake everyone

interface PersistedFile {
  version: number;
  rooms: Record<string, GameState>;
}

function randomCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return s;
}

export class RoomManager {
  private rooms = new Map<string, GameState>();
  private sockets = new Map<string, Map<string, Set<WebSocket>>>();
  private lastPayload = new Map<string, Map<string, string>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** When each room last saw activity (ms), for expiring abandoned ones. */
  private touched = new Map<string, number>();
  private readonly dataDir: string;
  private readonly roomsFile: string;
  private readonly ttlMs: number;
  private readonly maxRooms: number;
  private readonly now: () => number;

  constructor(opts: RoomManagerOptions = {}) {
    this.dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
    this.roomsFile = path.join(this.dataDir, 'rooms.json');
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxRooms = opts.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.now = opts.now ?? Date.now;
    this.load();
  }

  /** Marks a room as active now. */
  touch(code: string): void {
    this.touched.set(code, this.now());
  }

  /**
   * Deletes rooms nobody is connected to that have been idle longer than the time-to-live (and the
   * data saved for them). Returns the codes removed.
   */
  prune(): string[] {
    const removed: string[] = [];
    for (const code of [...this.rooms.keys()]) {
      // "Connected" means a live socket, not the player's flag (which is stale for a room loaded after a restart).
      const live = [...(this.sockets.get(code)?.values() ?? [])].some((set) => set.size > 0);
      if (live) { this.touch(code); continue; }
      if (this.now() - (this.touched.get(code) ?? 0) <= this.ttlMs) continue;
      this.rooms.delete(code);
      this.sockets.delete(code);
      this.lastPayload.delete(code);
      this.touched.delete(code);
      removed.push(code);
    }
    if (removed.length) this.scheduleSave();
    return removed;
  }

  /** Writes the rooms to disk now (normally done a moment after each change). */
  flush(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.save();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.roomsFile, 'utf8');
      const parsed = JSON.parse(raw) as PersistedFile;
      if (parsed.version !== SCHEMA_VERSION) {
        console.warn(`Discarding persisted rooms from schema v${parsed.version} (current is v${SCHEMA_VERSION})`);
        return;
      }
      // Loaded rooms start their idle clock now: a restart must not instantly expire them.
      for (const [code, state] of Object.entries(parsed.rooms)) { this.rooms.set(code, state); this.touch(code); }
    } catch {
      // no persisted data yet, or it's unreadable — fresh start either way
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 500);
  }

  private save(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const payload: PersistedFile = { version: SCHEMA_VERSION, rooms: Object.fromEntries(this.rooms) };
      fs.writeFileSync(this.roomsFile, JSON.stringify(payload));
    } catch (err) {
      console.error('Failed to persist rooms', err);
    }
  }

  create(): GameState {
    if (this.rooms.size >= this.maxRooms) throw new GameError('The server is full — try again later');
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const state = createGame(code);
    this.rooms.set(code, state);
    this.sockets.set(code, new Map());
    this.touch(code);
    this.scheduleSave();
    return state;
  }

  get(code: string): GameState | undefined {
    return this.rooms.get(code);
  }

  allCodes(): string[] {
    return [...this.rooms.keys()];
  }

  attach(code: string, playerId: string, ws: WebSocket): void {
    let byPlayer = this.sockets.get(code);
    if (!byPlayer) {
      byPlayer = new Map();
      this.sockets.set(code, byPlayer);
    }
    let set = byPlayer.get(playerId);
    if (!set) {
      set = new Set();
      byPlayer.set(playerId, set);
    }
    set.add(ws);
    this.touch(code);
    const player = this.rooms.get(code)?.players.find((p) => p.id === playerId);
    if (player) player.connected = true;
  }

  detach(code: string, playerId: string, ws: WebSocket): void {
    const set = this.sockets.get(code)?.get(playerId);
    set?.delete(ws);
    if (set && set.size === 0) {
      const player = this.rooms.get(code)?.players.find((p) => p.id === playerId);
      if (player) player.connected = false;
      this.broadcast(code);
    }
  }

  /** Stops tracking a player's sockets/last-sent-view entirely — used when they explicitly leave. */
  forgetPlayer(code: string, playerId: string): void {
    this.sockets.get(code)?.delete(playerId);
    this.lastPayload.get(code)?.delete(playerId);
  }

  /**
   * Pushes each player their own filtered view, but only if it actually differs from what
   * they were last sent. Every player's real turn and the 1s timeout-checking tick all end up
   * calling this — without the dedup, a client would receive
   * a fresh (but identical) view roughly every second and re-render, wiping out any
   * in-progress local UI state (a partial night-turn selection, focus on a text input) even
   * though nothing in the game actually changed for that player.
   */
  broadcast(code: string): void {
    const state = this.rooms.get(code);
    const byPlayer = this.sockets.get(code);
    if (!state || !byPlayer) return;
    let cache = this.lastPayload.get(code);
    if (!cache) {
      cache = new Map();
      this.lastPayload.set(code, cache);
    }
    for (const player of state.players) {
      const set = byPlayer.get(player.id);
      if (!set) continue;
      const payload = JSON.stringify({ t: 'view', view: viewFor(state, player.id) });
      if (cache.get(player.id) === payload) continue;
      cache.set(player.id, payload);
      for (const ws of set) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    }
    this.touch(code);
    this.scheduleSave();
  }
}
