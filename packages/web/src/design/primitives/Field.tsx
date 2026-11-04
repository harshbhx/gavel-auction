import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import './primitives.css';

export interface FieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'aria-describedby' | 'aria-invalid'> {
  label: string;
  hint?: string;
  error?: string;
  /** Decorative icon shown with the error text so the error is not colour only (R-WEB-016). */
  errorIcon?: ReactNode;
}

/** Wires label, hint and error to the input with htmlFor and aria-describedby. */
export function Field({ label, hint, error, errorIcon, className, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    hint === undefined ? null : hintId,
    error === undefined ? null : errorId,
  ].filter((v): v is string => v !== null);

  return (
    <div className="gv-field">
      <label className="gv-field__label" htmlFor={id}>
        {label}
      </label>
      {hint !== undefined && (
        <span className="gv-field__hint" id={hintId}>
          {hint}
        </span>
      )}
      <input
        {...input}
        id={id}
        className={['gv-input', className].filter(Boolean).join(' ')}
        aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(' ')}
        aria-invalid={error === undefined ? undefined : true}
      />
      {error !== undefined && (
        <span className="gv-field__error" id={errorId} role="alert">
          {errorIcon !== undefined && <span aria-hidden="true">{errorIcon}</span>}
          <span>{error}</span>
        </span>
      )}
    </div>
  );
}
