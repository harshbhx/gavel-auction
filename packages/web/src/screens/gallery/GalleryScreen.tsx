import { useState } from 'react';
import { Announcer } from '../../a11y/Announcer';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { Button } from '../../design/primitives/Button';
import { Chip } from '../../design/primitives/Chip';
import { Dialog } from '../../design/primitives/Dialog';
import { Ladder } from '../../ladder/Ladder';
import { happy } from '../../testing/scenarios/happy';
import { TEST_IDS } from '../../testing/testids';

/**
 * Dev and preview only: primitives in their states, and one specimen for every id in the test id
 * contract that a screen owns (R-WEB-125). Each id appears exactly once on this page.
 */
export function GalleryScreen() {
  const [open, setOpen] = useState(false);
  // The ladder specimen shows only with ?ladder, so the committed gallery baselines stay as they are.
  const withLadder = new URLSearchParams(window.location.search).has('ladder');
  return (
    <section>
      <Announcer />
      <Banner tone="info" icon={<Icon name="lock" />}>
        {t('banner.sandbox')}
      </Banner>
      <h2>{t('gallery.specimen')}</h2>
      <div>
        <Button>{t('landing.start')}</Button>
        <Button variant="outline">{t('landing.join')}</Button>
        <Button disabled>{t('landing.join')}</Button>
        <Button variant="outline" data-testid={TEST_IDS.dialogOpen} onClick={() => setOpen(true)}>
          {t('gallery.openDialog')}
        </Button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('gallery.specimen')}>
        <Button onClick={() => setOpen(false)}>{t('gallery.closeDialog')}</Button>
      </Dialog>
      <div>
        <Chip state="current" label={t('app.name')} icon={<Icon name="current" />} />
        <Chip state="hollow" label={t('app.name')} icon={<Icon name="hollow" />} tone="warning" />
      </div>
      {withLadder && <Ladder view={happy.settlementViews?.[1] ?? null} />}
      <p className="gv-hammer-stamp" data-testid={TEST_IDS.hammerStamp}>
        {t('screen.passed')}
      </p>
      <pre data-testid={TEST_IDS.auditJson} tabIndex={0}>
        {'{}'}
      </pre>
      <div data-testid={TEST_IDS.auditScroll} />
      <div data-testid={TEST_IDS.consoleColumns} />
      <section data-testid={TEST_IDS.heldBlock} />
      <p className="gv-price-tick" data-testid={TEST_IDS.screenPrice}>
        {t('app.name')}
      </p>
    </section>
  );
}
