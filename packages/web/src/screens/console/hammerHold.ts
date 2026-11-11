/**
 * How long the hammer must be held before the lot closes. The desk hold, the Hammer dialog and
 * the words that name the time all read this one value, so the page can not promise one time
 * and confirm after another.
 */
export const HAMMER_HOLD_MS = 3000;

/** The same time in whole seconds, for the copy. */
export const HAMMER_HOLD_SECONDS = Math.round(HAMMER_HOLD_MS / 1000);
