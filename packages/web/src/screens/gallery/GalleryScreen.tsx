import { Announcer } from '../../a11y/Announcer';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { Button } from '../../design/primitives/Button';
import { Chip } from '../../design/primitives/Chip';
import { TEST_IDS } from '../../testing/testids';

/**
 * Dev and preview only: primitives in their states, and one specimen for every id in the test id
 * contract that a screen owns (R-WEB-125). Each id appears exactly once on this page.
 */
export function GalleryScreen() {
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
      </div>
      <div>
        <Chip state="current" label={t('app.name')} icon={<Icon name="current" />} />
        <Chip state="hollow" label={t('app.name')} icon={<Icon name="hollow" />} tone="warning" />
      </div>
      <pre data-testid={TEST_IDS.auditJson} tabIndex={0}>
        {'{}'}
      </pre>
      <div data-testid={TEST_IDS.auditScroll} />
      <div data-testid={TEST_IDS.consoleColumns} />
      <section data-testid={TEST_IDS.heldBlock} />
      <p data-testid={TEST_IDS.screenPrice}>{t('app.name')}</p>
    </section>
  );
}
