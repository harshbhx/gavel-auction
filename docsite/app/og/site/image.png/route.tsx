import { ogImage } from '@/lib/og';

export const dynamic = 'force-static';

export function GET() {
  return ogImage({
    title: 'Every bid is a PayPal hold. Only the winner pays.',
    description: 'What is proven on the PayPal sandbox, what is simulated, and what is still open.',
    kicker: 'Documentation',
  });
}
