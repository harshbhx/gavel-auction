const color: Record<string, string> = {
  get: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  post: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  put: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  patch: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  delete: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
};

export function MethodBadge({ method, small = false }: { method: string; small?: boolean }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-[2px] font-mono font-bold uppercase ${color[method] ?? 'bg-fd-muted'} ${
        small ? 'w-12 px-1 py-px text-center text-[0.6rem]' : 'px-2 py-0.5 text-xs'
      }`}
    >
      {method}
    </span>
  );
}
