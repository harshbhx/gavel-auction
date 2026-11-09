import { useMemo, useState, type ReactNode } from 'react';
import { HomeScreen, type RoomCheck } from './HomeScreen';
import { clearHistory, readHistory, type HistoryRoom } from './history';

export interface HomeRouteProps {
  apiBase: string | undefined;
  /** Shown when the remembered history turns out to be empty or unreadable, or after Clear. */
  landing: ReactNode;
  onJoin: (code: string) => Promise<boolean>;
  onCreate: () => void;
  onNavigate: (to: string) => void;
}

/** Whether a remembered room still answers, by one cheap read-only request. Never throws. */
async function checkRoomOnHost(apiBase: string, roomId: string): Promise<RoomCheck> {
  try {
    const res = await fetch(`${apiBase}/api/auctions/${encodeURIComponent(roomId)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) return 'live';
    return res.status === 404 ? 'gone' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The Home screen with its data: reads the history once, checks the last room, handles Clear. */
export default function HomeRoute({
  apiBase,
  landing,
  onJoin,
  onCreate,
  onNavigate,
}: HomeRouteProps) {
  const [rooms, setRooms] = useState<readonly HistoryRoom[]>(() => readHistory());
  const checkRoom = useMemo(
    () => (apiBase === undefined ? undefined : (id: string) => checkRoomOnHost(apiBase, id)),
    [apiBase],
  );
  if (rooms.length === 0) return <>{landing}</>;
  return (
    <HomeScreen
      rooms={rooms}
      {...(checkRoom === undefined ? {} : { checkRoom })}
      onJoin={onJoin}
      onCreate={onCreate}
      onNavigate={onNavigate}
      onClear={() => {
        clearHistory();
        setRooms([]);
      }}
    />
  );
}
