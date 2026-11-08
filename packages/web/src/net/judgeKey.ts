/**
 * The judge key (a limited key for judges, never the operator key). It is typed into the judge
 * panel, kept in sessionStorage for this tab only, and sent in the `x-judge-key` header. It is
 * never put in a URL, a link fragment, a log line or localStorage.
 */
const STORAGE_KEY = 'gavel.judgeKey';
export const JUDGE_KEY_HEADER = 'x-judge-key';

/** Longest key the field accepts; the host's keys are far shorter. */
export const JUDGE_KEY_MAX_CHARS = 256;

/** The key this tab holds, or null. Storage can be blocked, so every call is guarded. */
export function readJudgeKey(): string | null {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return value === null || value === '' ? null : value;
  } catch {
    return null;
  }
}

export function rememberJudgeKey(key: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Without storage the key lives in the panel until the tab reloads.
  }
}

export function forgetJudgeKey(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** What the host said about a key. */
export type JudgeKeyResult = 'ok' | 'wrong' | 'locked' | 'unreachable';

/** Whether the host offers a judge key at all. Never throws; false hides the key field. */
export async function judgeKeyOffered(apiBase: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/api/judge/capabilities`);
    if (!res.ok) return false;
    const body = (await res.json()) as unknown;
    return (
      typeof body === 'object' && body !== null && (body as { keyed?: unknown }).keyed === true
    );
  } catch {
    return false;
  }
}

/** Asks the host whether a key is right, without making a room. Never throws. */
export async function checkJudgeKey(apiBase: string, key: string): Promise<JudgeKeyResult> {
  try {
    const res = await fetch(`${apiBase}/api/judge/key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [JUDGE_KEY_HEADER]: key },
      body: '{}',
    });
    if (res.ok) return 'ok';
    if (res.status === 401) return 'wrong';
    if (res.status === 429) return 'locked';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}
