/** The first night's Minion info and Demon info (who's evil, plus the Demon's 3 bluffs) only
 * happen with 7 or more players — in smaller games the evil team doesn't learn each other. */
export const EVIL_INTRO_MIN_PLAYERS = 7;

/** Every way an execution kills: the vote, the Virgin, and the Storyteller's execution for madness (the Mutant). */
export const isExecution = (cause: string): boolean => cause === 'execution' || cause === 'virgin' || cause === 'madness';
