import { useMemo, useState } from 'react';
import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { useConnection } from '../../net/connection';
import { createControlPort } from '../../net/controlPort';
import type { LiveRoom } from '../../net/liveRoom';
import { useRoom } from '../../store/roomStore';
import { Controls } from './Controls';
import { ConsoleScreen } from './ConsoleScreen';
import { KillSwitch } from './KillSwitch';
import { ManualEntry } from './ManualEntry';
import { Roster } from './Roster';
import { VoiceFeed } from './VoiceFeed';

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
}

/** The live auctioneer console: lot controls, voice feed, confirm queue, manual entry, kill switch. */
export function LiveConsole({
  room,
  roomId,
  token,
  apiBase,
  onConfirmAnswer,
  rejection,
}: LiveConsoleProps) {
  const port = useMemo(
    () => createControlPort({ auctionId: roomId, token, baseUrl: apiBase }),
    [roomId, token, apiBase],
  );
  const connection = useConnection();
  const status = useRoom((s) => s.snapshot?.status ?? 'SCHEDULED');
  const priceCents = useRoom((s) => s.snapshot?.price ?? 0);
  const roster = useRoom((s) => s.snapshot?.roster);
  const leaderId = useRoom((s) => s.snapshot?.leaderId ?? null);
  const [stopped, setStopped] = useState(false);
  const [killFailed, setKillFailed] = useState(false);

  const rows = roster ?? [];
  const lead = rows.find((r) => r.bidderId === leaderId);
  const leader = lead === undefined ? null : { paddle: lead.paddle, name: lead.name };

  const kill = (): void => {
    setKillFailed(false);
    port.kill('STOP').then(
      () => setStopped(true),
      () => {
        // The server has no stop route yet: say so instead of pretending the auction stopped.
        setKillFailed(true);
        announce('assertive', t('kill.failed'), 'stop');
      },
    );
  };

  const controls = (
    <>
      <Controls
        port={port}
        lotId={roomId}
        status={status}
        online={!connection.offline && connection.status === 'open'}
        stopped={stopped}
        leader={leader}
        priceCents={priceCents}
      />
      <ManualEntry
        roster={rows}
        rejection={rejection === '' ? null : rejection}
        onSubmit={(amount, bidderId) => room?.bid(amount, 'manual', bidderId)}
      />
      <Roster roster={rows} connected={rows.length} />
      <KillSwitch stopped={stopped} onKill={kill} />
      {killFailed && <p role="alert">{t('kill.failed')}</p>}
    </>
  );

  return (
    <ConsoleScreen
      settlementView={null}
      controls={controls}
      voiceFeed={<VoiceFeed mic="off" level={0} entries={[]} />}
      onConfirmAnswer={onConfirmAnswer}
    />
  );
}
