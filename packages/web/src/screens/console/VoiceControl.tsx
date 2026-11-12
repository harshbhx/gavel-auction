import { useMemo, type KeyboardEvent } from 'react';
import { micSupport } from '../../audio/micCapture';
import { useVoice } from '../../audio/useVoice';
import {
  MAX_HOLD_MS,
  MAX_SESSION_MS,
  SILENCE_CUTOFF_MS,
  type VoiceProblem,
  type VoiceState,
} from '../../audio/voiceController';
import { t } from '../../copy/t';
import { ActionGroup } from '../../design/primitives/ActionGroup';
import { Button } from '../../design/primitives/Button';
import { useVoiceCapability, type VoiceCapability } from '../../net/voiceCapability';
import { VoiceFeed, type MicState, type VoiceFeedEntry } from './VoiceFeed';

export interface VoiceControlProps {
  /** HTTP origin of the API; the audio socket is on the same host. */
  readonly apiBase: string;
  readonly roomId: string;
  /** Auctioneer token. Sent in the first socket message only. */
  readonly token: string;
  /** The lot is closed or stopped: the microphone is released and cannot be turned on. */
  readonly closed: boolean;
  /** The scripted demo has no server to listen to. */
  readonly scripted?: boolean;
  readonly entries: readonly VoiceFeedEntry[];
}

const MIC_PROBLEMS: readonly VoiceProblem[] = [
  'denied',
  'nomic',
  'busy',
  'unsupported',
  'insecure',
  'error',
];

function micStateOf(state: VoiceState): MicState {
  if (state.phase === 'asking') return 'requesting';
  if (state.phase === 'connecting') return 'connecting';
  if (state.phase === 'ready') return state.talking ? 'live' : 'armed';
  const p = state.problem;
  if (p !== null && MIC_PROBLEMS.includes(p)) return p as MicState;
  return 'off';
}

/** The words for a problem the microphone row does not already say. Null when there are none. */
function problemText(problem: VoiceProblem | null): string | null {
  switch (problem) {
    case null:
    case 'busy':
    case 'nomic':
    case 'unsupported':
    case 'insecure':
    case 'error':
      return null;
    case 'denied':
      return t('console.mic.deniedHelp');
    case 'silence':
      return t('console.voice.p.silence', { s: SILENCE_CUTOFF_MS / 1000 });
    case 'maxSession':
      return t('console.voice.p.maxSession', { m: MAX_SESSION_MS / 60_000 });
    case 'idle':
      return t('console.voice.p.idle');
    case 'hidden':
      return t('console.voice.p.hidden');
    case 'closed':
      return t('console.voice.p.closed');
    case 'unauthorized':
      return t('console.voice.p.unauthorized');
    case 'badFrame':
      return t('console.voice.p.badFrame');
    case 'rate':
      return t('console.voice.p.rate');
    case 'ended':
      return t('console.voice.p.ended');
    case 'streamBusy':
      return t('console.voice.p.streamBusy');
    case 'notFound':
      return t('console.voice.p.notFound');
    case 'server':
      return t('console.voice.p.server');
    case 'lost':
      return t('console.voice.p.lost');
  }
}

/** Plain words for what became of a spoken utterance. A held bid's amount is never shown here. */
export function outcomeText(o: NonNullable<VoiceState['outcome']>): string {
  if (o.kind === 'confirm') {
    return o.paddle === null
      ? t('console.voice.outcome.confirmAny')
      : t('console.voice.outcome.confirm', { n: o.paddle });
  }
  if (o.kind === 'bid') {
    return o.paddle === null
      ? t('console.voice.outcome.bidAny')
      : t('console.voice.outcome.bid', { n: o.paddle });
  }
  switch (o.reason) {
    case 'unknown_bidder':
    case 'unregistered_paddle':
      return t('console.voice.outcome.noPaddle');
    case 'no_amount':
    case 'uninterpretable_number':
      return t('console.voice.outcome.noAmount');
    case 'not_open':
      return t('console.voice.outcome.notOpen');
    case 'low_confidence':
      return t('console.voice.outcome.lowConfidence');
    default:
      return t('console.voice.outcome.none');
  }
}

/** A stop the user or a limit asked for is a status; the rest is something that went wrong. */
const PLAIN_ENDS: readonly VoiceProblem[] = ['silence', 'idle', 'maxSession', 'hidden', 'closed'];

function reasonFor(capability: VoiceCapability, scripted: boolean, closed: boolean): string | null {
  if (scripted) return t('console.mic.reason.scripted');
  if (capability === 'checking') return t('console.mic.reason.checking');
  if (capability === 'replay') {
    return t(closed ? 'console.mic.reason.closed' : 'console.mic.reason.replay');
  }
  if (capability === 'off') return t('console.mic.reason.off');
  if (capability === 'unreachable') return t('console.mic.reason.unreachable');
  if (closed) return t('console.mic.reason.closed');
  return null;
}

/**
 * The auctioneer's microphone: say "paddle 3, two hundred" to record a floor bid. The button
 * works only when the server reports a live speech provider. A spoken bid never counts on its
 * own: the server sends the bidder a confirm question (their own screen) and places the bid only
 * on their yes.
 */
