import { useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { t } from '../copy/t';
import { formatUsdCompact } from '../util/money';
import { nearestStop, sliderStops } from './format';

export interface CeilingSliderProps {
  /** Current ceiling in cents. */
  value: number;
  onChange: (cents: number) => void;
  min: number;
  max: number;
  /** Snap step in cents; positions are round multiples of it, plus the two ends. */
  step: number;
  /** Extra amounts (such as preset quick picks) the slider can also rest on. */
  marks?: readonly number[];
  /** A tick is drawn every `step`; a tall one every `majorEvery` cents. Default 2 steps. */
  majorEvery?: number;
  label?: string;
  disabled?: boolean;
}

/** A price ceiling slider with ticks and snapping. Pointer, arrows, PageUp/PageDown, Home and End. */
export function CeilingSlider({
  value,
  onChange,
  min,
  max,
  step,
  marks,
  majorEvery,
  label = t('ui.slider.label'),
  disabled = false,
}: CeilingSliderProps) {
  const labelId = useId();
  const track = useRef<HTMLDivElement | null>(null);
  const major = majorEvery ?? step * 2;
  const span = Math.max(1, max - min);
  const stops = sliderStops(min, max, step, marks);
  const at = nearestStop(stops, value);
  const pct = ((at - min) / span) * 100;
  const ticks = sliderStops(min, max, step);

  const set = (next: number): void => {
    if (disabled) return;
    const snapped = nearestStop(stops, next);
    if (snapped !== value) onChange(snapped);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>): void => {
    const rect = track.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0) return;
    set(min + ((e.clientX - rect.left) / rect.width) * span);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const index = stops.indexOf(at);
    const stopAt = (i: number): number =>
      stops[Math.min(stops.length - 1, Math.max(0, i))] ?? at;
    const moves: Readonly<Record<string, number>> = {
      ArrowRight: stopAt(index + 1),
      ArrowUp: stopAt(index + 1),
      ArrowLeft: stopAt(index - 1),
      ArrowDown: stopAt(index - 1),
      PageUp: stopAt(index + 5),
      PageDown: stopAt(index - 5),
      Home: min,
      End: max,
    };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    set(next);
  };

  return (
    <div className="ui-slider" style={{ '--ui-v': pct } as CSSProperties}>
      <div className="ui-slider__head">
        <span className="ui-kicker" id={labelId}>
          {label}
        </span>
        <output className="ui-slider__out">{formatUsdCompact(value)}</output>
      </div>
      <div
        ref={track}
        className="ui-slider__track"
        role="slider"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatUsdCompact(value)}
        aria-disabled={disabled ? true : undefined}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0) fromPointer(e);
        }}
        onKeyDown={onKeyDown}
      >
        <div className="ui-slider__fill" />
        <div className="ui-slider__ticks" aria-hidden="true">
          {ticks.map((v) => (
            <s
              key={v}
              className={
                v === min || v % major === 0
                  ? 'ui-slider__tick ui-slider__tick--major'
                  : 'ui-slider__tick'
              }
              style={{ left: `${((v - min) / span) * 100}%` }}
            />
          ))}
        </div>
        <i className="ui-slider__knob" />
      </div>
      <div className="ui-slider__scale" aria-hidden="true">
        <span>{formatUsdCompact(min)}</span>
        <span>{formatUsdCompact(max)}</span>
      </div>
    </div>
  );
}
