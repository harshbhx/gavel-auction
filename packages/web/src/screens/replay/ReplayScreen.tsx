import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LadderCompact } from '../../ladder/LadderCompact';
import { SettlementPanel } from '../../ladder/SettlementPanel';
import { publicSource } from '../../ladder/fromWire';
import { ScenarioTransport } from '../../net/scenarioTransport';
import { RoomStore, useRoom } from '../../store/roomStore';
import { ChainCheck } from '../../chain/ChainCheck';
import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';
import { ScreenView } from '../screen/ScreenView';
import { createAudioSync, type AudioStatus, type AudioSync, type MediaLike } from './AudioSync';
import { bundleToScenario, parseBundle, type ReplayBundle } from './bundle';
import { chapterMarkers, clampOffset, type Speed } from './Chapters';
import { Controls, type ReplayView as ReplayViewId } from './Controls';

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

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; bundle: ReplayBundle; ledger: unknown };

/** The hash-chained ledger export a recording may carry beside its events (`ledger`). */
function ledgerOf(raw: unknown): unknown {
  return typeof raw === 'object' && raw !== null
    ? (raw as Record<string, unknown>)['ledger']
    : undefined;
}

async function fetchBundle(recordingId: string): Promise<unknown> {
  const res = await fetch(`/recordings/${encodeURIComponent(recordingId)}/events.json`);
  if (!res.ok) throw new Error('bundle request failed');
  return res.json();
}

/** Real time between two steps of the replay clock while playing. */
const TICK_MS = 100;

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
        setPhase(
          result.ok
            ? { kind: 'ready', bundle: result.bundle, ledger: ledgerOf(raw) }
            : { kind: 'invalid' },
        );
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
        <>
          <ChainCheck ledger={phase.ledger} allowFile />
          <ReplayPlayer bundle={phase.bundle} autoplay={autoplay} createMedia={createMedia} />
        </>
      )}
    </div>
  );
}

function ReplayPlayer({
  bundle,
  autoplay,
  createMedia,
}: {
  bundle: ReplayBundle;
  autoplay: boolean;
  createMedia: (url: string) => MediaLike;
}) {
  const [store, setStore] = useState<RoomStore | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [speed, setSpeed] = useState<Speed>(1);
  const [view, setView] = useState<ReplayViewId>('ladder');
  const [audio, setAudio] = useState<AudioStatus | null>(null);
  const transportRef = useRef<ScenarioTransport | null>(null);
  const syncRef = useRef<AudioSync | null>(null);
  const chapters = useMemo(() => chapterMarkers(bundle), [bundle]);
  const eventOffsets = useMemo(() => bundle.events.map((e) => e.t), [bundle]);

  /** Starts a fresh transport and store, and plays the recording up to `toMs`. */
  const restart = useCallback(
    (toMs: number): void => {
      transportRef.current?.close();
      const transport = new ScenarioTransport(bundleToScenario(bundle));
      const next = new RoomStore('');
      transport.onMessage((msg) => next.dispatch({ kind: 'wire', msg }));
      transport.connect();
      transport.advance(toMs);
      transportRef.current = transport;
      setStore(next);
      setOffsetMs(transport.elapsedMs);
      syncRef.current?.sync(transport.elapsedMs);
    },
    [bundle],
  );

  useEffect(() => {
    const sync =
      bundle.audioUrl === undefined
        ? null
        : createAudioSync(createMedia(bundle.audioUrl), setAudio);
    syncRef.current = sync;
    if (sync !== null) setAudio(sync.status());
    restart(0);
    return () => {
      transportRef.current?.close();
      transportRef.current = null;
      sync?.dispose();
      syncRef.current = null;
    };
  }, [bundle, createMedia, restart]);

  useEffect(() => {
    syncRef.current?.setPlaying(playing);
    if (!playing) return undefined;
    const timer = setInterval(() => {
      const transport = transportRef.current;
      if (transport === null) return;
      const target = clampOffset(transport.elapsedMs + TICK_MS * speed, bundle.durationMs);
      transport.advance(target - transport.elapsedMs);
      setOffsetMs(transport.elapsedMs);
      syncRef.current?.sync(transport.elapsedMs);
      if (target >= bundle.durationMs) setPlaying(false);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [playing, speed, bundle.durationMs]);

  useEffect(() => {
    syncRef.current?.setSpeed(speed);
  }, [speed]);

  const seek = useCallback(
    (toMs: number): void => {
      const transport = transportRef.current;
      if (transport === null) return;
      const target = clampOffset(toMs, bundle.durationMs);
      if (target < transport.elapsedMs) {
        // The transport only moves forward: play again from the start up to the target.
        restart(target);
        return;
      }
      transport.advance(target - transport.elapsedMs);
      setOffsetMs(transport.elapsedMs);
      syncRef.current?.sync(transport.elapsedMs);
    },
    [bundle.durationMs, restart],
  );

  return (
    <section>
      <h2>{bundle.title}</h2>
      {audio === 'captions-only' && <p role="status">{t('replay.captionsOnly')}</p>}
      <Controls
        durationMs={bundle.durationMs}
        offsetMs={offsetMs}
        playing={playing}
        speed={speed}
        view={view}
        chapters={chapters}
        eventOffsets={eventOffsets}
        onSeek={seek}
        onPlayingChange={setPlaying}
        onSpeedChange={setSpeed}
        onViewChange={setView}
      />
      {store !== null && <ReplayBody store={store} view={view} title={bundle.title} />}
    </section>
  );
}

/** The read-only view for the chosen role, drawn from the replay state alone. */
function ReplayBody({
  store,
  view,
  title,
}: {
  store: RoomStore;
  view: ReplayViewId;
  title: string;
}) {
  const state = useRoom((s) => s, store);
  const snapshot = state.snapshot;
  const settled = snapshot?.settlement !== undefined;
  if (view === 'screen') {
    return (
      <ScreenView lotTitle={title} code={null} joinUrl={window.location.origin} store={store} />
    );
  }
  if (view === 'console') {
    // The live console needs a control port, so the replay shows the price and phase only.
    return (
      <div>
        {snapshot !== null && snapshot.price !== null && (
          <p className="tabular">{formatUsd(snapshot.price)}</p>
        )}
        {snapshot?.settlement !== undefined && (
          <p role="status">{t(`ladder.state.${snapshot.settlement.auctionState}`)}</p>
        )}
      </div>
    );
  }
  return (
    <div>
      {snapshot !== null && snapshot.price !== null && (
        <p className="tabular">{formatUsd(snapshot.price)}</p>
      )}
      {settled && snapshot !== null && (
        <>
          <LadderCompact view={publicSource(state, true)} />
          <SettlementPanel
            view={publicSource(state, true)}
            auditHref={`/r/${encodeURIComponent(snapshot.auctionId)}/audit`}
          />
        </>
      )}
    </div>
  );
}
