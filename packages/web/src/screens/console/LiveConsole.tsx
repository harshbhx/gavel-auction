import { useMemo, useState, useSyncExternalStore } from 'react';
import type { BidderId, Cents, MsgId } from '@gavel/shared';
import { announce } from '../../a11y/announce';
import type { AudioFrameSink } from '../../audio/micCapture';
import { useMic } from '../../audio/useMic';
import { Button } from '../../design/primitives/Button';
import { t } from '../../copy/t';
import { useConnection } from '../../net/connection';
import { ControlError, ControlTimeoutError, createControlPort } from '../../net/controlPort';
import type { LiveRoom } from '../../net/liveRoom';
import { publicSource } from '../../ladder/fromWire';
import { useRoom } from '../../store/roomStore';
import { selectors } from '../../store/selectors';
import type { AuctionStatus } from '../../wire';
import { Controls, controlStatus } from './Controls';
import { ConsoleScreen } from './ConsoleScreen';
import { KillSwitch } from './KillSwitch';
import { ManualEntry, type ManualSendResult } from './ManualEntry';
import { Roster } from './Roster';
import { VoiceFeed, voiceEntriesFromAudit, type VoiceFeedEntry } from './VoiceFeed';

export interface LiveConsoleProps {
  readonly room: LiveRoom | null;
  readonly roomId: string;
  /** Auctioneer token for this room. */
  readonly token: string;
  /** HTTP origin for the control routes. */
  readonly apiBase: string;
  /** Sends one confirm_response and drops the request from the queue. */
  readonly onConfirmAnswer: (confirmId: string, accept: boolean) => void;
  /** Error code of the last rejected bid this console sent, or an empty string. */
  readonly rejection: string;
  /** Receives microphone PCM chunks. Without it the microphone is shown as not available. */
  readonly audioSink?: AudioFrameSink;
}

/** Microphone button and feed for a build that has an audio path to the server. */
function LiveVoice({
  sink,
  entries,
}: {
  readonly sink: AudioFrameSink;
  readonly entries: readonly VoiceFeedEntry[];
}) {
  const mic = useMic(sink);
  const micOn = mic.state === 'live' || mic.state === 'requesting';
  return (
    <>
      <Button variant="outline" onClick={micOn ? mic.stop : mic.start}>
        {t(micOn ? 'console.mic.stop' : 'console.mic.start')}
      </Button>
      <VoiceFeed mic={mic.state} level={mic.level} entries={entries} />
    </>
  );
}

/** What the auctioneer must know about a capture that is not done or has failed. */
function SettlementNotice() {
  const phase = useRoom((s) => s.snapshot?.settlement?.auctionState ?? null);
  if (phase === 'FAILED_NEEDS_REVIEW')
    return <p role="alert">{t('console.settlement.needsReview')}</p>;
  if (phase === 'VOIDING' || phase === 'CAPTURING')
    return <p role="status">{t('console.settlement.inProgress')}</p>;
  return null;
}

/** The words for a refused or unanswered stop request. */
function killMessage(err: unknown): string {
  if (err instanceof ControlTimeoutError) return t('kill.unknown');
  if (err instanceof ControlError) {
    if (err.status === 401 || err.status === 403) return t('kill.unauthorized');
    if (err.status === 404) return t('kill.notAvailable');
    if (err.status === 409) return t('kill.conflict');
    if (err.detail !== null) return t('kill.failedDetail', { detail: err.detail });
    if (err.status >= 500) return t('kill.serverError');
  }
  return t('kill.failed');
}

