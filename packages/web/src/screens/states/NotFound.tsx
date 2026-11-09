import { useEffect, useRef } from 'react';
import { t } from '../../copy/t';
import { Logo } from '../../design/Logo';
import '../flows.css';

/** Where the help links point. The docs site is the public home of the judges guide. */
export const NOT_FOUND_DOCS_URL = 'https://docs.gavel.dualmindlab.tech';
export const NOT_FOUND_JUDGES_URL = `${NOT_FOUND_DOCS_URL}/docs/judges`;

/** `page`: no such page. `room`: the link points at a room the server does not know. `code`: a join code that matches nothing. */
export type NotFoundKind = 'page' | 'room' | 'code';

export interface NotFoundProps {
  readonly kind?: NotFoundKind;
}

const TITLE = {
  page: 'err.notFound',
  room: 'room.missingTitle',
  code: 'join.notFound',
} as const;

const HELP = {
  page: 'nf.pageHelp',
  room: 'room.missingHelp',
  code: 'join.notFoundHelp',
} as const;

/** The one not-found screen: an unknown page, a missing room or a code that matches no auction. */
export function NotFound({ kind = 'page' }: NotFoundProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = t(TITLE[kind]);
    heading.current?.focus();
  }, [kind]);
  return (
    <main className="gv-flow gv-notfound" data-route="notFound" data-state={kind}>
      <p className="ui-kicker">
        <Logo variant="lockup" height={40} />
      </p>
      <h1 ref={heading} tabIndex={-1}>
        {t(TITLE[kind])}
      </h1>
      <p className="gv-join__help">{t(HELP[kind])}</p>
      <nav className="gv-notfound__links" aria-label={t('nf.linksLabel')}>
        {kind !== 'page' && (
          <a className="gv-flow__action" href="/">
            {t('join.tryAgain')}
          </a>
        )}
        <a className="gv-flow__action" href="/try">
          {t('nf.demo')}
        </a>
        <a className="gv-flow__action" href={NOT_FOUND_JUDGES_URL}>
          {t('nf.judges')}
        </a>
        <a className="gv-flow__action" href={NOT_FOUND_DOCS_URL}>
          {t('nf.docs')}
        </a>
      </nav>
    </main>
  );
}

export default NotFound;
