import { t } from '../../copy/t';
import { Field } from '../../design/primitives/Field';
import { parseGoalInput, type GoalInput } from '../screen/fundraiser';

/** The message under the goal field, or undefined when the text is empty or a good amount. */
export function goalError(input: GoalInput): string | undefined {
  if (input.kind === 'invalid') return t('goal.invalid');
  if (input.kind === 'tooBig') return t('goal.tooBig');
  return undefined;
}

export interface GoalFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** Optional fundraiser goal for room setup. Empty hides the thermometer on the projection screen. */
export function GoalField({ value, onChange }: GoalFieldProps) {
  const error = goalError(parseGoalInput(value));
  return (
    <Field
      label={t('goal.label')}
      hint={t('goal.hint')}
      {...(error === undefined ? {} : { error })}
      value={value}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      name="fundraiserGoal"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
