/** Closing a judge room: the server call, and the one-line note the landing page shows after it. */

export type CloseResult = 'closed' | 'failed';

/**
 * Stops a running lot and closes the room for everyone. Needs the room's console token.
 * Safe to repeat: the server answers 200 for a room that is already closed.
 */
export async function closeJudgeRoom(
  apiBase: string,
  roomId: string,
  token: string,
): Promise<CloseResult> {
  try {
    const res = await fetch(`${apiBase}/api/judge/rooms/${encodeURIComponent(roomId)}/close`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    return res.ok ? 'closed' : 'failed';
  } catch {
    return 'failed';
  }
}

const NOTE_KEY = 'gavel:notice:room-closed';

/** Remembers, for one page load, that the visitor just closed their room. */
export function rememberRoomClosed(): void {
  try {
    sessionStorage.setItem(NOTE_KEY, '1');
  } catch {
    // No storage: the landing page simply shows no note.
  }
}

/** True once after a close; reading it clears it. */
export function takeRoomClosedNote(): boolean {
  try {
    const on = sessionStorage.getItem(NOTE_KEY) === '1';
    if (on) sessionStorage.removeItem(NOTE_KEY);
    return on;
  } catch {
    return false;
  }
}
