'use client';

import { LazyMotion } from 'motion/react';
import type { ReactNode } from 'react';

// Motion's animation features load as their own chunk after the page is interactive, and the
// components use the slim `m` element, so the full `motion` bundle is not part of the page's
// first script set. scripts/check-size.mjs watches the total.
const loadFeatures = () => import('./motion-features').then((mod) => mod.default);

export function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={loadFeatures}>{children}</LazyMotion>;
}
