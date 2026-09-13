import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import * as engine from '../game/engine.js';
import { GameError } from '../game/types.js';
import { viewFor } from '../game/view.js';
import { RoomManager } from './rooms.js';

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.resolve('public');
const rooms = new RoomManager();

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/rooms') {
    const state = rooms.create();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: state.code }));
    return;
  }

  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

interface Conn {
  code: string | null;
  playerId: string | null;
}

function requireHost(state: ReturnType<typeof engine.createGame>, playerId: string): void {
  if (state.hostId !== playerId) throw new GameError('Host only');
}

wss.on('connection', (ws: WebSocket) => {
  const conn: Conn = { code: null, playerId: null };
  const send = (msg: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.on('message', (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    try {
      if (msg.t === 'join' || msg.t === 'auth') {
        const code = String(msg.code || '').toUpperCase();
        const state = rooms.get(code);
        if (!state) {
          send({ t: 'error', message: 'Room not found' });
          return;
        }
        const player =
          msg.t === 'join'
            ? engine.addPlayer(state, String(msg.name || 'Player'))
            : engine.findPlayerByToken(state, String(msg.token || ''));
        if (!player) {
          send({ t: 'error', message: 'Invalid session' });
          return;
        }
        conn.code = code;
        conn.playerId = player.id;
        rooms.attach(code, player.id, ws);
        send({ t: 'identity', playerId: player.id, token: player.token, code });
        send({ t: 'view', view: viewFor(state, player.id) });
        rooms.broadcast(code);
        return;
      }

      if (!conn.code || !conn.playerId) {
        send({ t: 'error', message: 'Not joined' });
        return;
      }
      const state = rooms.get(conn.code);
      if (!state) return;
      const playerId = conn.playerId;

      switch (msg.t) {
        case 'start':
          requireHost(state, playerId);
          engine.startGame(state);
          break;
        case 'declareNeighbor':
          engine.declareNeighbor(state, playerId, String(msg.neighborId));
          break;
        case 'nightReal':
          engine.submitRealResponse(state, playerId, Array.isArray(msg.targetIds) ? (msg.targetIds as string[]) : []);
          break;
        case 'nominate':
          engine.nominate(state, playerId, String(msg.nomineeId));
          break;
        case 'skipSpeech':
          engine.skipSpeech(state, playerId);
          break;
        case 'vote':
          engine.castVote(state, playerId, !!msg.yes);
          break;
        case 'endDay':
          engine.toggleEndDayRequest(state, playerId);
          break;
        case 'slayer':
          engine.useSlayer(state, playerId, String(msg.targetId));
          break;
        default:
          send({ t: 'error', message: `Unknown message type ${String(msg.t)}` });
          return;
      }
      rooms.broadcast(conn.code);
    } catch (err) {
      if (err instanceof GameError) send({ t: 'error', message: err.message });
      else {
        console.error(err);
        send({ t: 'error', message: 'Internal error' });
      }
    }
  });

  ws.on('close', () => {
    if (conn.code && conn.playerId) rooms.detach(conn.code, conn.playerId, ws);
  });
});

setInterval(() => {
  for (const code of rooms.allCodes()) {
    // One room throwing here (a bad tick, a stale/incompatible persisted state, ...) must not
    // stop the other rooms from ticking, and must not crash the whole process — this callback
    // has no caller to catch it, so an uncaught exception here would take the entire server down.
    try {
      const state = rooms.get(code);
      if (!state) continue;
      engine.tick(state, Date.now());
      rooms.broadcast(code);
    } catch (err) {
      console.error(`Error ticking room ${code}`, err);
    }
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`open-botc listening on :${PORT}`);
});
