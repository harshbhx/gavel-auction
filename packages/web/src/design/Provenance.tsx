import { t } from '../copy/t';
import type { CopyKey } from '../copy/en';
import { Icon, type IconName } from './icons';
import { Chip, type ChipTone } from './primitives/Chip';

export type ProvenanceKind = 'live' | 'scripted' | 'recorded';

interface Variant {
  readonly key: CopyKey;
  readonly icon: IconName;
  readonly tone: ChipTone;
}

const VARIANTS: Readonly<Record<ProvenanceKind, Variant>> = {
  live: { key: 'prov.live', icon: 'current', tone: 'success' },
  scripted: { key: 'prov.scripted', icon: 'clock', tone: 'warning' },
  recorded: { key: 'prov.recorded', icon: 'play', tone: 'neutral' },
};

export interface ProvenanceProps {
  kind: ProvenanceKind;
}

/** Persistent tag saying where the events on screen come from. Icon and text, never colour alone. */
export function Provenance({ kind }: ProvenanceProps) {
  const variant = VARIANTS[kind];
  return (
    <span role="status" data-provenance={kind}>
      <Chip
        state={kind}
        label={t(variant.key)}
        icon={<Icon name={variant.icon} />}
        tone={variant.tone}
      />
    </span>
  );
}
