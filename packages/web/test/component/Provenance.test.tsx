import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import { Provenance } from '../../src/design/Provenance';

describe('Provenance', () => {
  it.each([
    ['live', 'prov.live'],
    ['scripted', 'prov.scripted'],
    ['recorded', 'prov.recorded'],
  ] as const)('%s shows its text and an icon', (kind, key) => {
    const { container } = render(<Provenance kind={kind} />);
    expect(screen.getByText(t(key))).toBeTruthy();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector(`[data-provenance="${kind}"]`)).not.toBeNull();
  });
});
