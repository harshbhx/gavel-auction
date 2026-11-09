'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from 'next-themes';
import { Maximize2, Minus, Plus, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/cn';

// Renders ```mermaid code blocks (converted by remarkMdxMermaid) on the client.
// - bordered card, full content width, scrolls sideways when the diagram is wider than the page
// - click (or the expand button) opens a full-screen view with zoom controls
// - themed for light/dark with the MealMind amber + neutral palette
// - a diagram that fails to parse shows an error box with its source instead of breaking the page

type MermaidModule = typeof import('mermaid')['default'];

let mermaidPromise: Promise<MermaidModule> | undefined;
function loadMermaid() {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  return mermaidPromise;
}

// Mermaid needs hex/rgb colours (it derives shades itself), so these mirror the
// amber primary and neutral greys from app/global.css.
const fontFamily =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const lightTheme = {
  darkMode: false,
  fontFamily,
  fontSize: '14px',
  background: '#ffffff',
  primaryColor: '#fdf1d6',
  primaryBorderColor: '#c4870f',
  primaryTextColor: '#1c1917',
  secondaryColor: '#f5f5f4',
  secondaryBorderColor: '#a8a29e',
  secondaryTextColor: '#1c1917',
  tertiaryColor: '#fafaf9',
  tertiaryBorderColor: '#d6d3d1',
  tertiaryTextColor: '#1c1917',
  lineColor: '#78716c',
  textColor: '#1c1917',
  mainBkg: '#fdf1d6',
  nodeBorder: '#c4870f',
  clusterBkg: '#fafaf9',
  clusterBorder: '#d6d3d1',
  titleColor: '#1c1917',
  edgeLabelBackground: '#ffffff',
  noteBkgColor: '#fef9c3',
  noteBorderColor: '#d4a017',
  noteTextColor: '#1c1917',
  actorBkg: '#fdf1d6',
  actorBorder: '#c4870f',
  actorTextColor: '#1c1917',
  actorLineColor: '#a8a29e',
  signalColor: '#44403c',
  signalTextColor: '#1c1917',
  labelBoxBkgColor: '#f5f5f4',
  labelBoxBorderColor: '#a8a29e',
  labelTextColor: '#1c1917',
  loopTextColor: '#1c1917',
  activationBkgColor: '#fbe3a6',
  activationBorderColor: '#c4870f',
  sequenceNumberColor: '#ffffff',
  attributeBackgroundColorOdd: '#ffffff',
  attributeBackgroundColorEven: '#fafaf9',
};

const darkTheme = {
  darkMode: true,
  fontFamily,
  fontSize: '14px',
  background: '#0c0a09',
  primaryColor: '#2b2110',
  primaryBorderColor: '#f7b31e',
  primaryTextColor: '#f5f5f4',
  secondaryColor: '#262626',
  secondaryBorderColor: '#57534e',
  secondaryTextColor: '#f5f5f4',
  tertiaryColor: '#171717',
  tertiaryBorderColor: '#44403c',
  tertiaryTextColor: '#f5f5f4',
  lineColor: '#a8a29e',
  textColor: '#e7e5e4',
  mainBkg: '#2b2110',
  nodeBorder: '#f7b31e',
  clusterBkg: '#141414',
  clusterBorder: '#44403c',
  titleColor: '#f5f5f4',
  edgeLabelBackground: '#1c1917',
  noteBkgColor: '#3a2f12',
  noteBorderColor: '#a87a14',
  noteTextColor: '#f5f5f4',
  actorBkg: '#2b2110',
  actorBorder: '#f7b31e',
  actorTextColor: '#f5f5f4',
  actorLineColor: '#57534e',
  signalColor: '#d6d3d1',
  signalTextColor: '#f5f5f4',
  labelBoxBkgColor: '#262626',
  labelBoxBorderColor: '#57534e',
  labelTextColor: '#f5f5f4',
  loopTextColor: '#f5f5f4',
  activationBkgColor: '#3d2f12',
  activationBorderColor: '#f7b31e',
  sequenceNumberColor: '#0c0a09',
  attributeBackgroundColorOdd: '#1c1917',
  attributeBackgroundColorEven: '#141414',
};

// Renders are serialised: mermaid.initialize() is global, and parallel renders
// on one page can otherwise pick up each other's config.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

type Result =
  | { status: 'loading' }
  | { status: 'ok'; svg: string; width: number; height: number; id: string }
  | { status: 'error'; message: string };

function svgSize(svg: string): { width: number; height: number } {
  const viewBox = /viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  return { width: 800, height: 600 };
}

export function Mermaid({ chart }: { chart: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const source = chart.replaceAll('\\n', '\n').trim();

  if (!mounted) return <MermaidFrame>{<Placeholder />}</MermaidFrame>;
  return <MermaidContent chart={source} />;
}

function MermaidContent({ chart }: { chart: string }) {
  const rawId = useId();
  const baseId = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const [result, setResult] = useState<Result>({ status: 'loading' });
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `${baseId}-${dark ? 'd' : 'l'}`;

    enqueue(async () => {
      const mermaid = await loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: dark ? darkTheme : lightTheme,
        fontFamily,
        flowchart: { useMaxWidth: false, htmlLabels: true, padding: 12 },
        sequence: { useMaxWidth: false },
        class: { useMaxWidth: false },
        state: { useMaxWidth: false },
        er: { useMaxWidth: false },
        gantt: { useMaxWidth: false },
        journey: { useMaxWidth: false },
        requirement: { useMaxWidth: false },
        mindmap: { useMaxWidth: false },
        timeline: { useMaxWidth: false },
        c4: { useMaxWidth: false },
        pie: { useMaxWidth: false },
        quadrantChart: { useMaxWidth: false },
        xyChart: { useMaxWidth: false },
        sankey: { useMaxWidth: false },
        block: { useMaxWidth: false },
        architecture: { useMaxWidth: false },
      });
      try {
        // parse() gives a clean error message before render() touches the DOM.
        await mermaid.parse(chart);
        const { svg } = await mermaid.render(id, chart);
        return { status: 'ok', svg, id, ...svgSize(svg) } satisfies Result;
      } finally {
        // A failed render leaves its temporary container in <body>.
        document.getElementById(`d${id}`)?.remove();
      }
    })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setResult({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [chart, dark, baseId]);

  if (result.status === 'error') return <MermaidError message={result.message} chart={chart} />;
  if (result.status === 'loading') return <MermaidFrame>{<Placeholder />}</MermaidFrame>;

  return (
    <>
      <MermaidFrame onExpand={() => setZoomed(true)}>
        <div className="overflow-x-auto fd-scroll-container">
          <div
            role="button"
            tabIndex={0}
            aria-label="Open diagram full screen"
            onClick={() => setZoomed(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setZoomed(true);
              }
            }}
            // Wide diagrams shrink to fit the column, but never below 60% of their natural
            // size: past that the card scrolls sideways so labels stay readable.
            style={
              {
                '--mm-w': `${result.width}px`,
                '--mm-min': `${Math.round(Math.min(result.width, Math.max(result.width * 0.6, 320)))}px`,
              } as React.CSSProperties
            }
            className="cursor-zoom-in p-4 outline-none focus-visible:ring-2 focus-visible:ring-fd-primary sm:p-6 [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:w-(--mm-w) [&_svg]:max-w-full [&_svg]:min-w-(--mm-min)"
            dangerouslySetInnerHTML={{ __html: result.svg }}
          />
        </div>
      </MermaidFrame>
      {zoomed && (
        <ZoomDialog
          // Distinct ids so the copy in the dialog doesn't clash with the inline one.
          svg={result.svg.replaceAll(result.id, `${result.id}-zoom`)}
          width={result.width}
          height={result.height}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
}

function MermaidFrame({ children, onExpand }: { children: React.ReactNode; onExpand?: () => void }) {
  return (
    <figure className="not-prose group relative my-6 overflow-hidden rounded-xl border bg-fd-card shadow-sm">
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand diagram"
          title="Expand"
          className="absolute end-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border bg-fd-background/80 px-2 py-1 text-xs font-medium text-fd-muted-foreground opacity-80 backdrop-blur transition hover:text-fd-foreground group-hover:opacity-100"
        >
          <Maximize2 className="size-3.5" />
          Expand
        </button>
      )}
      {children}
    </figure>
  );
}

function Placeholder() {
  return <div className="h-40 animate-pulse bg-fd-muted/40" aria-label="Loading diagram" />;
}

function MermaidError({ message, chart }: { message: string; chart: string }) {
  return (
    <div
      role="alert"
      className="not-prose my-6 rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300">
        <TriangleAlert className="size-4" />
        This diagram could not be rendered
      </p>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-fd-muted-foreground">{message}</pre>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-fd-muted-foreground">Show diagram source</summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-fd-muted p-3 text-xs">{chart}</pre>
      </details>
    </div>
  );
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

function ZoomDialog({
  svg,
  width,
  height,
  onClose,
}: {
  svg: string;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const padding = 48;
    const s = Math.min((el.clientWidth - padding) / width, (el.clientHeight - padding) / height);
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)));
  }, [width, height]);

  useEffect(() => {
    fit();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(MAX_SCALE, s * 1.25));
      if (e.key === '-') setScale((s) => Math.max(MIN_SCALE, s / 1.25));
      if (e.key === '0') fit();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
    };
  }, [fit, onClose]);

  const button =
    'inline-flex size-8 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Diagram"
      className="fixed inset-0 z-[100] flex flex-col bg-fd-background/95 backdrop-blur-sm"
    >
      <div className="flex items-center justify-end gap-1 border-b bg-fd-background px-3 py-2">
        <span className="me-auto text-sm font-medium text-fd-muted-foreground">Diagram</span>
        <button type="button" className={button} aria-label="Zoom out" onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.25))}>
          <Minus className="size-4" />
        </button>
        <span className="w-14 text-center text-xs tabular-nums text-fd-muted-foreground">{Math.round(scale * 100)}%</span>
        <button type="button" className={button} aria-label="Zoom in" onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.25))}>
          <Plus className="size-4" />
        </button>
        <button type="button" className={button} aria-label="Fit to screen" onClick={fit}>
          <RotateCcw className="size-4" />
        </button>
        <button type="button" className={cn(button, 'ms-2')} aria-label="Close" onClick={onClose} autoFocus>
          <X className="size-5" />
        </button>
      </div>
      <div
        ref={viewport}
        className="flex flex-1 overflow-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="m-auto shrink-0 p-6 [&_svg]:size-full [&_svg]:max-w-none"
          style={{ width: width * scale + 48, height: height * scale + 48 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>,
    document.body,
  );
}
