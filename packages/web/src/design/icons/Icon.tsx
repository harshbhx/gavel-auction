import { ICON_PATHS, type IconName, type IconShape } from './paths';

export interface IconProps {
  readonly name: IconName;
  /** Accessible name from the copy catalog. Without it the icon is hidden from assistive technology. */
  readonly title?: string;
  readonly size?: number;
}

function Shape({ shape }: { readonly shape: IconShape }) {
  switch (shape.tag) {
    case 'path':
      return <path d={shape.d} {...(shape.fill === undefined ? {} : { fill: shape.fill })} />;
    case 'circle':
      return (
        <circle
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
          {...(shape.fill === undefined ? {} : { fill: shape.fill })}
        />
      );
    case 'rect':
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          {...(shape.rx === undefined ? {} : { rx: shape.rx })}
        />
      );
  }
}

/** Shapes are React elements, so a title is escaped by React and nothing is parsed as markup. */
export function Icon({ name, title, size = 24 }: IconProps) {
  const labelled = title !== undefined && title !== '';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(labelled ? { role: 'img' } : { 'aria-hidden': true })}
    >
      {labelled && <title>{title}</title>}
      {ICON_PATHS[name].map((shape, i) => (
        <Shape key={i} shape={shape} />
      ))}
    </svg>
  );
}
