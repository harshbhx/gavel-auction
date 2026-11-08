import { t } from '../../copy/t';
import { hubHref } from './hubKeys';
import './hub.css';

export interface TokenHelpProps {
  /** The room the link was for, when the address names one. */
  readonly roomId?: string | undefined;
  /** `register` is a join link with no personal invite; the rest are keyed room links. */
  readonly kind?: 'room' | 'register';
}

/** What to do when a link lost its token: go back to the hub or start a new demo. */
export function TokenHelp({ roomId, kind = 'room' }: TokenHelpProps) {
  return (
    <div className="gv-help" data-token-help={kind}>
      <p>{kind === 'register' ? t('tokenHelp.registerLead') : t('tokenHelp.lead')}</p>
      {kind === 'room' && (
        <ol className="gv-help__steps">
          <li>{t('tokenHelp.step1')}</li>
          <li>{t('tokenHelp.step2')}</li>
        </ol>
      )}
      {roomId !== undefined && (
        <a className="gv-flow__action" href={hubHref(roomId)}>
          {t('hub.backToHub')}
        </a>
      )}
    </div>
  );
}

export default TokenHelp;
