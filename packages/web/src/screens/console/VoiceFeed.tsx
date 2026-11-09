import { t } from '../../copy/t';
import type { AuditPayload } from '../../wire';
import type { CopyKey } from '../../copy/en';
import { Chip } from '../../design/primitives/Chip';
import { Icon } from '../../design/icons';
import { formatUsdCompact } from '../../util/money';

export type MicState =
  | 'off'
  | 'requesting'
  | 'connecting'
  | 'live'
  | 'armed'
  | 'error'
  | 'denied'
  | 'nomic'
  | 'busy'
  | 'unsupported'
  | 'insecure';

/** What the parser made of one utterance. Null `bid` means it was not a bid. */
export interface VoiceParse {
  bid: { paddle: number; amountCents: number; confidence: number } | null;
}

export interface VoiceFeedEntry {
  id: string;
  text: string;
  /** False while the recogniser may still change the text. */
  final: boolean;
  parse: VoiceParse | null;
}

export interface VoiceFeedProps {
  mic: MicState;
  /** Input level 0..1. */
  level: number;
  entries: readonly VoiceFeedEntry[];
  /** True when voice cannot be used here: no microphone state or level shows. */
  unavailable?: boolean;
  /** Why it cannot be used. Defaults to the build-level wording. */
  unavailableReason?: string;
}

const MIC_KEY = {
  off: 'console.mic.off',
  requesting: 'console.mic.requesting',
  connecting: 'console.mic.connecting',
  live: 'console.mic.live',
  armed: 'console.mic.armed',
  error: 'console.mic.error',
  denied: 'console.mic.denied',
  nomic: 'console.mic.nomic',
  busy: 'console.mic.busy',
  unsupported: 'console.mic.unsupported',
  insecure: 'console.mic.insecure',
} as const satisfies Record<MicState, CopyKey>;

/** 0.93 -> "0.93". Integer rounding first, so no float formatting surprises. */
export function formatConfidence(confidence: number): string {
  const hundredths = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

export function parseChipText(bid: NonNullable<VoiceParse['bid']>): string {
  return t('console.parseChip', {
    n: bid.paddle,
    amount: formatUsdCompact(bid.amountCents),
    conf: formatConfidence(bid.confidence),
  });
}

function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

/** Partial and final transcripts, parse results and the microphone state (R-WEB-066). */
export function VoiceFeed({
  mic,
  level,
  entries,
  unavailable = false,
  unavailableReason,
}: VoiceFeedProps) {
  const shown = clampLevel(level);
  const problem = !['off', 'requesting', 'connecting', 'live', 'armed'].includes(mic);
  return (
    <div className="gv-voice">
      {unavailable ? (
        <p role="status">{unavailableReason ?? t('console.mic.unavailable')}</p>
      ) : (
        <div className="gv-voice__mic" data-state={mic}>
          <Icon name={problem ? 'warning' : 'mic'} size={16} />
          <span role="status">{t(MIC_KEY[mic])}</span>
          <meter
            className="gv-voice__level"
            min={0}
            max={1}
            value={shown}
            aria-label={t('console.mic.level')}
          />
        </div>
      )}
      {entries.length === 0 ? (
        <p>{t('console.voice.empty')}</p>
      ) : (
        <ol className="gv-voice__list">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="gv-voice__entry"
              data-final={entry.final ? 'true' : 'false'}
              style={entry.final ? undefined : { opacity: 0.6, fontStyle: 'italic' }}
            >
              <span className="gv-voice__kind">
                {entry.final ? t('console.transcript.final') : t('console.transcript.partial')}
              </span>{' '}
              <span className="gv-voice__text">{entry.text}</span>
              {entry.final && entry.parse !== null && entry.parse.bid !== null && (
                <Chip
                  state="parsed"
                  tone="accent"
                  label={parseChipText(entry.parse.bid)}
                  icon={<Icon name="check" size={14} />}
                />
              )}
              {entry.final && entry.parse !== null && entry.parse.bid === null && (
                <Chip
                  state="not_bid"
                  tone="neutral"
                  label={t('console.notBid')}
                  icon={<Icon name="hollow" size={14} />}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Voice rows from audit records, oldest first. The wire carries the final transcript with the
 * parse outcome on the audit record, so every row here is final.
 */
export function voiceEntriesFromAudit(
  audit: readonly AuditPayload[],
  paddleOf: (bidderId: string) => number | null,
): VoiceFeedEntry[] {
  const out: VoiceFeedEntry[] = [];
  for (const a of audit) {
    if (a.source !== 'voice' || a.transcript === undefined) continue;
    const paddle = paddleOf(a.bidderId);
    const amount = a.parsedAmount;
    out.push({
      id: a.bidId,
      text: a.transcript,
      final: true,
      parse: {
        bid:
          amount !== undefined && paddle !== null
            ? { paddle, amountCents: Number(amount), confidence: a.confidence ?? 0 }
            : null,
      },
    });
  }
  return out;
}
