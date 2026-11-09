import { useEffect, useRef } from 'react';
import { WideAside } from '../WideAside';
import { t } from '../../copy/t';
import { Logo } from '../../design/Logo';
import '../flows.css';

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
    <main className="gv-flow" data-route="notFound">
      <p className="ui-kicker">
        <Logo variant="lockup" height={40} />
      </p>
      <h1 ref={heading} tabIndex={-1}>
        {t('err.notFound')}
      </h1>
      <a className="gv-flow__action" href={homeHref}>
        {t('err.home')}
      </a>
      <WideAside />
    </main>
  );
}

export default NotFound;
