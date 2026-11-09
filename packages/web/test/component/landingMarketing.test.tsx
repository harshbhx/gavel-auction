import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { LandingScreen } from '../../src/screens/landing/LandingScreen';

const DOCS = 'https://gavel-docs.creharsh.workers.dev';

function setup(overrides: Partial<Parameters<typeof LandingScreen>[0]> = {}) {
  const props = {
    onStart: vi.fn(),
    onJoin: vi.fn(() => Promise.resolve(true)),
    onScripted: vi.fn(),
    ...overrides,
  };
  const view = render(<LandingScreen {...props} />);
  return { props, view };
}

describe('marketing landing', () => {
  it('has one h1 with the thesis and a heading for every section', () => {
    setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('landing.title'));
    for (const key of [
      'mk.story.title',
      'mk.how.title',
      'mk.shots.title',
      'mk.feat.title',
      'mk.trust.title',
      'mk.aud.title',
      'mk.faq.title',
      'mk.final.title',
    ] as const) {
      expect(screen.getByRole('heading', { level: 2, name: t(key) })).toBeTruthy();
    }
  });

  it('has a sticky header with the wordmark, anchors, docs link and the demo call to action', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: t('mk.nav.label') });
    expect(
      within(nav)
        .getByRole('link', { name: t('mk.nav.how') })
        .getAttribute('href'),
    ).toBe('#how');
    expect(
      within(nav)
        .getByRole('link', { name: t('mk.nav.trust') })
        .getAttribute('href'),
    ).toBe('#trust');
    expect(
      within(nav)
        .getByRole('link', { name: t('mk.nav.docs') })
        .getAttribute('href'),
    ).toBe(DOCS);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: t('mk.cta.try') })).toBeTruthy();
  });

  it('sends every Try the demo link to the scripted demo route without a reload', () => {
    const { props } = setup();
    const links = screen.getAllByRole('link', { name: t('mk.cta.try') });
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('/demo/scripted');
      fireEvent.click(link);
    }
    expect(props.onScripted).toHaveBeenCalledTimes(links.length);
  });

  it('keeps the start action and the join form working', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: t('landing.start') }));
    expect(props.onStart).toHaveBeenCalledTimes(1);

    const first = screen.getByLabelText(t('ui.code.char', { n: 1, length: 6 }));
    fireEvent.change(first, { target: { value: 'K7M2QX' } });
    fireEvent.click(screen.getByRole('button', { name: t('landing.join') }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(props.onJoin).toHaveBeenCalledWith('K7M2QX');
  });

  it('shows the busy and down states and the scripted fallback', () => {
    const { props, view } = setup({ status: 'busy' });
    expect(screen.getByRole('button', { name: t('demo.creating') })).toBeTruthy();
    view.unmount();
    const down = setup({ status: 'down' });
    expect(screen.getByRole('alert').textContent).toContain(t('demo.failed'));
    fireEvent.click(screen.getByRole('button', { name: t('demo.scriptedInstead') }));
    expect(down.props.onScripted).toHaveBeenCalledTimes(1);
    expect(props.onScripted).not.toHaveBeenCalled();
  });

  it('draws the example lot as held, charged and released with words and amounts', () => {
    setup();
    const lot = screen.getByRole('article', { name: t('mk.lot.aria') });
    expect(within(lot).getByText(t('ui.hold.tagHeld'))).toBeTruthy();
    expect(within(lot).getByText(t('ladder.state.CAPTURED'))).toBeTruthy();
    expect(within(lot).getByText(t('ui.hold.tagReleased'))).toBeTruthy();
    expect(within(lot).getByText(t('mk.lot.note'))).toBeTruthy();
    expect(lot.querySelector('.ui-holdbar__held')).not.toBeNull();
    expect(lot.querySelector('.ui-holdbar__charged')).not.toBeNull();
    expect(lot.querySelector('.ui-holdbar__released--full')).not.toBeNull();
  });

  it('explains three steps with an inline illustration each', () => {
    setup();
    const how = document.getElementById('how');
    expect(how).not.toBeNull();
    const steps = how?.querySelectorAll('li.gv-steps__item') ?? [];
    expect(steps).toHaveLength(3);
    for (const step of Array.from(steps)) {
      expect(step.querySelector('svg[role="img"]')).not.toBeNull();
    }
    expect(screen.getByRole('heading', { level: 3, name: t('mk.how.s2.title') })).toBeTruthy();
  });

  it('tells hold, hammer, receipt and shows four labelled screenshots', () => {
    setup();
    const story = document.getElementById('story');
    expect(story?.querySelectorAll('li.gv-story__beat')).toHaveLength(3);
    const shots = document.getElementById('screens');
    const imgs = Array.from(shots?.querySelectorAll('img') ?? []);
    expect(imgs).toHaveLength(4);
    for (const img of imgs) {
      expect(img.getAttribute('alt')?.length ?? 0).toBeGreaterThan(20);
      expect(img.getAttribute('width')).not.toBeNull();
      expect(img.getAttribute('height')).not.toBeNull();
    }
    expect(screen.getByText(t('mk.shots.note'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('mk.cta.docs') }).getAttribute('href')).toBe(DOCS);
  });

  it('lists the gates with real status labels and a docs link for each', () => {
    setup();
    const trust = document.getElementById('trust');
    const items = Array.from(trust?.querySelectorAll('li.gv-trust__item') ?? []);
    expect(items).toHaveLength(8);
    const labels = items.map((li) => li.querySelector('.gv-chip')?.textContent ?? '');
    const count = (label: string): number => labels.filter((l) => l.includes(label)).length;
    expect(count(t('mk.trust.passed'))).toBe(4);
    expect(count(t('mk.trust.progress'))).toBe(1);
    expect(count(t('mk.trust.partial'))).toBe(2);
    expect(count(t('mk.trust.simulated'))).toBe(1);
    for (const li of items) {
      const href = li.querySelector('a')?.getAttribute('href') ?? '';
      expect(href.startsWith(`${DOCS}/docs/proof/`)).toBe(true);
    }
    expect(screen.getByText(t('mk.trust.note'))).toBeTruthy();
  });

  it('keeps the open gates honest: partial stays partial, G3 stays a running probe', () => {
    expect(t('mk.trust.partial')).toMatch(/partial/i);
    expect(t('mk.trust.progress')).toMatch(/in progress/i);
    for (const key of ['mk.trust.g3.body', 'mk.trust.g5.body', 'mk.trust.lat.body'] as const) {
      expect(t(key), key).not.toMatch(/\b(full|fully|passed|complete)\b/i);
    }
    expect(t('mk.trust.g3.body')).toMatch(/probe is running/);
    expect(t('mk.trust.g3.body')).toMatch(/final reading is due/);
    expect(t('mk.trust.g5.body')).toMatch(/synthetic/);
    expect(t('mk.trust.g5.body')).toMatch(/0\.058 and 0\.092 against 0\.05/);
    expect(t('mk.trust.g5.body')).not.toMatch(/live-room test/);
    expect(t('mk.trust.lat.body')).toMatch(/20 settlements/);
    expect(t('mk.trust.lat.body')).toMatch(/3\.0 s against a 2\.5 s target, target missed/);
  });

  it('does not claim replay, users, testimonials or partners', () => {
    const { view } = setup();
    const text = (view.container.textContent ?? '').toLowerCase();
    for (const word of [
      'testimonial',
      'customers',
      'trusted by',
      'users worldwide',
      'replay later',
    ]) {
      expect(text).not.toContain(word);
    }
  });

  it('answers the eight questions in an accordion that opens and closes', () => {
    const { view } = setup();
    const items = view.container.querySelectorAll('details.gv-faq__item');
    expect(items).toHaveLength(8);
    const first = items[0];
    expect(first?.hasAttribute('open')).toBe(false);
    expect(screen.getByText(t('mk.faq.q2'))).toBeTruthy();
    expect(screen.getByText(t('mk.faq.a4')).textContent).toContain('confirm');
  });

  it('does not advertise the judge page and ends with repo, docs, licence and sandbox notes', () => {
    setup();
    expect(document.querySelector('a[href="/try"]')).toBeNull();
    const footer = screen.getByRole('contentinfo');
    expect(
      within(footer)
        .getByRole('link', { name: t('mk.foot.github') })
        .getAttribute('href'),
    ).toBe('https://github.com/harshbhx/gavel-auction');
    expect(
      within(footer)
        .getByRole('link', { name: t('mk.foot.docs') })
        .getAttribute('href'),
    ).toBe(DOCS);
    expect(within(footer).getByRole('link', { name: t('mk.foot.license') })).toBeTruthy();
    const data = within(footer).getByRole('link', { name: t('mk.foot.data') });
    expect(data.getAttribute('href')).toBe(
      'https://huggingface.co/collections/harshbhx/gavel-evidence-auction-holds-hammer-and-receipts-6af0afebebb37eb4c9184504',
    );
    expect(t('mk.foot.data')).toMatch(/published/);
    expect(t('mk.foot.data')).toMatch(/synthetic/);
    expect(t('mk.foot.data')).not.toMatch(/prepared|not yet/i);
    expect(within(footer).getByText(t('mk.foot.sandbox'))).toBeTruthy();
  });
});

describe('landing route', () => {
  it('keeps the sandbox banner and a single h1 at the root', () => {
    render(
      <App
        initialPath="/"
        api={{ apiBase: 'http://localhost:1', payments: 'fake', paypalClientId: 'none' }}
      />,
    );
    expect(screen.getAllByText(t('banner.sandbox'))).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
