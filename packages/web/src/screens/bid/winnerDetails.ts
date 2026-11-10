/** What the winner typed into the pop-up. It lives in this browser only and is never sent anywhere. */
export interface WinnerDetails {
  email: string;
  phone: string;
  savedAt: number;
}

export function winnerDetailsKey(roomId: string): string {
  return `gavel:winner:${roomId}`;
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** 7 to 15 digits; spaces, plus and dashes are allowed around them. */
export function isPhone(v: string): boolean {
  if (!/^[0-9 +-]+$/.test(v)) return false;
  const digits = v.replace(/[^0-9]/g, '').length;
  return digits >= 7 && digits <= 15;
}

export function saveWinnerDetails(roomId: string, email: string, phone: string): boolean {
  try {
    const rec: WinnerDetails = { email, phone, savedAt: Date.now() };
    window.localStorage.setItem(winnerDetailsKey(roomId), JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

export function readWinnerDetails(roomId: string): WinnerDetails | null {
  try {
    const raw = window.localStorage.getItem(winnerDetailsKey(roomId));
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const r = v as Record<string, unknown>;
    if (typeof r.email !== 'string' || typeof r.phone !== 'string') return null;
    if (typeof r.savedAt !== 'number') return null;
    return { email: r.email, phone: r.phone, savedAt: r.savedAt };
  } catch {
    return null;
  }
}
