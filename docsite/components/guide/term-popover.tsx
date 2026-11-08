'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// The definition popover behind <Term>. It opens on hover, on keyboard focus and on tap or click
// (a click pins it open; a second click, Escape or a click elsewhere closes it). It is a
// disclosure, not a tooltip: it holds a link, so it stays open while the pointer or focus is
// inside it. Motion is a short fade and only when the visitor has not asked for reduced motion
// (see .hl-term-pop in app/global.css).
const OPEN_DELAY = 120;
const CLOSE_DELAY = 220;

export function TermPopover({
  term,
  short,
  href,
  children,
}: {
  term: string;
  short: string;
  href: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [place, setPlace] = useState<{ x: number; above: boolean }>({ x: 0, above: false });
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popId = useId();

  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const close = () => {
    clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  // Keep the popover inside the viewport: shift sideways, flip above when there is no room below.
  useLayoutEffect(() => {
    if (!open || !pop.current || !wrap.current) return;
    const box = pop.current.getBoundingClientRect();
    const anchor = wrap.current.getBoundingClientRect();
    const margin = 12;
    // clientWidth is the layout viewport: window.innerWidth grows on a phone when something
    // overflows (the page zooms out to fit it), which would hide exactly the overflow we fix.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let x = 0;
    if (box.right > vw - margin) x = vw - margin - box.right;
    if (box.left + x < margin) x = margin - box.left;
    const above = box.bottom > vh - margin && anchor.top - box.height - 8 > margin;
    setPlace((p) => (p.x === x && p.above === above ? p : { x, above }));
  }, [open]);

  // Escape closes; a press outside closes a pinned popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        wrap.current?.querySelector('button')?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <span
      ref={wrap}
      className="hl-term"
      onMouseEnter={() => later(() => setOpen(true), OPEN_DELAY)}
      onMouseLeave={() => {
        if (!pinned) later(() => setOpen(false), CLOSE_DELAY);
      }}
      onFocus={() => {
        clearTimeout(timer.current);
        setOpen(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <button
        type="button"
        className="hl-term-btn"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-haspopup="dialog"
        onClick={() => {
          if (pinned) close();
          else {
            clearTimeout(timer.current);
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        {children}
      </button>
      {open && (
        <span
          ref={pop}
          id={popId}
          role="dialog"
          aria-label={`Definition: ${term}`}
          className="hl-term-pop not-prose"
          data-above={place.above || undefined}
          style={{ transform: place.x ? `translateX(${place.x}px)` : undefined }}
        >
          <span className="hl-term-pop__name">{term}</span>
          <span className="hl-term-pop__text">{short}</span>
          <Link href={href} className="hl-term-pop__link">
            Glossary entry
          </Link>
        </span>
      )}
    </span>
  );
}
