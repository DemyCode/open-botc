import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import QRCode from 'qrcode';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  GameError,
  addPlayer,
  castVote,
  endSpeech,
  markReady,
  moveSeat,
  nominate,
  openNominations,
  removePlayer,
  requestEndDay,
  resetToLobby,
  setOptions,
  slay,
  startGame,
  submitNightChoice,
} from './game/engine.js';
import { characterCatalogue, viewFor } from './game/view.js';
import { initPush, ntfyBase, ntfyHost, sendPush, vapidPublicKey } from './push.js';
import { RoomManager, type Room } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

initPush();

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      // The service worker must not be cached aggressively.
      if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

const rooms = new RoomManager();

app.post('/api/rooms', (_req, res) => {
  const room = rooms.create();
  res.json({ code: room.state.code });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: 'No such room.' });
  res.json({
    code: room.state.code,
    phase: room.state.phase,
    players: room.state.players.length,
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    vapidPublicKey: vapidPublicKey(),
    ntfyBase: ntfyBase(),
    ntfyHost: ntfyHost(),
    characters: characterCatalogue(),
  });
});

app.get('/api/qr', async (req, res) => {
  const data = String(req.query.d || '');
  if (!data || data.length > 512) return res.status(400).send('bad data');
  try {
    const svg = await QRCode.toString(data, {
      type: 'svg',
      margin: 1,
      color: { dark: '#0b0d12', light: '#ffffff' },
    });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch {
    res.status(500).send('qr failed');
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface Session {
  room: Room | null;
  playerId: string | null;
}

const sessions = new WeakMap<WebSocket, Session>();

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, message: string): void {
  send(ws, { t: 'error', message });
}

async function settle(room: Room): Promise<void> {
  rooms.broadcast(room);
  await rooms.flush(room);
  room.state.updatedAt = Date.now();
  rooms.markDirty();
}

wss.on('connection', (ws) => {
  sessions.set(ws, { room: null, playerId: null });

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return sendError(ws, 'Malformed message.');
    }
    const session = sessions.get(ws);
    if (!session) return;

    try {
      await handle(ws, session, msg);
    } catch (err) {
      if (err instanceof GameError) sendError(ws, err.message);
      else {
        console.error('[ws] handler error:', err);
        sendError(ws, 'Something went wrong.');
      }
      if (session.room) rooms.broadcast(session.room);
    }
  });

  ws.on('close', () => {
    const session = sessions.get(ws);
    if (session?.room && session.playerId) {
      rooms.detach(session.room, session.playerId, ws);
      rooms.broadcast(session.room);
    }
  });

  ws.on('error', () => {
    /* handled by close */
  });
});