export function VoiceControl({
  apiBase,
  roomId,
  token,
  closed,
  scripted = false,
  entries,
}: VoiceControlProps) {
  const capability = useVoiceCapability(apiBase, !scripted);
  const voice = useVoice({ apiBase, roomId, token, closed });
  const support = useMemo(() => micSupport(), []);
  const { state, mode } = voice;

  const serverReason = reasonFor(capability, scripted, closed);
  const unsupported = serverReason === null ? support : null;
  const disabled = serverReason !== null || unsupported !== null;
  const active = state.phase !== 'off' && !state.replay;
  const hold = mode === 'hold';

  const keyDown = (ev: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled || !hold || ev.repeat || (ev.key !== ' ' && ev.key !== 'Enter')) return;
    ev.preventDefault();
    voice.press();
  };
  const keyUp = (ev: KeyboardEvent<HTMLButtonElement>): void => {
    if (!hold || (ev.key !== ' ' && ev.key !== 'Enter')) return;
    ev.preventDefault();
    voice.release();
  };

  // The recorded demo is for hosts without live speech; it never uses the microphone.
  const replayOffered = capability === 'replay' && !scripted && !closed;
  const replayToggle = (): void => {
    if (state.replay) voice.stop();
    else voice.replay();
  };

  const label = hold
    ? t(state.talking ? 'console.mic.holdActive' : 'console.mic.holdButton')
    : t(active ? 'console.mic.stop' : 'console.mic.start');
  const problem = problemText(state.problem);
  const plain = state.problem !== null && PLAIN_ENDS.includes(state.problem);

  return (
    <div className="gv-voice-control" data-mode={mode}>
      <fieldset className="gv-voice-control__mode" disabled={disabled}>
        <legend>{t('console.mic.mode')}</legend>
        <label>
          <input
            type="radio"
            name="gv-mic-mode"
            checked={!hold}
            onChange={() => voice.setMode('toggle')}
          />{' '}
          {t('console.mic.modeToggle')}
        </label>
        <label>
          <input
            type="radio"
            name="gv-mic-mode"
            checked={hold}
            onChange={() => voice.setMode('hold')}
          />{' '}
          {t('console.mic.modeHold')}
        </label>
      </fieldset>
      <ActionGroup className="gv-voice-control__buttons">
        <Button
          variant="outline"
          disabled={disabled}
          aria-pressed={hold ? state.talking : active}
          {...(hold
            ? {
                onPointerDown: () => {
                  if (!disabled) voice.press();
                },
                onPointerUp: voice.release,
                onPointerCancel: voice.release,
                onPointerLeave: voice.release,
                onKeyDown: keyDown,
                onKeyUp: keyUp,
              }
            : { onClick: voice.toggle })}
        >
          {label}
        </Button>
        {hold && active && (
          <Button variant="outline" onClick={voice.stop}>
            {t('console.mic.stop')}
          </Button>
        )}
      </ActionGroup>
      {replayOffered && (
        <div className="gv-voice-control__replay">
          <Button variant="outline" aria-pressed={state.replay} onClick={replayToggle}>
            {t(state.replay ? 'console.replay.stop' : 'console.replay.start')}
          </Button>
          <p className="gv-voice-control__hint">
            {t(state.replay ? 'console.replay.running' : 'console.replay.hint')}
          </p>
        </div>
      )}
      {!disabled && (
        <p className="gv-voice-control__hint">
          {hold
            ? t('console.mic.holdHint')
            : t('console.mic.toggleHint', { s: SILENCE_CUTOFF_MS / 1000 })}
        </p>
      )}
      <VoiceFeed
        mic={unsupported !== null ? (unsupported as MicState) : micStateOf(state)}
        level={state.level}
        entries={entries}
        unavailable={serverReason !== null}
        {...(serverReason === null ? {} : { unavailableReason: serverReason })}
      />
      {state.caption !== null && (
        <p
          className="gv-voice-control__caption"
          aria-live="polite"
          data-final={state.caption.final}
        >
          {t(state.caption.final ? 'console.voice.heard' : 'console.voice.hearing', {
            text: state.caption.text,
          })}
        </p>
      )}
      {state.outcome !== null && (
        <p role="status" data-slot="voice-outcome" data-kind={state.outcome.kind}>
          {outcomeText(state.outcome)}
        </p>
      )}
      {state.stt === 'degraded' && <p role="status">{t('console.voice.sttDegraded')}</p>}
      {state.stt === 'down' && <p role="alert">{t('console.voice.sttDown')}</p>}
      {state.note === 'confirmExpired' && (
        <p role="status">{t('console.voice.note.confirmExpired')}</p>
      )}
      {state.note === 'maxClip' && (
        <p role="status">{t('console.voice.note.maxClip', { s: MAX_HOLD_MS / 1000 })}</p>
      )}
      {problem !== null && <p role={plain ? 'status' : 'alert'}>{problem}</p>}
      <details className="gv-voice-control__privacy-box">
        <summary>{t('console.voice.privacySummary')}</summary>
        <p className="gv-voice-control__privacy">{t('console.voice.privacy')}</p>
      </details>
    </div>
  );
}
