import { useState } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import type { TrailEntry } from './trail';
import { describeEntry, entryTime, type Names } from './trailText';

/** The timeline as plain text, one line each: time, type and the sentence. */
export function timelineText(entries: readonly TrailEntry[], names: Names, title: string): string {
  const lines = entries.map(
    (e) => `${entryTime(e)}  ${t(`audit.kind.${e.kind}`)}: ${describeEntry(e, names)}`,
  );
  return [title, '', ...lines].join('\n');
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface CopyActionsProps {
  entries: readonly TrailEntry[];
  names: Names;
  title: string;
  /** The address to copy; the filtered view is part of it. */
  href: () => string;
}

/** Copy the timeline as text or the link to this exact filtered view. Says what happened. */
export function CopyActions({ entries, names, title, href }: CopyActionsProps) {
  const [note, setNote] = useState<'done' | 'failed' | null>(null);
  const run = (text: string): void => {
    void writeClipboard(text).then((ok) => setNote(ok ? 'done' : 'failed'));
  };
  return (
    <>
      <Button variant="outline" onClick={() => run(timelineText(entries, names, title))}>
        {t('audit.copy.text')}
      </Button>
      <Button variant="outline" onClick={() => run(href())}>
        {t('audit.copy.link')}
      </Button>
      <span className="gv-audit__note" role="status">
        {note === null ? '' : t(note === 'done' ? 'audit.copy.done' : 'audit.copy.failed')}
      </span>
    </>
  );
}
