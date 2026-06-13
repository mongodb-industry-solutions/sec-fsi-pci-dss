'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { ReactCodeMirrorRef, EditorView } from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { foldGutter, foldAll, unfoldAll, codeFolding } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { Braces, FoldVertical, UnfoldVertical, Copy, Check } from 'lucide-react';

// Reusable JSON editor built on CodeMirror: syntax highlighting, inline JSON
// linting (gutter markers), code folding (fold/unfold all), one-click pretty
// format, and copy. Controlled via `value`/`onChange`. Pre-hydration it renders a
// plain <textarea> with the same value/onChange so SSR is stable and editing
// still works before CodeMirror loads.

export interface JsonEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  theme?: 'light' | 'dark';
  /** External validation message to surface under the editor (e.g. from a parent). */
  error?: string | null;
  minHeight?: string;
  maxHeight?: string;
  placeholder?: string;
  className?: string;
}

export function JsonEditor({
  value,
  onChange,
  readOnly = false,
  theme = 'light',
  error = null,
  minHeight = '12rem',
  maxHeight = '24rem',
  placeholder,
  className = '',
}: JsonEditorProps) {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => { setMounted(true); }, []);

  const isDark = theme === 'dark';

  const extensions = useMemo(
    () => [json(), lintGutter(), linter(jsonParseLinter()), codeFolding(), foldGutter(), EditorView.lineWrapping],
    [],
  );

  const format = () => {
    try {
      const pretty = JSON.stringify(JSON.parse(value), null, 2);
      setFormatError(null);
      onChange?.(pretty);
    } catch (e) {
      setFormatError((e as Error).message);
    }
  };

  const fold = () => { const v = cmRef.current?.view; if (v) foldAll(v); };
  const unfold = () => { const v = cmRef.current?.view; if (v) unfoldAll(v); };

  const copyAll = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const surface = isDark ? 'bg-[#001E2B] border-[#0a3a4a]' : 'bg-white border-gray-200';
  const btn = isDark ? 'text-gray-400 hover:text-gray-100' : 'text-gray-500 hover:text-gray-800';
  const shownError = error ?? formatError;

  return (
    <div className={className}>
      <div className={`rounded-lg border overflow-hidden ${error ? 'border-red-400' : surface}`}>
        {/* Toolbar */}
        <div className={`flex items-center gap-3 px-3 py-1.5 border-b ${isDark ? 'border-[#0a3a4a]' : 'border-gray-200'}`}>
          {!readOnly && (
            <button type="button" onClick={format} className={`inline-flex items-center gap-1 text-[11px] ${btn} transition-colors`} title="Pretty-print JSON">
              <Braces size={12} /> Format
            </button>
          )}
          <button type="button" onClick={fold} className={`inline-flex items-center gap-1 text-[11px] ${btn} transition-colors`} title="Fold all">
            <FoldVertical size={12} /> Fold all
          </button>
          <button type="button" onClick={unfold} className={`inline-flex items-center gap-1 text-[11px] ${btn} transition-colors`} title="Unfold all">
            <UnfoldVertical size={12} /> Unfold all
          </button>
          <button type="button" onClick={copyAll} className={`inline-flex items-center gap-1 text-[11px] ml-auto ${btn} transition-colors`} title="Copy">
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* Editor (CodeMirror after mount; textarea fallback before) */}
        {mounted ? (
          <CodeMirror
            ref={cmRef}
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            editable={!readOnly}
            theme={isDark ? oneDark : 'light'}
            extensions={extensions}
            placeholder={placeholder}
            minHeight={minHeight}
            maxHeight={maxHeight}
            basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly }}
          />
        ) : (
          <textarea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            placeholder={placeholder}
            className={`w-full px-3 py-2 text-xs font-mono resize-y focus:outline-none ${isDark ? 'bg-[#001E2B] text-green-300' : 'bg-white text-gray-800'}`}
            style={{ minHeight }}
          />
        )}
      </div>
      {shownError && <p className="text-red-600 text-xs mt-1">{shownError}</p>}
    </div>
  );
}

export default JsonEditor;
