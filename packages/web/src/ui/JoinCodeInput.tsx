import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

export interface JoinCodeInputProps {
  /** The characters typed so far, without the prefix. */
  value: string;
  onChange: (code: string) => void;
  /** Called once when every slot is filled. */
  onComplete?: (code: string) => void;
  /** Number of characters after the prefix. Default 4. */
  length?: number;
  /** Shown before the slots and stripped from pasted text. Default "GVL-". */
  prefix?: string;
  /** Shown under the slots; marks the field invalid when `invalid` is set. */
  message?: string;
  invalid?: boolean;
  disabled?: boolean;
}

/** Keeps letters and digits, upper-cases them and drops a leading prefix from pasted text. */
export function normalizeCode(raw: string, prefix: string, length: number): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pre = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body =
    pre !== '' && clean.startsWith(pre) && clean.length > length ? clean.slice(pre.length) : clean;
  return body.slice(0, length);
}

/** A room code field in one-time-code style: one slot per character, auto-advance, paste, backspace. */
export function JoinCodeInput({
  value,
  onChange,
  onComplete,
  length = 4,
  prefix = 'GVL-',
  message,
  invalid = false,
  disabled = false,
}: JoinCodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const slots = Array.from({ length }, (_, i) => i);
  const chars = value.padEnd(length, ' ').slice(0, length);

  const focusSlot = (i: number): void => {
    refs.current[Math.min(Math.max(i, 0), length - 1)]?.focus();
  };

  const commit = (next: string, focusAt: number): void => {
    onChange(next);
    if (next.length === length && next.trim().length === length) onComplete?.(next);
    focusSlot(focusAt);
  };

  const replaceAt = (i: number, incoming: string): void => {
    const current = chars[i] ?? ' ';
    const raw = current !== ' ' && incoming.length > 1 ? incoming.replace(current, '') : incoming;
    const typed = normalizeCode(raw, prefix, length);
    if (typed === '') return;
    const head = value.slice(0, i).padEnd(i, ' ');
    const next = (head + typed + value.slice(i + typed.length)).slice(0, length).trimEnd();
    commit(next.replace(/ /g, ''), i + typed.length);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (chars[i] !== ' ') {
        onChange(value.slice(0, i) + value.slice(i + 1));
      } else if (i > 0) {
        onChange(value.slice(0, i - 1) + value.slice(i));
        focusSlot(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusSlot(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusSlot(i + 1);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    e.preventDefault();
    const pasted = normalizeCode(e.clipboardData.getData('text'), prefix, length);
    if (pasted === '') return;
    commit(pasted, Math.min(pasted.length, length - 1));
  };

  return (
    <div className="ui-otp" data-invalid={invalid ? 'true' : undefined}>
      <div
        className="ui-otp__row"
        role="group"
        aria-label={`Room code, ${length} characters after ${prefix}`}
      >
        <span className="ui-otp__prefix" aria-hidden="true">
          {prefix}
        </span>
        {slots.map((i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="ui-otp__slot"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            spellCheck={false}
            maxLength={length}
            value={chars[i] === ' ' ? '' : chars[i]}
            disabled={disabled}
            aria-label={`Character ${i + 1} of ${length}`}
            aria-invalid={invalid ? true : undefined}
            onChange={(e) => {
              replaceAt(i, e.target.value);
            }}
            onKeyDown={(e) => {
              onKeyDown(i, e);
            }}
            onPaste={onPaste}
            onFocus={(e) => {
              e.currentTarget.select();
            }}
          />
        ))}
      </div>
      <p className="ui-otp__message" role={invalid ? 'alert' : 'status'} aria-live="polite">
        {message}
      </p>
    </div>
  );
}
