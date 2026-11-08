import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../../src/design/primitives/Dialog';
import { Sheet } from '../../src/design/primitives/Sheet';
import { GuidedTour } from '../../src/help/GuidedTour';

describe('Escape and focus after a click on the overlay (#2103)', () => {
  it('closes the tour on Escape after the veil was clicked', () => {
    const onSkip = vi.fn();
    const { container } = render(
      <GuidedTour step={0} onNext={vi.fn()} onBack={vi.fn()} onSkip={onSkip} />,
    );
    const veil = container.querySelector('.help-tour__veil') as HTMLElement;
    fireEvent.mouseDown(veil);
    fireEvent.click(veil);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('closes a sheet on Escape when focus is on the body', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Sheet">
        <button type="button">Inside</button>
      </Sheet>,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a strict dialog open on Escape', () => {
    const onClose = vi.fn();
    render(
      <Dialog open strict onClose={onClose} title="Hammer">
        <button type="button">Inside</button>
      </Dialog>,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('pulls focus back into a strict dialog when it falls to the body', () => {
    render(
      <div>
        <button type="button">Behind</button>
        <Dialog open strict onClose={vi.fn()} title="Hammer">
          <button type="button">First</button>
          <button type="button">Last</button>
        </Dialog>
      </div>,
    );
    const backdrop = document.querySelector('.gv-dialog-backdrop') as HTMLElement;
    expect(fireEvent.mouseDown(backdrop)).toBe(false);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    screen.getByRole('button', { name: 'Behind' }).focus();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});
