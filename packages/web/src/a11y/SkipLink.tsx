import { t } from '../copy/t';
import './a11y.css';

/** The first tab stop of every page: jumps to the page's main landmark, and shows on focus. */
export function SkipLink() {
  return (
    <a
      className="gv-skip"
      href="#main"
      onClick={(e) => {
        const main = document.querySelector<HTMLElement>('main');
        if (main === null) return;
        e.preventDefault();
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
        main.focus();
      }}
    >
      {t('a11y.skip')}
    </a>
  );
}
