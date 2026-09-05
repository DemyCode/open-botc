/**
 * The vibration vocabulary.
 *
 * These patterns drive `navigator.vibrate()` in the page. They are designed to
 * be told apart *without looking* — a player with their eyes shut should know
 * whether the night wants them or somebody just got accused. So each one has a
 * distinct rhythmic shape rather than a distinct length:
 *
 *   YOUR TURN   two taps then a long hold   — the only one that ends sustained
 *   ACCUSATION  five fast taps              — the only rapid one
 *   VOTE        three even pulses
 *   DEATH       one long hold               — the only single pulse
 *   DAWN        two slow spaced pulses
 *
 * A locked phone is a different matter: there, vibration is a property of the
 * Android notification channel and cannot be set by the sender. The bell sound
 * in public/bell.wav is what makes those unmistakable — see the setup card.
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
}

export const BUZZ: Record<BuzzKind, BuzzSpec> = {
  // Two taps and a long hold. Nothing else ends sustained, so this reads as
  // "stop what you are doing" even through a pocket.
  turn: {
    pattern: [180, 120, 180, 120, 1000],
    label: 'Your turn',
    meaning: 'The night needs you — open your phone and choose.',
  },
  info: {
    pattern: [350, 200, 350],
    label: 'You learned something',
    meaning: 'Private information arrived. Read it in the You tab.',
  },
  reveal: {
    pattern: [700, 250, 300],
    label: 'Your character',
    meaning: 'The game has started and you have been dealt a role.',
  },
  // The only rapid pattern: unmistakable urgency, everybody feels it at once.
  nomination: {
    pattern: [110, 90, 110, 90, 110, 90, 110, 90, 110],
    label: 'Someone is accused',
    meaning: 'A nomination was made. Listen to the accuser, then the accused.',
  },
  speech: {
    pattern: [200, 150, 200],
    label: 'Speaker changed',
    meaning: 'The accused is now defending themselves.',
  },
  vote: {
    pattern: [300, 150, 300, 150, 300],
    label: 'Vote now',
    meaning: 'Raise your hand on your phone: execute, or not.',
  },
  voteresult: {
    pattern: [200, 100, 200],
    label: 'Vote counted',
    meaning: 'The result of the vote.',
  },
  // The only single sustained pulse.
  death: {
    pattern: [1500],
    label: 'Someone died',
    meaning: 'An execution, or a death in the night.',
  },
  dawn: {
    pattern: [600, 400, 600],
    label: 'Day breaks',
    meaning: 'Open your eyes. The morning report is on your phone.',
  },
  night: {
    pattern: [900],
    label: 'Night falls',
    meaning: 'Close your eyes and put the phone down.',
  },
  transform: {
    pattern: [250, 150, 250, 150, 250, 150, 900],
    label: 'You have changed',
    meaning: 'Your character became something else.',
  },
  gameover: {
    pattern: [150, 100, 150, 100, 150, 100, 150, 100, 1200],
    label: 'Game over',
    meaning: 'Good or evil has won.',
  },
};

export function pattern(kind: BuzzKind): number[] {
  return BUZZ[kind].pattern;
}

/** Served to the client so it can render the legend and let players feel each one. */
export function buzzCatalogue() {
  return (Object.keys(BUZZ) as BuzzKind[]).map((k) => ({
    kind: k,
    ...BUZZ[k],
  }));
}
