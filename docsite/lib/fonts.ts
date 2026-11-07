import { Archivo, Martian_Mono, Newsreader } from 'next/font/google';

// Type, chosen as a set. Archivo is the interface and the poster voice: its width axis gives a
// heavy condensed face for headings and numerals, like lot numbers and auction bills. Newsreader
// (a text serif drawn for screens, with an optical size axis) carries the long reading, which
// is the one characterful choice: these pages are read like a printed catalogue entry, not a
// dashboard. Martian Mono holds code, labels and the diagrams.
export const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
});

export const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-newsreader',
  display: 'swap',
});

export const martian = Martian_Mono({
  subsets: ['latin'],
  axes: ['wdth'], // the diagrams use the narrow width (75) so labels fit
  variable: '--font-martian',
  display: 'swap',
});
