/** One pop-up per won lot per tab: a reload or a return from the receipt does not show it again. */
export function winnerSeenKey(roomId: string | null, cents: number): string {
  return `gavel.winner.${roomId ?? ''}.${cents}`;
}
export function winnerSeen(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
export function markWinnerSeen(key: string): void {
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    /* storage can be blocked; the pop-up then shows once per mount */
  }
}
