import { useEffect, useRef, useState } from 'react';
import { t } from '../../copy/t';
import { SpotlightCard } from '../../ui/fx';

/** The hold, shown beside the steps and changing with the one in view. Desktop only, decorative. */
export function HowPanel({ step }: { step: 1 | 2 | 3 }) {
  const text = [t('mk.how.panel.s1'), t('mk.how.panel.s2'), t('mk.how.panel.s3')][step - 1];
  return (
    <aside className="gv-panel" data-step={step} aria-hidden="true">
      <SpotlightCard className="gv-panel__card">
        <p className="ui-kicker">{t('mk.how.panel.label')}</p>
        <div className="gv-panel__bar">
          <i className="gv-panel__seg gv-panel__seg--held" />
          <i className="gv-panel__seg gv-panel__seg--charged" />
          <i className="gv-panel__seg gv-panel__seg--released" />
        </div>
        <p className="gv-panel__text">{text}</p>
      </SpotlightCard>
    </aside>
  );
}

/** Which step list item crosses the middle of the screen. 1 until the page says otherwise. */
export function useActiveStep(
  count: number,
): [(el: HTMLElement | null, i: number) => void, number] {
  const [active, setActive] = useState(0);
  const nodes = useRef<(HTMLElement | null)[]>([]);
  const register = (el: HTMLElement | null, i: number): void => {
    nodes.current[i] = el;
  };
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = nodes.current.indexOf(entry.target as HTMLElement);
          if (i >= 0 && i < count) setActive(i);
        }
      },
      { rootMargin: '-40% 0px -40% 0px' },
    );
    for (const el of nodes.current) if (el !== null) io.observe(el);
    return () => io.disconnect();
  }, [count]);
  return [register, active];
}
