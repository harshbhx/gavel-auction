import { useEffect, useState } from 'react';
import { SettlementPanel } from '../../ladder/SettlementPanel';
import { publicSource } from '../../ladder/fromWire';
import { ScenarioTransport } from '../../net/scenarioTransport';
import { initialRoomState, reduce, type RoomState } from '../../store/roomReducer';
import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';
import { createAudioSync, type AudioStatus, type MediaLike } from './AudioSync';
import { bundleToScenario, parseBundle, type ReplayBundle } from './bundle';

export interface ReplayScreenProps {
  recordingId: string;
  /** Fetches the parsed events.json. Defaults to a request for /recordings/<id>/events.json. */
  loadBundle?: (recordingId: string) => Promise<unknown>;
  /** Follow the wall clock. Tests switch it off and drive the transport by hand. */
  autoplay?: boolean;
  /** Builds the audio element for a recording. Defaults to a browser Audio element. */
  createMedia?: (url: string) => MediaLike;
}

function browserMedia(url: string): MediaLike {
  return new Audio(url);
}

type Phase = { kind: 'loading' } | { kind: 'invalid' } | { kind: 'ready'; bundle: ReplayBundle };

async function fetchBundle(recordingId: string): Promise<unknown> {
  const res = await fetch(`/recordings/${encodeURIComponent(recordingId)}/events.json`);
  if (!res.ok) throw new Error('bundle request failed');
  return res.json();
}

/** Read-only replay of a recording through the real reducer. Load this module lazily. */
export default function ReplayScreen({
  recordingId,
  loadBundle = fetchBundle,
  autoplay = true,
  createMedia = browserMedia,
}: ReplayScreenProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'loading' });
    loadBundle(recordingId).then(
      (raw) => {
        if (cancelled) return;
        const result = parseBundle(raw);
        setPhase(result.ok ? { kind: 'ready', bundle: result.bundle } : { kind: 'invalid' });
      },
      () => {
        if (!cancelled) setPhase({ kind: 'invalid' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [recordingId, loadBundle]);

  return (
    <div>
      <p role="status">{t('prov.recorded')}</p>
      <p>{t('replay.readonly')}</p>
      {phase.kind === 'loading' && <p role="status">{t('net.resyncing')}</p>}
      {phase.kind === 'invalid' && <p role="alert">{t('replay.invalid')}</p>}
      {phase.kind === 'ready' && (
        <ReplayView bundle={phase.bundle} autoplay={autoplay} createMedia={createMedia} />
      )}
    </div>
  );
}

function ReplayView({
  bundle,
  autoplay,
  createMedia,
}: {
  bundle: ReplayBundle;
  autoplay: boolean;
  createMedia: (url: string) => MediaLike;
}) {
  const [state, setState] = useState<RoomState | null>(null);
  const [audio, setAudio] = useState<AudioStatus | null>(null);

  useEffect(() => {
    const transport = new ScenarioTransport(bundleToScenario(bundle));
    const sync =
      bundle.audioUrl === undefined
        ? null
        : createAudioSync(createMedia(bundle.audioUrl), setAudio);
    if (sync !== null) setAudio(sync.status());
    let current = initialRoomState('');
    const off = transport.onMessage((msg) => {
      current = reduce(current, { kind: 'wire', msg }).state;
      setState(current);
      // The replay clock is the transport clock: the audio follows it within the drift limit.
      sync?.sync(transport.elapsedMs);
    });
    transport.connect();
    if (autoplay) {
      sync?.setPlaying(true);
      transport.autoplay();
    }
    return () => {
      off();
      transport.close();
      sync?.dispose();
    };
  }, [bundle, autoplay, createMedia]);

  const snapshot = state?.snapshot ?? null;
  return (
    <section>
      <h2>{bundle.title}</h2>
      {audio === 'captions-only' && <p role="status">{t('replay.captionsOnly')}</p>}
      {snapshot !== null && snapshot.price !== null && (
        <p className="tabular">{formatUsd(snapshot.price)}</p>
      )}
      {state !== null && snapshot !== null && snapshot.settlement !== undefined && (
        <SettlementPanel
          view={publicSource(state)}
          auditHref={`/r/${encodeURIComponent(snapshot.auctionId)}/audit`}
        />
      )}
    </section>
  );
}
