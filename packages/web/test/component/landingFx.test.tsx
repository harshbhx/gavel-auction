import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { LandingScreen } from '../../src/screens/landing/LandingScreen';
import { BlurText, Marquee, NumberTicker, SpotlightCard, countAt } from '../../src/ui/fx';

function reduceMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
  vi.unstubAllGlobals();
});

describe('fx pieces', () => {
  it('counts from zero to the target with an ease-out curve', () => {
    expect(countAt(606, 0)).toBe(0);
    expect(countAt(606, 0.5)).toBeGreaterThan(303);
    expect(countAt(606, 1)).toBe(606);
    expect(countAt(606, 4)).toBe(606);
  });

  it('keeps the whole headline text and animates the words only with motion allowed', () => {
    reduceMotion(false);
    const on = render(<BlurText text="Every bid is a hold." />);
    expect(on.container.textContent).toBe('Every bid is a hold.');
    expect(on.container.querySelectorAll('.fx-blur-word')).toHaveLength(5);
    on.unmount();
    reduceMotion(true);
    const off = render(<BlurText text="Every bid is a hold." />);
    expect(off.container.textContent).toBe('Every bid is a hold.');
    expect(off.container.querySelectorAll('.fx-blur-word')).toHaveLength(0);
    expect(off.container.querySelector('[data-motion="off"]')).not.toBeNull();
  });

  it('shows the final number at once under reduced motion', () => {
    reduceMotion(true);
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const { container } = render(<NumberTicker value={606} />);
    expect(container.textContent).toBe('606');
    expect(raf).not.toHaveBeenCalled();
  });

  it('puts the final number in the markup before any animation runs', () => {
    reduceMotion(false);
    const { container } = render(<NumberTicker value={294} />);
    expect(container.textContent).toBe('294');
  });

  it('drops the hidden copy of the marquee and the movement under reduced motion', () => {
    reduceMotion(false);
    const moving = render(<Marquee items={['A', 'B']} label="Tech" />);
    expect(moving.container.querySelectorAll('ul')).toHaveLength(2);
    expect(moving.container.querySelector('ul[aria-hidden="true"]')).not.toBeNull();
    moving.unmount();
    reduceMotion(true);
    const still = render(<Marquee items={['A', 'B']} label="Tech" />);
    expect(still.container.querySelectorAll('ul')).toHaveLength(1);
    expect(still.container.querySelector('[data-motion="off"]')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Tech' })).toBeTruthy();
  });

  it('leaves the highlight position alone for anything but a mouse', () => {
    reduceMotion(true);
    const { container } = render(<SpotlightCard as="article">Body</SpotlightCard>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.tagName).toBe('ARTICLE');
    expect(card.className).toContain('fx-spot');
    fireEvent.pointerMove(card, { clientX: 5, clientY: 5 });
    expect(card.style.getPropertyValue('--fx-x')).toBe('');
  });
});

describe('landing polish', () => {
  const props = {
    onStart: vi.fn(),
    onJoin: vi.fn(() => Promise.resolve(true)),
    onScripted: vi.fn(),
  };

  it('shows only figures that the repository documents', () => {
    const { container } = render(<LandingScreen {...props} />);
    const numbers = container.querySelectorAll('#numbers .gv-stats__num');
    expect(Array.from(numbers).map((n) => n.textContent)).toEqual([
      '606',
      '589',
      '40',
      '294',
      '568',
    ]);
    expect(screen.getByText(t('mk.stat.note'), { exact: false })).toBeTruthy();
  });

  it('draws the money flow with three captioned steps', () => {
    const { container } = render(<LandingScreen {...props} />);
    const flow = container.querySelector('.gv-flow');
    expect(flow?.getAttribute('data-state')).toBe('drawn');
    expect(flow?.querySelector('svg[role="img"]')).not.toBeNull();
    expect(flow?.querySelectorAll('li.gv-flow__item')).toHaveLength(3);
  });

  it('lists the technology as plain text chips', () => {
    reduceMotion(true);
    render(<LandingScreen {...props} />);
    const group = screen.getByRole('group', { name: t('mk.tech.label') });
    expect(within(group).getByText('PayPal sandbox')).toBeTruthy();
    expect(within(group).getByText('Deepgram')).toBeTruthy();
    expect(group.querySelector('img')).toBeNull();
  });

  it('adds a sticky call to action that opens the scripted demo', () => {
    const { container } = render(<LandingScreen {...props} />);
    const bar = container.querySelector('.gv-sticky-cta');
    expect(bar).not.toBeNull();
    const link = within(bar as HTMLElement).getByRole('link', { name: t('mk.cta.try') });
    expect(link.getAttribute('href')).toBe('/demo/scripted');
    fireEvent.click(link);
    expect(props.onScripted).toHaveBeenCalled();
  });

  it('shows the sticky bar after scrolling past the hero', () => {
    // Without an observer the hook reports "seen" at once, which hides the bar; stand in one that
    // never reports the closing section as visible.
    class IdleObserver {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('IntersectionObserver', IdleObserver);
    const { container } = render(<LandingScreen {...props} />);
    const bar = container.querySelector('.gv-sticky-cta');
    expect(bar?.getAttribute('data-show')).toBe('false');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 900 });
    act(() => {
      fireEvent.scroll(window);
    });
    expect(bar?.getAttribute('data-show')).toBe('true');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('has a footer with product, project and proof columns and the sandbox note', () => {
    render(<LandingScreen {...props} />);
    const footer = screen.getByRole('contentinfo');
    const nav = within(footer).getByRole('navigation', { name: t('mk.foot.nav') });
    expect(within(nav).getAllByRole('link').length).toBeGreaterThanOrEqual(8);
    expect(nav.querySelector('a[href="/try"]')).toBeNull();
    expect(within(footer).getByText(t('mk.foot.sandbox'))).toBeTruthy();
  });

  it('keeps the headline as one h1 with the full thesis', () => {
    render(<LandingScreen {...props} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('landing.title'));
  });
});
