/**
 * The vibration vocabulary.
 *
 * A phone vibrates only to wake somebody who cannot otherwise be reached —
 * nothing else. In practice that means the night, plus dawn:
 *
 *   YOUR TURN   two taps then a long hold  — the night needs your ability
 *   YOU LEARNED two medium pulses          — the night woke you with information
 *   YOU CHANGED a run then a hold          — you are the Demon now
 *   DAWN        two slow spaced pulses     — everyone, open your eyes
 *
 * Daytime events are deliberately silent. Everybody is awake, in the same room,
 * holding their phone and able to hear each other: a nomination is announced by
 * the person making it, and the screen updates anyway. Vibrating for public
 * events that need no action teaches people to ignore the buzz, and then the
 * one that matters — your night turn — gets missed.
 *
 * The patterns are designed to be told apart *without looking*, since a player
 * feeling one has their eyes shut.
 *
 * A locked phone is a different matter: there, vibration is a property of the
 * Android notification channel and cannot be set by the sender. Players are
 * told to put the phone on vibrate, which is the setting that matters.
 *
 * Nothing here ever makes a sound, and nothing may be added that does. Everyone
 * is in the same room: a noise when the night wakes you tells the whole table
 * who is acting, which is the one secret the game rests on.
 */

export type BuzzKind =
  | 'turn'
  | 'info'
  | 'reveal'
  | 'nomination'
  | 'speech'
  | 'vote'
  | 'voteresult'
  | 'death'
  | 'dawn'
  | 'night'
  | 'transform'
  | 'gameover';

export interface BuzzSpec {
  /** Alternating vibrate/pause milliseconds, as the Vibration API wants. */
  pattern: number[];
  /** Shown in the in-app legend. */
  label: string;
  /** One line explaining when it fires. */
  meaning: string;
  /**
   * Does this event actually need the player? Only `wake: true` events vibrate
   * a phone or send a notification.
   *
   * A buzz has to mean "the game is waiting on you". Vibrating for vote tallies
   * and speech changes trains people to ignore it, and then the one buzz that
   * matters — your night turn — gets lost. Everything else still updates the
   * screen; it just does so quietly.
   */
  wake: boolean;
}

export const BUZZ: Record<BuzzKind, BuzzSpec> = {
  // Two taps and a long hold. Nothing else ends sustained, so this reads as
  // "stop what you are doing" even through a pocket.
  turn: {
    pattern: [180, 120, 180, 120, 1000],
    label: 'Your turn',
    meaning: 'The night needs you — open your phone and choose.',
    wake: true,
  },
  info: {
    pattern: [350, 200, 350],
    label: 'You learned something',
    meaning: 'Private information arrived. Read it in the You tab.',
    wake: true,
  },
  reveal: {
    pattern: [700, 250, 300],
    label: 'Your character',
    meaning: 'The game has started and you have been dealt a role.',
    wake: false,
  },
  // Silent: everybody is awake and the nominator says it out loud.
  nomination: {
    pattern: [110, 90, 110, 90, 110, 90, 110, 90, 110],
    label: 'Someone is accused',
    meaning: 'A nomination was made. Listen to the accuser, then the accused.',
    wake: false,
  },
  speech: {
    pattern: [200, 150, 200],
    label: 'Speaker changed',
    meaning: 'The accused is now defending themselves.',
    wake: false,
  },
  vote: {
    pattern: [300, 150, 300, 150, 300],
    label: 'Vote now',
    meaning: 'Raise your hand on your phone: execute, or not.',
    wake: false,
  },
  voteresult: {
    pattern: [200, 100, 200],
    label: 'Vote counted',
    meaning: 'The result of the vote.',
    wake: false,
  },
  // The only single sustained pulse. Silent: a night death is already carried
  // by the dawn buzz, and an execution happens while everyone is watching.
  death: {
    pattern: [1500],
    label: 'Someone died',
    meaning: 'An execution, or a death in the night.',
    wake: false,
  },
  dawn: {
    pattern: [600, 400, 600],
    label: 'Day breaks',
    meaning: 'Open your eyes. The morning report is on your phone.',
    wake: true,
  },
  night: {
    pattern: [900],
    label: 'Night falls',
    meaning: 'Close your eyes and put the phone down.',
    wake: false,
  },
  transform: {
    pattern: [250, 150, 250, 150, 250, 150, 900],
    label: 'You have changed',
    meaning: 'Your character became something else.',
    wake: true,
  },
  gameover: {
    pattern: [150, 100, 150, 100, 150, 100, 150, 100, 1200],
    label: 'Game over',
    meaning: 'Good or evil has won.',
    wake: false,
  },
};

export function pattern(kind: BuzzKind): number[] {
  return BUZZ[kind].pattern;
}

export function wakes(kind: BuzzKind): boolean {
  return BUZZ[kind].wake;
}

/**
 * The buzzes a player can actually receive, for the in-app legend. Silent
 * events are left out — there is nothing for a player to learn about them.
 */
export function buzzCatalogue() {
  return (Object.keys(BUZZ) as BuzzKind[])
    .filter((k) => BUZZ[k].wake)
    .map((k) => ({ kind: k, ...BUZZ[k] }));
}
