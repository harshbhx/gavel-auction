import { useEffect, useState } from 'react';
import { ScenarioTransport } from '../../net/scenarioTransport';
import { initialRoomState, reduce, type RoomState } from '../../store/roomReducer';
import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';
import { bundleToScenario, parseBundle, type ReplayBundle } from './bundle';

export interface ReplayScreenProps {
  recordingId: string;
  /** Fetches the parsed events.json. Defaults to a request for /recordings/<id>/events.json. */
  loadBundle?: (recordingId: string) => Promise<unknown>;
  /** Follow the wall clock. Tests switch it off and drive the transport by hand. */
  autoplay?: boolean;
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
    <main>
      <p role="status">{t('prov.recorded')}</p>
      <p>{t('replay.readonly')}</p>
      {phase.kind === 'loading' && <p role="status">{t('net.resyncing')}</p>}
      {phase.kind === 'invalid' && <p role="alert">{t('replay.invalid')}</p>}
      {phase.kind === 'ready' && <ReplayView bundle={phase.bundle} autoplay={autoplay} />}
    </main>
  );
}

function ReplayView({ bundle, autoplay }: { bundle: ReplayBundle; autoplay: boolean }) {
  const [state, setState] = useState<RoomState | null>(null);

  useEffect(() => {
    const transport = new ScenarioTransport(bundleToScenario(bundle));
    let current = initialRoomState('');
    const off = transport.onMessage((msg) => {
      current = reduce(current, { kind: 'wire', msg }).state;
      setState(current);
    });
    transport.connect();
    if (autoplay) transport.autoplay();
    return () => {
      off();
      transport.close();
    };
  }, [bundle, autoplay]);

  const snapshot = state?.snapshot ?? null;
  return (
    <section>
      <h1>{bundle.title}</h1>
      {snapshot !== null && snapshot.price !== null && (
        <p className="tabular">{formatUsd(snapshot.price)}</p>
      )}
    </section>
  );
}
