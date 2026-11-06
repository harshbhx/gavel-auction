import { useEffect, useRef } from 'react';
import { t } from '../../copy/t';

export interface NotFoundProps {
  readonly homeHref?: string;
}

export function NotFound({ homeHref = '/' }: NotFoundProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = t('err.notFound');
    heading.current?.focus();
  }, []);
  return (
    <main data-route="notFound">
      <h1 ref={heading} tabIndex={-1}>
        {t('err.notFound')}
      </h1>
      <a href={homeHref}>{t('err.home')}</a>
    </main>
  );
}

export default NotFound;
