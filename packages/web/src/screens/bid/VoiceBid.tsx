import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Cents, EpochMs } from '@gavel/shared';

import { micSupport } from '../../audio/micCapture';
import { useVoice, type VoiceControls } from '../../audio/useVoice';
import type { VoiceProblem } from '../../audio/voiceController';
import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { useVoiceCapability, type VoiceCapability } from '../../net/voiceCapability';
import { parseUsdToCents } from '../../util/money';
import type { ConfirmRequestMsg } from '../../wire';
import { customHint } from './CustomBid';

// Same sheet as a heard bid: loaded on first use.
const ConfirmSheet = lazy(() =>
  import('./ConfirmSheet').then((m) => ({ default: m.ConfirmSheet })),
);

/** How long a spoken amount waits for the bidder's answer. */
export const VOICE_CONFIRM_MS = 20_000;

/** Ends of a session that are not a failure; the rest get the "could not start" line. */
const PLAIN_ENDS: readonly VoiceProblem[] = ['silence', 'idle', 'maxSession', 'hidden', 'closed'];

const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/;

/** The dollar amount in a transcript, in integer cents, or null when there is none. */
export function amountFromCaption(text: string): number | null {
  const found = AMOUNT.exec(text);
  if (found === null || found[1] === undefined) return null;
  const whole = found[1].replace(/,/g, '');
  return parseUsdToCents(found[2] === undefined ? whole : `${whole}.${found[2]}`);
}

export interface VoiceBidDeps {
  /** What the host says about speech; only `available` shows the button. */
  capability: VoiceCapability;
  /** Null when the browser can take a microphone. */
  support: 'insecure' | 'unsupported' | null;
  voice: Pick<VoiceControls, 'state' | 'press' | 'release' | 'setMode'>;
}

export interface VoiceBidViewProps {
  deps: VoiceBidDeps;
  /** This bidder's paddle, for the confirm question. */
  paddle: number;
  nextMinCents: number;
  ceilingCents: number | null;
  currentCents: number | null;
  /** The guarded send. Called only after the bidder says yes in the confirm sheet. */
  onBid: (cents: number) => void;
  now?: () => number;
}

interface Proposal {
  id: number;
  cents: number;
}

/**
 * The button and the confirm step. A spoken amount is only a proposal: the same hints as a typed
 * amount apply, and a bid is sent only after the bidder confirms in the sheet.
 */
export function VoiceBidView({
  deps,
  paddle,
  nextMinCents,
  ceilingCents,
  currentCents,
  onBid,
  now = Date.now,
}: VoiceBidViewProps) {
  const { capability, support, voice } = deps;
  const { state, setMode } = voice;
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const seen = useRef<object | null>(null);
  const counter = useRef(0);
  const nowRef = useRef(now);
  nowRef.current = now;
  const shown = capability === 'available' && support === null;

  useEffect(() => {
    if (shown) setMode('hold');
  }, [shown, setMode]);

  const caption = state.caption;
  useEffect(() => {
    if (!shown || caption === null || !caption.final || seen.current === caption) return;
    seen.current = caption;
    const cents = amountFromCaption(caption.text);
    if (cents === null) {
      setMessage(t('bid.voice.noAmount'));
      return;
    }
    const hint = customHint(cents, nextMinCents, ceilingCents);
    if (hint !== undefined) {
      setProposal(null);
      setMessage(hint);
      return;
    }
    counter.current += 1;
    setMessage(null);
    setExpiresAt(nowRef.current() + VOICE_CONFIRM_MS);
    setProposal({ id: counter.current, cents });
  }, [shown, caption, nextMinCents, ceilingCents]);

  const request = useMemo<ConfirmRequestMsg | null>(
    () =>
      proposal === null
        ? null
        : {
            v: 1,
            t: 'confirm_request',
            seq: proposal.id,
            ts: EpochMs(expiresAt - VOICE_CONFIRM_MS),
            confirmId: `voice-${proposal.id}`,
            amount: Cents(proposal.cents),
            expiresAt: EpochMs(expiresAt),
          },
    [proposal, expiresAt],
  );

  if (!shown) return null;

  const talking = state.talking;
  const failed = state.problem !== null && !PLAIN_ENDS.includes(state.problem);
  const keyDown = (ev: KeyboardEvent<HTMLButtonElement>): void => {
    if (ev.repeat || (ev.key !== ' ' && ev.key !== 'Enter')) return;
    ev.preventDefault();
    voice.press();
  };
  const keyUp = (ev: KeyboardEvent<HTMLButtonElement>): void => {
    if (ev.key !== ' ' && ev.key !== 'Enter') return;
    ev.preventDefault();
    voice.release();
  };

  return (
    <>
      <Button
        variant="outline"
        size="bid"
        className="bid__voice"
        aria-label={t('bid.voice.aria')}
        aria-pressed={talking}
        onPointerDown={() => voice.press()}
        onPointerUp={() => voice.release()}
        onPointerCancel={() => voice.release()}
        onPointerLeave={() => voice.release()}
        onKeyDown={keyDown}
        onKeyUp={keyUp}
      >
        {t(talking ? 'bid.voice.listening' : 'bid.voice.button')}
      </Button>
      <p className="bid__voicenote">{t('bid.voice.note')}</p>
      {message !== null && (
        <p role="alert" className="bid__voicemsg">
          {message}
        </p>
      )}
      {failed && message === null && (
        <p role="status" className="bid__voicemsg">
          {t('bid.voice.problem')}
        </p>
      )}
      {request !== null && (
        <Suspense fallback={null}>
          <ConfirmSheet
            request={request}
            paddle={paddle}
            currentCents={currentCents}
            now={now}
            onRespond={(_id, accept) => {
              if (accept) onBid(request.amount);
            }}
            onDismiss={() => setProposal(null)}
          />
        </Suspense>
      )}
    </>
  );
}

export interface VoiceBidProps extends Omit<VoiceBidViewProps, 'deps'> {
  apiBase: string;
  roomId: string;
  /** The bidder's token, sent in the first audio message only. */
  token: string;
  closed?: boolean;
}

/** The bidder's microphone, tied to the room's audio socket. Absent without speech or a mic. */
export function VoiceBid({ apiBase, roomId, token, closed = false, ...view }: VoiceBidProps) {
  const capability = useVoiceCapability(apiBase, true);
  const voice = useVoice({ apiBase, roomId, token, closed });
  const support = useMemo(() => micSupport(), []);
  return <VoiceBidView deps={{ capability, support, voice }} {...view} />;
}