async function handle(
  ws: WebSocket,
  session: Session,
  msg: Record<string, unknown>,
): Promise<void> {
  const t = String(msg.t || '');

  // ---- session establishment
  if (t === 'join' || t === 'auth') {
    const code = String(msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return sendError(ws, `No room called "${code}".`);

    let playerId: string;
    if (t === 'auth') {
      const token = String(msg.token || '');
      const player = room.state.players.find((p) => p.token === token);
      if (!player) return sendError(ws, 'expired');
      playerId = player.id;
    } else {
      const player = addPlayer(room.state, String(msg.name || ''));
      playerId = player.id;
      send(ws, { t: 'identity', code: room.state.code, token: player.token, playerId });
    }

    if (session.room && session.playerId) {
      rooms.detach(session.room, session.playerId, ws);
    }
    session.room = room;
    session.playerId = playerId;
    rooms.attach(room, playerId, ws);

    if (t === 'auth') {
      const player = room.state.players.find((p) => p.id === playerId)!;
      send(ws, { t: 'identity', code: room.state.code, token: player.token, playerId });
    }
    await settle(room);
    return;
  }

  const { room, playerId } = session;
  if (!room || !playerId) return sendError(ws, 'Join a room first.');
  const s = room.state;

  switch (t) {
    case 'ping':
      return send(ws, { t: 'pong' });

    case 'push': {
      const player = s.players.find((p) => p.id === playerId);
      if (!player) return;
      player.push = player.push || {};
      if (msg.webPush !== undefined) player.push.webPush = msg.webPush || undefined;
      if (msg.ntfyTopic !== undefined) {
        const topic = String(msg.ntfyTopic || '').trim();
        player.push.ntfyTopic = topic || undefined;
      }
      rooms.markDirty();
      await settle(room);
      return send(ws, { t: 'pushOk' });
    }

    case 'testBuzz': {
      const player = s.players.find((p) => p.id === playerId);
      if (!player?.push) return sendError(ws, 'No notification channel set up.');
      const delivered = await sendPush(
        player.push,
        {
          title: '🩸 Clocktower test',
          body: `This is how your phone will buzz, ${player.name}.`,
          tag: 'test',
          pattern: [500, 150, 500, 150, 500],
          url: `/#${s.code}`,
        },
        { force: true },
      );
      return send(ws, { t: 'testBuzzResult', delivered });
    }

    case 'pushConfirmed': {
      const player = s.players.find((p) => p.id === playerId);
      if (!player?.push) return;
      player.push.confirmed = Boolean(msg.ok);
      rooms.markDirty();
      break;
    }

    case 'setOptions':
      setOptions(s, playerId, (msg.options || {}) as never);
      break;

    case 'moveSeat':
      if (s.hostId !== playerId) throw new GameError('Only the host can reorder seats.');
      moveSeat(s, String(msg.playerId || ''), Number(msg.delta || 0));
      break;

    case 'kick':
      if (s.hostId !== playerId) throw new GameError('Only the host can remove players.');
      removePlayer(s, String(msg.playerId || ''));
      break;

    case 'leave':
      removePlayer(s, playerId);
      session.room = null;
      session.playerId = null;
      rooms.detach(room, playerId, ws);
      rooms.broadcast(room);
      return send(ws, { t: 'left' });

    case 'start':
      startGame(s, playerId);
      break;

    case 'ready':
      markReady(s, playerId);
      break;

    case 'choose':
      submitNightChoice(
        s,
        playerId,
        String(msg.promptId || ''),
        (msg.targets as string[]) || [],
      );
      break;

    case 'openNominations':
      openNominations(s, playerId);
      break;

    case 'nominate':
      nominate(s, playerId, String(msg.targetId || ''));
      break;

    case 'endSpeech':
      endSpeech(s, playerId);
      break;

    case 'vote':
      castVote(s, playerId, Boolean(msg.vote));
      break;

    case 'slay':
      slay(s, playerId, String(msg.targetId || ''));
      break;

    case 'endDay':
      requestEndDay(s, playerId);
      break;

    case 'playAgain':
      resetToLobby(s, playerId);
      break;

    default:
      return sendError(ws, `Unknown action "${t}".`);
  }

  await settle(room);
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

setInterval(() => {
  const changed = rooms.tickAll();
  for (const room of changed) void settle(room);
}, 500);

setInterval(() => {
  rooms.sweep();
  rooms.save();
}, 15_000);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    rooms.save();
    process.exit(0);
  });
}

server.listen(PORT, HOST, () => {
  const urls = localUrls(PORT);
  console.log('');
  console.log('  🩸 open-botc — Trouble Brewing, self-hosted');
  console.log('');
  for (const u of urls) console.log(`     ${u}`);
  console.log('');
  console.log('  Open one of the LAN addresses on every phone in the room.');
  if (!fs.existsSync(PUBLIC_DIR)) {
    console.warn(`  ! public/ not found at ${PUBLIC_DIR}`);
  }
  console.log('');
});

function localUrls(port: number): string[] {
  const out = [`http://localhost:${port}`];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        out.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return out;
}
