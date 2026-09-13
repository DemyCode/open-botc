import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { createGame } from '../game/engine.js';
import { viewFor } from '../game/view.js';
import type { GameState } from '../game/types.js';

const DATA_DIR = path.resolve('data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

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

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(ROOMS_FILE, 'utf8');
      const data = JSON.parse(raw) as Record<string, GameState>;
      for (const [code, state] of Object.entries(data)) this.rooms.set(code, state);
    } catch {
      // no persisted data yet — fresh start
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(ROOMS_FILE, JSON.stringify(Object.fromEntries(this.rooms)));
      } catch (err) {
        console.error('Failed to persist rooms', err);
      }
    }, 500);
  }

  create(): GameState {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const state = createGame(code);
    this.rooms.set(code, state);
    this.sockets.set(code, new Map());
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

  /**
   * Pushes each player their own filtered view, but only if it actually differs from what
   * they were last sent. Every player's real turn, the night decoy round, and the 1s
   * timeout-checking tick all end up calling this — without the dedup, a client would receive
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
    this.scheduleSave();
  }
}
