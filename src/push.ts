/**
 * Phone notifications, via ntfy only.
 *
 * ntfy is the single channel on purpose: it rings a locked phone over plain
 * HTTP on a LAN, which browser notifications cannot do without TLS and a
 * permission prompt.
 */

const NTFY_URL = (process.env.BOTC_NTFY_URL || 'https://ntfy.sh').replace(/\/$/, '');

/** Public origin of this server, so a tapped notification opens the game. */
const PUBLIC_URL = (process.env.BOTC_PUBLIC_URL || '').replace(/\/$/, '');

/**
 * ntfy priority 5 ("max") makes the phone ring and bypasses Do Not Disturb —
 * right for "it is your turn", too much for a routine announcement.
 */
const MAX_PRIORITY_TAGS = new Set(['turn', 'info', 'vote', 'transform', 'reveal', 'test']);

export interface PushTargetLike {
  ntfyTopic?: string;
  /** The player pressed "yes, it buzzed" after a test notification. */
  confirmed?: boolean;
}

export interface Notification {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/**
 * Publish a notification. Returns true if ntfy accepted it. Failures are
 * logged and swallowed — a missed buzz must never break the game loop.
 */
export async function sendPush(
  target: PushTargetLike | undefined,
  n: Notification,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  if (!target?.ntfyTopic) return false;

  // A topic is assigned to every player on join, but publishing to one nobody
  // has subscribed to is pure noise on the ntfy server. Wait until the player
  // has confirmed a test buzz — except for the test buzz itself.
  if (!target.confirmed && !opts.force) return false;

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
    if (res.ok) return true;
    console.warn('[ntfy] returned', res.status);
  } catch (err) {
    console.warn('[ntfy] failed:', (err as Error).message);
  }
  return false;
}

/** ntfy sends the title as an HTTP header, so it must stay ASCII and one line. */
function sanitizeHeader(s: string): string {
  return (
    s
      .replace(/[\r\n]+/g, ' ')
      .replace(/[^\x20-\x7e]/g, '')
      .slice(0, 120)
      .trim() || 'Blood on the Clocktower'
  );
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
