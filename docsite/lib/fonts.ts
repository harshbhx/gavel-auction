import { Archivo, Martian_Mono } from 'next/font/google';

// Holdline type: Archivo for prose (normal width), the same family condensed for display
// and numerals, Martian Mono for code, labels and sidebar captions.
export const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
});

export const martian = Martian_Mono({
  subsets: ['latin'],
  axes: ['wdth'], // the diagrams use the narrow width (75) so labels fit
  variable: '--font-martian',
  display: 'swap',
});
