import { t } from '../copy/t';
import { Icon } from './icons';
import { Banner } from './primitives/Banner';

/** The sandbox notice. Rendered on every route, including 404 and the error boundary (R-WEB-034). */
export function SandboxBanner() {
  return (
    <Banner tone="info" icon={<Icon name="lock" />}>
      {t('banner.sandbox')}
    </Banner>
  );
}
