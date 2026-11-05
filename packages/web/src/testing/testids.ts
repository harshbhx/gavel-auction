/**
 * The data-testid contract for end-to-end tests (R-WEB-125, T-WEB-059).
 *
 * Every id used by a Playwright spec comes from this map, never from a string typed in the spec.
 * Ids are stable: rename one only together with the element that carries it. The gallery at
 * /gallery renders each id in at least one state, and no id repeats on a page.
 */
export const TEST_IDS = {
  livePolite: 'live-polite',
  liveAssertive: 'live-assertive',
  auditJson: 'audit-json',
  auditScroll: 'audit-scroll',
  consoleColumns: 'console-columns',
  heldBlock: 'held-block',
  screenPrice: 'screen-price',
  hammerStamp: 'hammer-stamp',
  dialogOpen: 'dialog-open',
} as const;

export type TestIdKey = keyof typeof TEST_IDS;
export type TestId = (typeof TEST_IDS)[TestIdKey];
