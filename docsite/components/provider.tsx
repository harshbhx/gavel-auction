'use client';
import dynamic from 'next/dynamic';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { type ReactNode } from 'react';

// The search dialog (and the orama engine behind it) is a separate chunk that loads when the
// dialog is first opened, not with every page. scripts/check-size.mjs keeps it that way.
const SearchDialog = dynamic(() => import('@/components/search'), { ssr: false });

export function Provider({ children }: { children: ReactNode }) {
  return <RootProvider search={{ SearchDialog }} theme={{ forcedTheme: 'light', defaultTheme: 'light', enableSystem: false }}>{children}</RootProvider>;
}
