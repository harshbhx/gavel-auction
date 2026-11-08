import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { createJudgeRoom } from '../../src/net/judgeRooms';
import { DemoLauncher, type DemoLinks } from '../../src/screens/demo/DemoLauncher';
import { JudgePanel } from '../../src/screens/judge/JudgePanel';
import { FundraiserThermometer } from '../../src/screens/screen/Thermometer';
import { thermometer, lotRaise } from '../../src/screens/screen/fundraiser';

const LINKS: DemoLinks = { console: '/c', screen: '/s', bidder: '/b', audit: '/a', hub: '/h' };

afterEach(() => {
  vi.unstubAllGlobals();
});

function panel(createRoom: (goalCents?: number) => Promise<DemoLinks>): void {
  render(
    <JudgePanel
      rooms="on"
      createRoom={createRoom}
      openRoom={vi.fn()}
      joinByCode={() => Promise.resolve(true)}
    />,
  );
}

const field = (): HTMLInputElement => screen.getByLabelText(t('goal.label'));
const start = (): HTMLElement => screen.getByRole('button', { name: t('try.s1.cta') });

describe('fundraiser goal field on /try (UIX-31)', () => {
  it('is optional: an empty field starts a room with no goal', async () => {
    const createRoom = vi.fn((_goal?: number) => Promise.resolve(LINKS));
    panel(createRoom);
    expect(screen.getByText(t('goal.hint'))).toBeTruthy();
    fireEvent.click(start());
    await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));
    expect(createRoom.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('sends the goal in cents', async () => {
    const createRoom = vi.fn((_goal?: number) => Promise.resolve(LINKS));
    panel(createRoom);
    fireEvent.change(field(), { target: { value: '$2,500.50' } });
    fireEvent.click(start());
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith(250_050));
  });

  it('shows an error and blocks the start for a bad amount', () => {
    const createRoom = vi.fn((_goal?: number) => Promise.resolve(LINKS));
    panel(createRoom);
    fireEvent.change(field(), { target: { value: 'lots' } });
    expect(screen.getByText(t('goal.invalid'))).toBeTruthy();
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect((start() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(start());
    expect(createRoom).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: '1000000001' } });
    expect(screen.getByText(t('goal.tooBig'))).toBeTruthy();
  });
});

describe('fundraiser goal field on the operator launcher (UIX-31)', () => {
  function launcher(
    goalField: boolean,
    createRoom = vi.fn((_g?: number) => Promise.resolve(LINKS)),
  ) {
    render(
      <DemoLauncher
        createRoom={createRoom}
        goalField={goalField}
        startScripted={() => LINKS}
        openConsole={vi.fn()}
      />,
    );
    return createRoom;
  }

  it('is hidden when the host cannot take a goal', () => {
    launcher(false);
    expect(screen.queryByLabelText(t('goal.label'))).toBeNull();
  });

  it('passes the goal through when the host takes one', async () => {
    const createRoom = launcher(true);
    fireEvent.change(field(), { target: { value: '750' } });
    fireEvent.click(screen.getByRole('button', { name: t('landing.start') }));
    await waitFor(() => expect(createRoom).toHaveBeenCalledWith(75_000));
  });

  it('blocks the start for a bad amount', () => {
    const createRoom = launcher(true);
    fireEvent.change(field(), { target: { value: '-3' } });
    expect(
      (screen.getByRole('button', { name: t('landing.start') }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(createRoom).not.toHaveBeenCalled();
  });
});

describe('createJudgeRoom body', () => {
  function stub(): ReturnType<typeof vi.fn> {
    const f = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            auctionId: 'a1',
            auctioneerToken: 'x',
            screenToken: 'y',
            joinCode: 'ABC234',
          }),
          { status: 201 },
        ),
      ),
    );
    vi.stubGlobal('fetch', f);
    return f;
  }

  it('posts fundraiserGoalCents only when a goal is given', async () => {
    const f = stub();
    await createJudgeRoom('https://api.test', 120_000);
    await createJudgeRoom('https://api.test');
    const bodies = f.mock.calls.map((c) => (c[1] as { body: string }).body);
    expect(JSON.parse(bodies[0] ?? '')).toEqual({ fundraiserGoalCents: 120_000 });
    expect(JSON.parse(bodies[1] ?? '')).toEqual({});
  });
});

describe('the goal reaches the projection thermometer', () => {
  it('draws the goal that was set, and nothing without one', () => {
    const raise = lotRaise(0, null, null);
    const thermo = thermometer(250_050, raise);
    expect(thermo).not.toBeNull();
    if (thermo === null) return;
    render(<FundraiserThermometer data={thermo} />);
    expect(screen.getByText(/2,500\.50/)).toBeTruthy();
    expect(thermometer(null, raise)).toBeNull();
  });
});
