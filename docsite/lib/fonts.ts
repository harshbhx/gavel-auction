import { Big_Shoulders_Display, JetBrains_Mono, Public_Sans } from 'next/font/google';

// Newsprint and Signal type, the same three families as the web app (packages/web/src/design):
// Public Sans for the interface and the long reading, Big Shoulders Display for the poster
// headings and numerals (a condensed newspaper-headline face), JetBrains Mono for code, labels
// and the diagrams. global.css aliases the older --font-archivo, --font-newsreader and
// --font-martian names onto these so every component keeps working.
export const publicSans = Public_Sans({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-public',
  display: 'swap',
});

export const bigShoulders = Big_Shoulders_Display({
  subsets: ['latin'],
  weight: ['600', '700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
});

export const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jbmono',
  display: 'swap',
});