/** The live auctioneer console: lot controls, voice feed, confirm queue, manual entry, kill switch. */
export function LiveConsole({
  room,
  roomId,
  token,
  apiBase,
  onConfirmAnswer,
  rejection,
  audioSink,
}: LiveConsoleProps) {
  const port = useMemo(
    () => createControlPort({ auctionId: roomId, token, baseUrl: apiBase }),
    [roomId, token, apiBase],
  );
  const connection = useConnection();
  const rawStatus = useRoom((s) => selectors.auctionStatus(s) ?? 'SCHEDULED') as AuctionStatus;
  const lotPaused = useRoom((s) => s.snapshot?.paused === true);
  const status = controlStatus(rawStatus, lotPaused);
  const priceCents = useRoom((s) => s.snapshot?.price ?? 0);
  const roomState = useRoom((s) => s);
  const settlementView = useMemo(() => publicSource(roomState, true), [roomState]);
  const roster = useRoom((s) => s.snapshot?.roster);
  const leaderId = useRoom((s) => s.snapshot?.leaderId ?? null);
  const audit = useRoom((s) => s.audit);
  const recentBids = useRoom(selectors.stream);
  const [stoppedHere, setStoppedHere] = useState(false);
  const roomStopped = useRoom(selectors.stopped);
  const stopped = stoppedHere || roomStopped;
  const [killFailed, setKillFailed] = useState('');
  const seq = useRoom((s) => s.lastSeq);
  const [manualMid, setManualMid] = useState<MsgId | null>(null);
  const manualBid = useSyncExternalStore(
    (cb) => (room === null ? () => undefined : room.pending.subscribe(cb)),
    () => {
      const bid = manualMid === null || room === null ? undefined : room.pending.get(manualMid);
      return bid === undefined ? '' : bid.status;
    },
  );

  const rows = roster ?? [];
  const highBids = useMemo(() => {
    const high: Record<number, number> = {};
    for (const b of recentBids) {
      if (b.paddle !== null && b.amount > (high[b.paddle] ?? 0)) high[b.paddle] = b.amount;
    }
    return high;
  }, [recentBids]);
  const ceilings = useMemo(() => {
    const out: Record<number, number> = {};
    for (const h of settlementView?.holds ?? []) out[h.paddle] = h.ceilingCents;
    return out;
  }, [settlementView]);
  const lead = rows.find((r) => r.bidderId === leaderId);
  const leader = lead === undefined ? null : { paddle: lead.paddle, name: lead.name };

  const kill = (): void => {
    setKillFailed('');
    port.kill('STOP').then(
      () => setStoppedHere(true),
      (err: unknown) => {
        // Say what the server said instead of pretending the auction stopped.
        const message = killMessage(err);
        setKillFailed(message);
        announce('assertive', message, 'stop');
      },
    );
  };

  const online = !connection.offline && connection.status === 'open';
  const sendManual = (amount: Cents, bidderId: BidderId): ManualSendResult => {
    if (room === null) return 'noRoom';
    if (!online) return 'offline';
    try {
      setManualMid(room.bid(amount, 'manual', bidderId));
      return 'sent';
    } catch {
      return 'failed';
    }
  };
  const retryManual = (): void => {
    if (room !== null && manualMid !== null) room.pending.retry(manualMid);
  };

  const controls = (
    <>
      <Controls
        port={port}
        lotId={roomId}
        status={status}
        online={online}
        stopped={stopped}
        leader={leader}
        priceCents={priceCents}
        seq={seq}
      />
      <ManualEntry
        roster={rows}
        rejection={rejection === '' ? null : rejection}
        offline={!online}
        status={manualBid === '' ? null : manualBid}
        onSubmit={sendManual}
        onRetry={retryManual}
      />
      <Roster
        roster={rows}
        connected={rows.length}
        leaderId={leaderId}
        highBids={highBids}
        ceilings={ceilings}
        closed={status === 'CLOSING' || status === 'SETTLING' || status === 'DONE'}
      />
      <KillSwitch stopped={stopped} onKill={kill} />
      {killFailed !== '' && <p role="alert">{killFailed}</p>}
    </>
  );

  const voiceEntries = voiceEntriesFromAudit(
    audit,
    (id) => rows.find((r) => r.bidderId === id)?.paddle ?? null,
  );

  return (
    <>
      <SettlementNotice />
      <ConsoleScreen
        settlementView={settlementView}
        controls={controls}
        voiceFeed={
          audioSink === undefined ? (
            <>
              <Button variant="outline" disabled>
                {t('console.mic.start')}
              </Button>
              <VoiceFeed mic="off" level={0} entries={voiceEntries} unavailable />
            </>
          ) : (
            <LiveVoice sink={audioSink} entries={voiceEntries} />
          )
        }
        onConfirmAnswer={onConfirmAnswer}
        stoppedHere={stoppedHere}
      />
    </>
  );
}
