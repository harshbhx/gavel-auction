import localFont from 'next/font/local';

// Newsprint and Signal type, the same three families and the same font files as the web app
// (packages/web/src/design/fonts): Public Sans for the interface and the long reading, Big
// Shoulders Display for the poster headings and numerals (a condensed newspaper headline face),
// JetBrains Mono for code, labels and the diagrams. global.css aliases the older --font-archivo,
// --font-newsreader and --font-martian names onto these so every component keeps working.
export const publicSans = localFont({
  src: './fonts/public-sans-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-public',
  display: 'swap',
});

export const bigShoulders = localFont({
  src: './fonts/big-shoulders-display-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-display',
  display: 'swap',
});

export const jetbrains = localFont({
  src: './fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-jbmono',
  display: 'swap',
});
