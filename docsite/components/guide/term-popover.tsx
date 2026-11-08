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
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
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

  // The popover is position: fixed and placed from the term's own rectangle, clamped to the
  // viewport: sideways it never leaves the screen, and it flips above the term when there is no
  // room below. Fixed elements add no scrollable overflow, so a phone never zooms out to fit it.
  // It follows the term on scroll and resize, and closes once the term has scrolled out of view.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = wrap.current?.querySelector('button');
      const box = pop.current;
      if (!btn || !box) return;
      const r = btn.getClientRects()[0] ?? btn.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      if (r.bottom < 0 || r.top > vh) {
        close();
        return;
      }
      const margin = 12;
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const left = Math.max(margin, Math.min(r.left, vw - margin - w));
      let top = r.bottom + 6;
      if (top + h > vh - margin && r.top - h - 6 > margin) top = r.top - h - 6;
      setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
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
          style={{ left: pos.left, top: pos.top }}
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
