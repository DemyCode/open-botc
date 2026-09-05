import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const DATA_DIR = process.env.BOTC_DATA_DIR || path.resolve(process.cwd(), 'data');
const NTFY_URL = (process.env.BOTC_NTFY_URL || 'https://ntfy.sh').replace(/\/$/, '');
const CONTACT = process.env.BOTC_VAPID_CONTACT || 'mailto:botc@example.invalid';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let vapid: VapidKeys | null = null;
let webPushReady = false;

export function initPush(): VapidKeys {
  if (vapid) return vapid;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'vapid.json');

  if (fs.existsSync(file)) {
    vapid = JSON.parse(fs.readFileSync(file, 'utf8')) as VapidKeys;
  } else {
    vapid = webpush.generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(vapid, null, 2));
    console.log(`[push] generated new VAPID keys at ${file}`);
  }

  try {
    webpush.setVapidDetails(CONTACT, vapid.publicKey, vapid.privateKey);
    webPushReady = true;
  } catch (err) {
    console.warn('[push] web-push disabled:', (err as Error).message);
  }
  return vapid;
}

export function vapidPublicKey(): string {
  return initPush().publicKey;
}

export interface Notification {
  title: string;
  body: string;
  tag?: string;
  pattern?: number[];
  url?: string;
}

/** Public origin of this server, so a tapped notification opens the game. */
const PUBLIC_URL = (process.env.BOTC_PUBLIC_URL || '').replace(/\/$/, '');

/**
 * ntfy priority 5 ("max") makes the phone ring and bypasses Do Not Disturb —
 * right for "it is your turn", too much for a routine announcement.
 */
const MAX_PRIORITY_TAGS = new Set(['turn', 'info', 'vote', 'transform', 'reveal', 'test']);

/**
 * Fire an OS-level notification. Returns true if at least one channel accepted
 * it. Failures are logged and swallowed — a missed push must never break the
 * game loop.
 */
export async function sendPush(
  target: { webPush?: unknown; ntfyTopic?: string; confirmed?: boolean } | undefined,
  n: Notification,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  if (!target) return false;
  let ok = false;

  if (target.webPush && webPushReady) {
    try {
      await webpush.sendNotification(
        target.webPush as webpush.PushSubscription,
        JSON.stringify(n),
        { TTL: 120, urgency: 'high' },
      );
      ok = true;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Subscription is gone; caller should drop it.
        target.webPush = undefined;
      } else {
        console.warn('[push] web push failed:', (err as Error).message);
      }
    }
  }

  // A topic is assigned to every player on join, but publishing to one nobody
  // has subscribed to is pure noise on the ntfy server. Wait until the player
  // has confirmed a test buzz — except for the test buzz itself.
  if (target.ntfyTopic && (target.confirmed || opts.force)) {
    try {
      const headers: Record<string, string> = {
        Title: sanitizeHeader(n.title),
        Priority: MAX_PRIORITY_TAGS.has(n.tag ?? '') ? 'max' : 'high',
        Tags: 'bell',
      };
      if (PUBLIC_URL) headers.Click = `${PUBLIC_URL}${n.url ?? '/'}`;

      const res = await fetch(`${NTFY_URL}/${encodeURIComponent(target.ntfyTopic)}`, {
        method: 'POST',
        headers,
        body: n.body,
      });
      if (res.ok) ok = true;
      else console.warn('[push] ntfy returned', res.status);
    } catch (err) {
      console.warn('[push] ntfy failed:', (err as Error).message);
    }
  }

  return ok;
}

/** ntfy sends the title as an HTTP header, so it must stay ASCII and one line. */
function sanitizeHeader(s: string): string {
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, 120)
    .trim() || 'Blood on the Clocktower';
}

export function ntfyBase(): string {
  return NTFY_URL;
}

/**
 * Host portion of the ntfy server, for building `ntfy://host/topic` deep links.
 * Those links open the ntfy app and subscribe in one tap; plain https links
 * cannot do that on Android.
 */
export function ntfyHost(): string {
  try {
    return new URL(NTFY_URL).host;
  } catch {
    return 'ntfy.sh';
  }
}
