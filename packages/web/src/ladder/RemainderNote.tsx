import { t } from '../copy/t';
import type { RemainderState } from '../wire';

/** The four remainder states, each with its own wording. Only the released state says released. */
export function RemainderNote({
  remainder,
  className,
}: {
  remainder: RemainderState;
  className?: string;
}) {
  return (
    <span className={className} data-remainder={remainder}>
      {t(`hold.remainder.${remainder}`)}
    </span>
  );
}
