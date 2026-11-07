'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/cn';

// Three themes: Daylight (light), Dusk (dark) and Floodlight (projector, on top of dark).
type Mode = 'daylight' | 'dusk' | 'floodlight';

const FLAG = 'gavel-floodlight';

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {
    /* storage can be blocked; the choice then lasts for this page only */
  }
  if (on) document.documentElement.dataset.floodlight = '1';
  else delete document.documentElement.dataset.floodlight;
}

export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [flood, setFlood] = useState(false);

  useEffect(() => {
    setMounted(true);
    setFlood(readFlag());
  }, []);

  // Floodlight only makes sense on dark.
  useEffect(() => {
    if (mounted && flood && resolvedTheme && resolvedTheme !== 'dark') setTheme('dark');
  }, [mounted, flood, resolvedTheme, setTheme]);

  const pick = useCallback(
    (mode: Mode) => {
      writeFlag(mode === 'floodlight');
      setFlood(mode === 'floodlight');
      setTheme(mode === 'daylight' ? 'light' : 'dark');
    },
    [setTheme],
  );

  const current: Mode | null = !mounted
    ? null
    : flood
      ? 'floodlight'
      : resolvedTheme === 'dark'
        ? 'dusk'
        : 'daylight';

  const items: Array<{ mode: Mode; label: string; hint: string }> = [
    { mode: 'daylight', label: 'Daylight', hint: 'Light theme' },
    { mode: 'dusk', label: 'Dusk', hint: 'Dark theme' },
    { mode: 'floodlight', label: 'Floodlight', hint: 'High contrast projector theme' },
  ];

  return (
    <div role="group" aria-label="Theme" className="inline-flex overflow-hidden rounded-[2px] border">
      {items.map((it) => (
        <button
          key={it.mode}
          type="button"
          title={it.hint}
          aria-pressed={current === it.mode}
          onClick={() => pick(it.mode)}
          className={cn(
            'px-2 py-1 font-mono text-[0.65rem] font-bold tracking-wide uppercase transition-colors',
            current === it.mode
              ? 'bg-[var(--hl-signal)] text-[var(--hl-on-signal)]'
              : 'text-fd-muted-foreground hover:text-fd-foreground',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
