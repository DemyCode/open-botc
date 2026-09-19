// The room registry: rooms survive a restart, but an abandoned room must not live (and be saved) forever,
// and nobody can fill the server with rooms.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { addPlayer } from '../game/engine.js';
import { GameError } from '../game/types.js';
import type { WebSocket } from 'ws';
import { RoomManager, SCHEMA_VERSION } from '../server/rooms.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botc-rooms-'));
const HOUR = 3_600_000;

test('legal: an idle room with nobody connected is deleted after the time-to-live', () => {
  let now = 1_000_000;
  const rooms = new RoomManager({ dataDir: tmp(), ttlMs: 24 * HOUR, now: () => now });
  const room = rooms.create();
  addPlayer(room, 'Ana');
  now += 23 * HOUR;
  assert.deepEqual(rooms.prune(), [], 'still fresh');
  assert.ok(rooms.get(room.code));
  now += 2 * HOUR;
  assert.deepEqual(rooms.prune(), [room.code]);
  assert.equal(rooms.get(room.code), undefined);
});

test('legal: a room loaded after a restart is expired by its sockets, not by players\' stale "connected" flag', () => {
  const dir = tmp();
  let now = 0;
  const a = new RoomManager({ dataDir: dir, now: () => now });
  const room = a.create();
  addPlayer(room, 'Ana'); // connected: true in the saved state, but no socket after the restart
  a.flush();
  const b = new RoomManager({ dataDir: dir, ttlMs: HOUR, now: () => now });
  assert.ok(b.get(room.code), 'loaded');
  now += 2 * HOUR;
  assert.deepEqual(b.prune(), [room.code]);
});

test('legal: activity in a room keeps it alive', () => {
  let now = 0;
  const rooms = new RoomManager({ dataDir: tmp(), ttlMs: 24 * HOUR, now: () => now });
  const room = rooms.create();
  now += 20 * HOUR;
  rooms.touch(room.code);
  now += 20 * HOUR;
  assert.deepEqual(rooms.prune(), []);
  assert.ok(rooms.get(room.code));
});

test('illegal: a room with a live socket is never deleted, however old', () => {
  let now = 0;
  const rooms = new RoomManager({ dataDir: tmp(), ttlMs: HOUR, now: () => now });
  const room = rooms.create();
  const ana = addPlayer(room, 'Ana');
  rooms.attach(room.code, ana.id, { readyState: 1 } as unknown as WebSocket);
  now += 100 * HOUR;
  assert.deepEqual(rooms.prune(), []);
  assert.ok(rooms.get(room.code));
});

test('illegal: past the room cap, creating another room is refused', () => {
  const rooms = new RoomManager({ dataDir: tmp(), maxRooms: 3 });
  for (let i = 0; i < 3; i++) rooms.create();
  assert.throws(() => rooms.create(), GameError);
  assert.equal(rooms.allCodes().length, 3);
});

test('legal: pruning frees room for new ones', () => {
  let now = 0;
  const rooms = new RoomManager({ dataDir: tmp(), maxRooms: 1, ttlMs: HOUR, now: () => now });
  rooms.create();
  assert.throws(() => rooms.create(), GameError);
  now += 2 * HOUR;
  rooms.prune();
  assert.doesNotThrow(() => rooms.create());
});

test('legal: rooms are saved, and a new manager loads them back', async () => {
  const dir = tmp();
  const a = new RoomManager({ dataDir: dir });
  const room = a.create();
  addPlayer(room, 'Ana');
  a.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'rooms.json'), 'utf8'));
  assert.equal(saved.version, SCHEMA_VERSION);
  const b = new RoomManager({ dataDir: dir });
  assert.equal(b.get(room.code)?.players[0].name, 'Ana');
});

test('illegal: a room saved under the previous schema (before poison/Monk/Butler moved) is discarded, not loaded', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'rooms.json'), JSON.stringify({ version: SCHEMA_VERSION - 1, rooms: { OLDR: { code: 'OLDR', players: [], phase: 'night' } } }));
  assert.equal(new RoomManager({ dataDir: dir }).get('OLDR'), undefined);
});
