import { ICON_PATHS, type IconName } from './paths';

export interface IconProps {
  readonly name: IconName;
  /** Accessible name from the copy catalog. Without it the icon is hidden from assistive technology. */
  readonly title?: string;
  readonly size?: number;
}

export function Icon({ name, title, size = 24 }: IconProps) {
  const labelled = title !== undefined && title !== '';
  const markup = (labelled ? `<title>${escapeText(title)}</title>` : '') + ICON_PATHS[name];
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
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
