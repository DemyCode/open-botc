/**
 * Phone notifications, via ntfy only.
 *
 * ntfy is the single channel on purpose: it buzzes a locked phone over plain
 * HTTP on a LAN, which browser notifications cannot do without TLS and a
 * permission prompt.
 */

const RAW_NTFY = process.env.BOTC_NTFY_URL ?? 'https://ntfy.sh';
/** Set BOTC_NTFY_URL to "off" (or empty) to suppress all outbound pushes. */
const DISABLED = RAW_NTFY === '' || RAW_NTFY.toLowerCase() === 'off';
const NTFY_URL = RAW_NTFY.replace(/\/$/, '');

/** A push must never outlive the phase it belongs to. */
const REQUEST_TIMEOUT_MS = 4000;

/**
 * If ntfy is unreachable, stop hammering it. Every in-flight request costs a
 * socket and a timer, and a game with 15 players generates a burst of them per
 * phase — enough to starve the tick loop and stall the game itself.
 */
const TRIP_AFTER_FAILURES = 5;
const COOLDOWN_MS = 60_000;
let consecutiveFailures = 0;
let mutedUntil = 0;

function noteFailure(reason: string): void {
  consecutiveFailures++;
  if (consecutiveFailures === TRIP_AFTER_FAILURES) {
    mutedUntil = Date.now() + COOLDOWN_MS;
    console.warn(
      `[ntfy] ${TRIP_AFTER_FAILURES} failures in a row (${reason}); ` +
        `pausing notifications for ${COOLDOWN_MS / 1000}s`,
    );
  } else if (consecutiveFailures < TRIP_AFTER_FAILURES) {
    console.warn(`[ntfy] ${reason}`);
  }
}

function noteSuccess(): void {
  if (consecutiveFailures >= TRIP_AFTER_FAILURES) {
    console.log('[ntfy] notifications working again');
  }
  consecutiveFailures = 0;
  mutedUntil = 0;
}

/** Public origin of this server, so a tapped notification opens the game. */
const PUBLIC_URL = (process.env.BOTC_PUBLIC_URL || '').replace(/\/$/, '');

/**
 * Everything this game sends is time-critical — a player in a dark room has to
 * notice it. ntfy priority 5 ("max") is the only level the Android app treats
 * as insistent, so it is what actually vibrates reliably; priority 4 lands in a
 * quieter notification channel that many phones (Samsung especially) leave
 * silent. Vibration itself is a property of the Android channel and cannot be
 * set by the sender, so the priority is the whole lever we have.
 */
const PRIORITY = 'max';

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
  if (DISABLED || !target?.ntfyTopic) return false;

  // A topic is assigned to every player on join, but publishing to one nobody
  // has subscribed to is pure noise on the ntfy server. Wait until the player
  // has confirmed a test buzz — except for the test buzz itself.
  if (!target.confirmed && !opts.force) return false;

  // A forced send is a user pressing "test", so let it through to re-probe.
  if (Date.now() < mutedUntil && !opts.force) return false;

  try {
    const headers: Record<string, string> = {
      Title: sanitizeHeader(n.title),
      Priority: PRIORITY,
      Tags: 'bell',
    };
    if (PUBLIC_URL) headers.Click = `${PUBLIC_URL}${n.url ?? '/'}`;

    const res = await fetch(`${NTFY_URL}/${encodeURIComponent(target.ntfyTopic)}`, {
      method: 'POST',
      headers,
      body: n.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) {
      noteSuccess();
      return true;
    }
    noteFailure(`server returned ${res.status}`);
  } catch (err) {
    noteFailure((err as Error).message);
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
