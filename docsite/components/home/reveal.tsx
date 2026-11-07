'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useReduced } from './use-reduced';
import type { ReactNode } from 'react';

/** Fades and lifts its children in once they scroll into view. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = useReduced();
  // Content is visible in the server HTML and without JavaScript; the entrance only enhances.
  const [enhance, setEnhance] = useState(false);
  useEffect(() => setEnhance(true), []);
  if (reduce || !enhance) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
