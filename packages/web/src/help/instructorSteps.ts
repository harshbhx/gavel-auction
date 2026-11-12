/** Instructor: the steps of the judge page (/try). Copy lives in en.ts. */
import type { CopyKey } from '../copy/en';

export type InstructorScreen = 'try';

type StepKey = Extract<CopyKey, `instructor.${InstructorScreen}.${number}`>;

export const INSTRUCTOR_STEPS: Readonly<Record<InstructorScreen, readonly StepKey[]>> = {
  try: ['instructor.try.1', 'instructor.try.2', 'instructor.try.3'],
};
