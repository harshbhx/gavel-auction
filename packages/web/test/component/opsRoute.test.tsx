import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App';

describe('ops route', () => {
  it('shows the operator form and no data before it is submitted', () => {
    const { container } = render(<App initialPath="/ops" />);
    expect(screen.getByLabelText('Operator key')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load' })).toBeTruthy();
    expect(container.querySelector('pre')).toBeNull();
  });
});
