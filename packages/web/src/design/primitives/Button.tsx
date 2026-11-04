import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import './primitives.css';

export type ButtonSize = 'bid' | 'default';
export type ButtonVariant = 'solid' | 'outline';
export type ButtonTone = 'accent' | 'danger' | 'positive' | 'neutral';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'children'> {
  /** `bid` is at least 48 px, `default` at least 40 px (R-WEB-015). */
  size?: ButtonSize;
  variant?: ButtonVariant;
  tone?: ButtonTone;
  /** Exposed as aria-disabled so the control stays focusable and visible (R-WEB-024). */
  disabled?: boolean;
  children: ReactNode;
}

export function Button({
  size = 'default',
  variant = 'solid',
  tone = 'accent',
  disabled = false,
  type = 'button',
  className,
  onClick,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['gv-btn', `gv-btn--${size}`, `gv-btn--${variant}`, className]
    .filter((c): c is string => c !== undefined && c !== '')
    .join(' ');
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      data-size={size}
      data-tone={tone}
      aria-disabled={disabled ? true : undefined}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}
