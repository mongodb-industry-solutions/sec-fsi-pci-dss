'use client';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import ReactJsonView from '@uiw/react-json-view';
import { lightTheme } from '@uiw/react-json-view/light';
import { darkTheme } from '@uiw/react-json-view/dark';
import { createPortal } from 'react-dom';
import { ChevronsDownUp, ChevronsUpDown, Copy, Check, Maximize2, X } from 'lucide-react';

// A read-only JSON tree: syntax highlighted, collapsible, copyable, and expandable to fullscreen.
//
// This is the same viewer the provider's admin uses, and it is here rather than imported because these are two
// separately deployed apps. What differs is the palette: the provider's is painted in its own brand colours,
// and this one reads the bank's theme tokens, so it follows the operator's light or dark preference instead of
// staying bright inside a dark page.
//
// It exists because a raw dump in a `<pre>` is where an operator stops reading. An audit row's context object
// is nested, and finding one field in it by eye is the difference between a trail that gets used and one that
// gets ignored.

export interface JsonViewProps {
  data: unknown;
  /** CSS max-height for the inline scroll area. */
  maxHeight?: string | number;
  /** Initial collapse depth, or `true` for fully collapsed. */
  collapsed?: number | boolean;
  title?: string;
  className?: string;
}

/** Coerces the input into something the tree can render; null when it is not an object. */
function toRenderable(data: unknown): object | null {
  if (data && typeof data === 'object') return data as object;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') return parsed as object;
    } catch { /* not JSON, rendered as text below */ }
  }
  return null;
}

function asText(data: unknown): string {
  if (data === null || data === undefined) return String(data);
  if (typeof data === 'string') return data;
  try { return JSON.stringify(data, null, 2); } catch { return String(data); }
}

export function JsonView({
  data, maxHeight = '20rem', collapsed = 2, title = 'JSON', className = '',
}: JsonViewProps) {
  const [mounted, setMounted] = useState(false);
  const [dark, setDark] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0, top: 0, left: 0 });
  const [copied, setCopied] = useState(false);
  // Bumped to remount the tree when expand-all or collapse-all is used.
  const [renderKey, setRenderKey] = useState(0);
  const [collapseState, setCollapseState] = useState<number | boolean>(collapsed);

  // The tree's own palette is a JS object, so it cannot read a CSS variable: the scheme has to be observed.
  // Watched rather than read once, because a viewer who flips their system theme with the page open should see
  // the tree follow the rest of the page.
  useEffect(() => {
    setMounted(true);
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setDark(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // Mobile browsers report a stale height for `100dvh` while the URL bar collapses or the keyboard is open,
  // which leaves a fullscreen dialog short of the real screen. Measuring the visual viewport is the only
  // reliable size.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false); };
    const visual = window.visualViewport;
    const measure = () => setViewport({
      width: visual?.width ?? window.innerWidth,
      height: visual?.height ?? window.innerHeight,
      top: visual?.offsetTop ?? 0,
      left: visual?.offsetLeft ?? 0,
    });

    measure();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    visual?.addEventListener('resize', measure);
    visual?.addEventListener('scroll', measure);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      visual?.removeEventListener('resize', measure);
      visual?.removeEventListener('scroll', measure);
    };
  }, [fullscreen]);

  const renderable = useMemo(() => toRenderable(data), [data]);
  const maxHeightValue = typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;

  function copyAll() {
    navigator.clipboard.writeText(asText(data)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* a browser that refuses the clipboard is not an error worth a dialog */ });
  }

  function toggle(next: number | boolean) {
    setCollapseState(next);
    setRenderKey((key) => key + 1);
  }

  const action = 'inline-flex shrink-0 items-center gap-1 py-1 text-[11px] text-ink-soft transition hover:text-ink';
  // The tree inherits the container's background rather than painting its own, so it blends into the surface
  // the caller gives it.
  const treeStyle = {
    ...(dark ? darkTheme : lightTheme),
    '--w-rjv-background-color': 'transparent',
    fontSize: 'inherit',
  } as CSSProperties;

  const viewer = (isOverlay: boolean) => (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2 py-1.5 sm:px-3">
        {renderable && (
          <>
            <button type="button" onClick={() => toggle(false)} className={action} title="Expand all">
              <ChevronsUpDown size={12} aria-hidden /> <span className="hidden sm:inline">Expand all</span>
            </button>
            <button type="button" onClick={() => toggle(true)} className={action} title="Collapse all">
              <ChevronsDownUp size={12} aria-hidden /> <span className="hidden sm:inline">Collapse all</span>
            </button>
          </>
        )}
        <button type="button" onClick={copyAll} className={`${action} ml-auto`} title="Copy JSON">
          {copied ? <Check size={12} className="text-emerald-500" aria-hidden /> : <Copy size={12} aria-hidden />}
          <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        {!isOverlay && (
          <button type="button" onClick={() => setFullscreen(true)} className={action} title="Expand to fullscreen">
            <Maximize2 size={12} aria-hidden /> <span className="hidden md:inline">Fullscreen</span>
          </button>
        )}
      </div>
      <div
        className={`overflow-auto px-2 py-2.5 text-[11px] [overflow-wrap:anywhere] sm:px-3 sm:text-[13px] ${
          isOverlay ? 'min-h-0 flex-1' : ''
        }`}
        style={isOverlay ? undefined : { maxHeight: maxHeightValue }}
      >
        {renderable ? (
          <ReactJsonView
            key={`${renderKey}-${isOverlay ? 'full' : 'inline'}`}
            value={renderable}
            collapsed={collapseState}
            style={treeStyle}
            displayDataTypes={false}
            displayObjectSize
            enableClipboard
            shortenTextAfterLength={0}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-ink">
            {asText(data) || <span className="italic opacity-60">empty</span>}
          </pre>
        )}
      </div>
    </>
  );

  // Before hydration: a plain block, no portal and no toolbar, which avoids a server and client mismatch.
  if (!mounted) {
    return (
      <div className={`overflow-hidden rounded-xl border border-line bg-surface-alt ${className}`}>
        <pre
          className="overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-xs text-ink"
          style={{ maxHeight: maxHeightValue }}
        >
          {asText(data) || <span className="italic opacity-60">empty</span>}
        </pre>
      </div>
    );
  }

  return (
    <>
      <div className={`overflow-hidden rounded-xl border border-line bg-surface-alt ${className}`}>
        {viewer(false)}
      </div>

      {fullscreen && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50 flex overscroll-contain bg-black/70 p-0 sm:p-4"
          style={viewport.height > 0 ? {
            top: viewport.top,
            left: viewport.left,
            width: viewport.width,
            height: viewport.height,
            right: 'auto',
            bottom: 'auto',
          } : undefined}
          onClick={() => setFullscreen(false)}
        >
          <div
            className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col overflow-hidden rounded-none border-0 bg-surface sm:rounded-xl sm:border sm:border-line"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <span className="truncate text-xs font-semibold text-ink">{title}</span>
              <button type="button" onClick={() => setFullscreen(false)} className={`${action} ml-auto`} title="Close">
                <X size={14} aria-hidden /> <span className="hidden sm:inline">Close</span>
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{viewer(true)}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
