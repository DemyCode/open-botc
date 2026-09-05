import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';

import { createGame, drainOutbox, tick } from './game/engine.js';
import { randomRoomCode } from './game/rng.js';
import type { GameState } from './game/types.js';
import { viewFor } from './game/view.js';
import { sendPush } from './push.js';

const DATA_DIR = process.env.BOTC_DATA_DIR || path.resolve(process.cwd(), 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
/** Rooms with no activity for this long are dropped. */
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

export interface Room {
  state: GameState;
  /** playerId → open sockets (a player may have the page open twice). */
  sockets: Map<string, Set<WebSocket>>;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private dirty = false;

  constructor() {
    this.load();
  }

  create(): Room {
    let code = randomRoomCode();
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = randomRoomCode();
    if (this.rooms.has(code)) code = randomRoomCode(6);

    const room: Room = { state: createGame(code), sockets: new Map() };
    this.rooms.set(code, room);
    this.dirty = true;
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase().trim());
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }

  attach(room: Room, playerId: string, ws: WebSocket): void {
    let set = room.sockets.get(playerId);
    if (!set) {
      set = new Set();
      room.sockets.set(playerId, set);
    }
    set.add(ws);
    const p = room.state.players.find((x) => x.id === playerId);
    if (p) {
      p.connected = true;
      p.lastSeen = Date.now();
    }
  }

  detach(room: Room, playerId: string, ws: WebSocket): void {
    const set = room.sockets.get(playerId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      room.sockets.delete(playerId);
      const p = room.state.players.find((x) => x.id === playerId);
      if (p) {
        p.connected = false;
        p.lastSeen = Date.now();
      }
    }
  }

  /** Send every connected player their own filtered view. */
  broadcast(room: Room): void {
    const now = Date.now();
    for (const [playerId, sockets] of room.sockets) {
      const view = viewFor(room.state, playerId, now);
      const msg = JSON.stringify({ t: 'view', view });
      for (const ws of sockets) {
        if (ws.readyState === ws.OPEN) ws.send(msg);
      }
    }
    this.dirty = true;
  }

  /** Deliver buzz/push events queued by the engine. */
  async flush(room: Room): Promise<void> {
    const events = drainOutbox(room.state);
    for (const ev of events) {
      if (ev.k !== 'buzz') continue;

      for (const playerId of ev.playerIds) {
        const sockets = room.sockets.get(playerId);
        const payload = JSON.stringify({
          t: 'buzz',
          title: ev.title,
          body: ev.body,
          pattern: ev.pattern,
          tag: ev.tag,
        });
        let live = false;
        if (sockets) {
          for (const ws of sockets) {
            if (ws.readyState === ws.OPEN) {
              ws.send(payload);
              live = true;
            }
          }
        }

        // Always send an OS push for turn-critical events: the phone may be
        // locked in someone's pocket even while the socket is technically open.
        if (ev.push) {
          const player = room.state.players.find((p) => p.id === playerId);
          if (player?.push) {
            void sendPush(player.push, {
              title: ev.title,
              body: ev.body,
              tag: ev.tag,
              pattern: ev.pattern,
              url: `/#${room.state.code}`,
            });
          } else if (!live) {
            // No push channel and no socket: nothing we can do.
          }
        }
      }
    }
  }

  /** Advance clocks. Returns rooms whose state changed. */
  tickAll(now = Date.now()): Room[] {
    const changed: Room[] = [];
    for (const room of this.rooms.values()) {
      let moved = false;
      // A single tick may cascade (prompt timeout → next step → dawn).
      for (let i = 0; i < 20; i++) {
        if (!tick(room.state, now)) break;
        moved = true;
      }
      if (moved || room.state.outbox.length > 0) changed.push(room);
    }
    return changed;
  }

  sweep(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      const idle = now - Math.max(room.state.updatedAt, room.state.createdAt);
      if (idle > ROOM_TTL_MS && room.sockets.size === 0) {
        this.rooms.delete(code);
        this.dirty = true;
      }
    }
  }

  // ---- persistence -------------------------------------------------------

  save(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const payload = [...this.rooms.values()].map((r) => r.state);
      fs.writeFileSync(ROOMS_FILE, JSON.stringify(payload));
      this.dirty = false;
    } catch (err) {
      console.warn('[rooms] save failed:', (err as Error).message);
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(ROOMS_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')) as GameState[];
      for (const state of raw) {
        // Nobody is connected after a restart.
        for (const p of state.players) p.connected = false;
        state.outbox = [];
        this.rooms.set(state.code, { state, sockets: new Map() });
      }
      console.log(`[rooms] restored ${this.rooms.size} room(s)`);
    } catch (err) {
      console.warn('[rooms] load failed:', (err as Error).message);
    }
  }

  markDirty(): void {
    this.dirty = true;
  }
}
