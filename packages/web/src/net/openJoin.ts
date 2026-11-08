/** Why the open join (judge rooms: room code, no invite) did not give a session. */
export type OpenJoinFailure = 'notOpen' | 'full' | 'expired' | 'locked' | 'failed';

export type OpenJoinResult =
  | { readonly ok: true; readonly token: string; readonly bidderId: string }
  | { readonly ok: false; readonly reason: OpenJoinFailure };

/** The name sent with the open join. The real name is typed later, on the register page. */
export const OPEN_JOIN_PLACEHOLDER_NAME = 'Guest';

function failureOf(status: number, error: unknown): OpenJoinFailure {
  if (status === 404) return 'notOpen';
  if (status === 410) return 'expired';
  if (status === 429) {
    if (error === 'judge_room_full') return 'full';
    if (error === 'judge_join_locked') return 'locked';
    return 'failed';
  }
  return 'failed';
}

/**
 * Joins a judge room with its short code, with no invite (POST /api/judge/join). A room that is
 * not a judge room answers like an unknown code, so `notOpen` means: ask the host for an invite.
 */
export async function openJoin(
  apiBase: string,
  code: string,
  displayName: string = OPEN_JOIN_PLACEHOLDER_NAME,
): Promise<OpenJoinResult> {
  try {
    const res = await fetch(`${apiBase}/api/judge/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, displayName }),
    });
    const body = (await res.json().catch(() => null)) as {
      sessionToken?: unknown;
      bidderId?: unknown;
      error?: unknown;
    } | null;
    if (res.ok) {
      if (typeof body?.sessionToken === 'string' && typeof body.bidderId === 'string') {
        return { ok: true, token: body.sessionToken, bidderId: body.bidderId };
      }
      return { ok: false, reason: 'failed' };
    }
    return { ok: false, reason: failureOf(res.status, body?.error) };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
