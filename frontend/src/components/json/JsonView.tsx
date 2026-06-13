'use client';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import ReactJsonView from '@uiw/react-json-view';
import { lightTheme } from '@uiw/react-json-view/light';
import { darkTheme } from '@uiw/react-json-view/dark';
import { ChevronsDownUp, ChevronsUpDown, Copy, Check } from 'lucide-react';

// Reusable read-only JSON viewer: syntax-highlighted collapsible tree with
// expand/collapse-all and copy. Themed for the app's light (admin forms) and
// dark (#001E2B raw/debug panels) surfaces. Falls back to a <pre> for primitives
// and for the pre-hydration render (avoids SSR/window issues).

export interface JsonViewProps {
  /** Object/array to render. Strings are parsed as JSON when possible. */
  data: unknown;
  theme?: 'light' | 'dark';
  /** CSS max-height for the scroll area, e.g. '20rem' or 320. @default '20rem' */
  maxHeight?: string | number;
  /** Initial collapse depth (number) or fully collapsed (true). @default 2 */
  collapsed?: number | boolean;
  /** Hide the toolbar (expand/collapse all + copy). @default false */
  hideToolbar?: boolean;
  /**
   * Override the container background/border classes to match the surrounding
   * section (e.g. "bg-gray-900 border-gray-800"). The JSON tree itself is always
   * transparent and inherits this background. Defaults to the theme's surface.
   */
  surfaceClassName?: string;
  className?: string;
}

/** Coerce input into something the tree can render; null when it's not an object. */
function toRenderable(data: unknown): object | null {
  if (data && typeof data === 'object') return data as object;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') return parsed as object;
    } catch { /* not JSON — render as text below */ }
  }
  return null;
}

function asText(data: unknown): string {
  if (data === null || data === undefined) return String(data);
  if (typeof data === 'string') return data;
  try { return JSON.stringify(data, null, 2); } catch { return String(data); }
}

export function JsonView({
  data,
  theme = 'light',
  maxHeight = '20rem',
  collapsed = 2,
  hideToolbar = false,
  surfaceClassName,
  className = '',
}: JsonViewProps) {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  // Bumped to remount the tree when toggling expand/collapse-all.
  const [renderKey, setRenderKey] = useState(0);
  const [collapseState, setCollapseState] = useState<number | boolean>(collapsed);

  useEffect(() => { setMounted(true); }, []);

  const renderable = useMemo(() => toRenderable(data), [data]);
  const isDark = theme === 'dark';
  const maxH = typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;

  const copyAll = () => {
    navigator.clipboard.writeText(asText(data)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const toggle = (next: number | boolean) => {
    setCollapseState(next);
    setRenderKey((k) => k + 1);
  };

  const surface = surfaceClassName ?? (isDark
    ? 'bg-[#001E2B] border-[#0a3a4a]'
    : 'bg-gray-50 border-gray-200');
  // Neutral translucent divider works on any surface (teal, gray-900, light).
  const divider = isDark ? 'border-white/10' : 'border-black/10';
  const btn = isDark
    ? 'text-gray-400 hover:text-gray-100'
    : 'text-gray-500 hover:text-gray-800';
  // The tree inherits the container background instead of painting its own,
  // so it blends with whatever surface the caller provides.
  const treeStyle = {
    ...(isDark ? darkTheme : lightTheme),
    '--w-rjv-background-color': 'transparent',
  } as CSSProperties;

  // Primitive / non-JSON / pre-hydration: show a themed <pre>.
  if (!mounted || !renderable) {
    return (
      <div className={`rounded-lg border overflow-hidden ${surface} ${className}`}>
        <pre
          className={`text-xs font-mono px-3 py-2.5 overflow-auto whitespace-pre-wrap break-all ${isDark ? 'text-green-300' : 'text-gray-700'}`}
          style={{ maxHeight: maxH }}
        >
          {asText(data) || <span className="italic opacity-60">empty</span>}
        </pre>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${surface} ${className}`}>
      {!hideToolbar && (
        <div className={`flex items-center gap-3 px-3 py-1.5 border-b ${divider}`}>
          <button type="button" onClick={() => toggle(false)} className={`inline-flex items-center gap-1 text-[11px] ${btn} transition-colors`} title="Expand all">
            <ChevronsUpDown size={12} /> Expand all
          </button>
          <button type="button" onClick={() => toggle(true)} className={`inline-flex items-center gap-1 text-[11px] ${btn} transition-colors`} title="Collapse all">
            <ChevronsDownUp size={12} /> Collapse all
          </button>
          <button type="button" onClick={copyAll} className={`inline-flex items-center gap-1 text-[11px] ml-auto ${btn} transition-colors`} title="Copy JSON">
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <div className="overflow-auto px-3 py-2.5" style={{ maxHeight: maxH }}>
        <ReactJsonView
          key={renderKey}
          value={renderable}
          collapsed={collapseState}
          style={treeStyle}
          displayDataTypes={false}
          displayObjectSize
          enableClipboard
          shortenTextAfterLength={0}
        />
      </div>
    </div>
  );
}

export default JsonView;
