import { t } from '../copy/t';
import './flows.css';

/**
 * The money rule beside a narrow flow page. It is shown from 1100 px wide (see flows.css) so a wide
 * screen is not left half empty; on phones and tablets it is not rendered at all.
 */
export function WideAside() {
  const steps = [
    { id: 's1', title: t('mk.how.s1.title'), body: t('mk.how.s1.body') },
    { id: 's2', title: t('mk.how.s2.title'), body: t('mk.how.s2.body') },
    { id: 's3', title: t('mk.how.s3.title'), body: t('mk.how.s3.body') },
  ];
  return (
    <section className="gv-aside" aria-labelledby="gv-aside-title">
      <p className="ui-kicker" id="gv-aside-title">
        {t('mk.how.title')}
      </p>
      <p className="gv-aside__lead">{t('mk.how.lead')}</p>
      <div className="gv-aside__steps">
        {steps.map((s) => (
          <div key={s.id} className="gv-aside__step">
            <p className="gv-aside__name">{s.title}</p>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
