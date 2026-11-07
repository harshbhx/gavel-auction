'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * True when the visitor asked for reduced motion. It is false during the server render and the
 * hydration pass, and flips after mount, so the first client render always matches the server
 * HTML (motion's own hook reads the media query on the first client render and would not).
 */
export function useReduced(): boolean {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && reduce === true;
}
