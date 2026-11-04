/** Remaining milliseconds as "m:ss" (or "h:mm:ss" from one hour). Zero or negative shows "0:00". */
export function formatCountdown(ms: number): string {
  const total = ms > 0 ? Math.ceil(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
  return `${minutes}:${seconds}`;
}
