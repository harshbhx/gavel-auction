import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../../src/design/tokens.css';
import '../../../../src/design/themes.css';
import { t } from '../../../../src/copy/t';
import { SandboxBanner } from '../../../../src/design/SandboxBanner';
import { Button } from '../../../../src/design/primitives/Button';
import { FakeApprovalAdapter, type FakeFaultMode } from '../../../../src/payments/fakeAdapter';
import { useApproval } from '../../../../src/payments/useApproval';
import { DemoLauncher } from '../../../../src/screens/demo/DemoLauncher';
import { ShortcutHelp } from '../../../../src/screens/console/ShortcutHelp';
import { VoiceFeed, type MicState } from '../../../../src/screens/console/VoiceFeed';
import { LandingScreen } from '../../../../src/screens/landing/LandingScreen';
import { Approve } from '../../../../src/screens/register/Approve';
import { ErrorBoundary } from '../../../../src/screens/states/ErrorBoundary';

/**
 * Component pages for the screen tour. The dev server serves this file next to the specs, so the
 * real components are drawn with the props that no route passes. Nothing under src imports it and
 * it is not part of any build.
 *
 * Use: /test/screens/support/pages/harness.html?view=<name>
 */

const noop = (): void => undefined;

function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <SandboxBanner />
      {children}
    </>
  );
}

function Landing({ status }: { status: 'busy' | 'down' }) {
  return (
    <Page>
      <LandingScreen
        status={status}
        onStart={noop}
        onScripted={noop}
        onJoin={() => Promise.resolve(true)}
      />
    </Page>
  );
}

/** The launcher after the server made a room; the navigation that follows is left out. */
function DemoLinksList() {
  return (
    <Page>
      <DemoLauncher
        createRoom={() =>
          Promise.resolve({
            console: '/r/demo-room-0001/console',
            screen: '/r/demo-room-0001/screen',
            bidder: '/join/demo-room-0001',
            audit: '/r/demo-room-0001/audit',
          })
        }
        startScripted={() => ({ console: '', screen: '', bidder: '', audit: '' })}
        openConsole={noop}
        writeClipboard={() => Promise.resolve()}
      />
      <StartOnMount />
    </Page>
  );
}

/** Clicks the launcher's start button once it is on screen, as a visitor would. */
function StartOnMount() {
  useEffect(() => {
    const id = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('main[data-route="demo"] > button')?.click();
    }, 50);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}

function Shortcuts() {
  const [open, setOpen] = useState(true);
  return (
    <Page>
      <main data-route="console">
        <h1>{t('console.shortcuts')}</h1>
        <ShortcutHelp open={open} onClose={() => setOpen(false)} />
      </main>
    </Page>
  );
}

const MIC_ENTRIES = [
  {
    id: 'v1',
    text: 'paddle twelve three hundred',
    final: true,
    parse: { bid: { paddle: 12, amountCents: 30_000, confidence: 0.93 } },
  },
  { id: 'v2', text: 'going once at three fifty', final: false, parse: null },
];

function Voice({ mic }: { mic: MicState }) {
  const on = mic === 'live' || mic === 'requesting';
  return (
    <Page>
      <main data-route="console">
        <Button variant="outline">{t(on ? 'console.mic.stop' : 'console.mic.start')}</Button>
        <VoiceFeed mic={mic} level={mic === 'live' ? 0.62 : 0} entries={MIC_ENTRIES} />
      </main>
    </Page>
  );
}

/** The registration approval step on the fake adapter in a fault mode, as VITE_PAYMENTS=fake runs it. */
function ApproveWithFault({ mode }: { mode: FakeFaultMode }) {
  const port = useMemo(
    () =>
      new FakeApprovalAdapter({
        apiBase: 'http://localhost:8787',
        token: 'bidder-token-0001',
        mode,
      }),
    [mode],
  );
  const approval = useApproval({ port, roomId: 'harness-room', bidderId: `harness-${mode}` });
  const { start } = approval;
  useEffect(() => {
    void start(50_000, 'Priya');
  }, [start]);
  return (
    <Page>
      <main data-route="register">
        <Approve
          state={approval.state}
          result={approval.result}
          ceilingCents={50_000}
          onBackToCeiling={noop}
          onRetry={noop}
          onContinue={noop}
        />
      </main>
    </Page>
  );
}

function Crash(): ReactNode {
  throw new Error('screen tour: render failure');
}

function Boundary() {
  return (
    <ErrorBoundary newId={() => 'tour-0001'} onReload={noop}>
      <Crash />
    </ErrorBoundary>
  );
}

function pick(view: string | null): ReactNode {
  switch (view) {
    case 'landing-busy':
      return <Landing status="busy" />;
    case 'landing-down':
      return <Landing status="down" />;
    case 'demo-links':
      return <DemoLinksList />;
    case 'shortcuts':
      return <Shortcuts />;
    case 'voice-requesting':
      return <Voice mic="requesting" />;
    case 'voice-listening':
      return <Voice mic="live" />;
    case 'voice-denied':
      return <Voice mic="denied" />;
    case 'voice-error':
      return <Voice mic="error" />;
    case 'approve-cancelled':
      return <ApproveWithFault mode="cancel" />;
    case 'approve-declined':
      return <ApproveWithFault mode="decline" />;
    case 'error-boundary':
      return <Boundary />;
    default:
      return <p role="status">unknown view</p>;
  }
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(pick(new URLSearchParams(window.location.search).get('view')));
}
