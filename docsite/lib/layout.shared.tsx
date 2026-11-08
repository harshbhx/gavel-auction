import { BookOpenText, FlaskConical } from 'lucide-react';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Wordmark } from '@/components/holdline/wordmark';
import { repoUrl } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Wordmark />,
    },
    // The three-theme switch below replaces the built-in two-state toggle.
    themeSwitch: { enabled: false },
    links: [
      {
        icon: <BookOpenText />,
        text: 'Docs',
        url: '/docs',
        active: 'nested-url',
        on: 'nav',
      },
      {
        icon: <FlaskConical />,
        text: 'Proof',
        url: '/docs/proof',
        active: 'nested-url',
        on: 'nav',
      },
      {
        type: 'custom',
        secondary: true,
        children: (
          <span
            title="Every PayPal call is against the sandbox"
            className="hl-hatch-chip hidden rounded-[2px] px-2 py-0.5 font-mono text-[0.65rem] font-bold tracking-wide uppercase lg:inline-block"
          >
            PayPal sandbox only
          </span>
        ),
      },
    ],
    githubUrl: repoUrl,
  };
}

