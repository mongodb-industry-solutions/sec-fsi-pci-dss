'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Plain text, or rich content when an inline icon makes the hint clearer than describing it. */
  text: ReactNode;
  /** Wrap an existing control instead of rendering the ⓘ glyph. Use it to replace a native `title`. */
  children?: ReactNode;
}

interface Position {
  top: number;
  left: number;
  below: boolean;
}

// Enough room for the tallest bubble the fixed width produces.
const ESTIMATED_HEIGHT = 96;

export function Tooltip({ text, children }: Props) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<Position>({ top: 0, left: 0, below: false });
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => { setMounted(true); }, []);

  function show() {
    // The wrapper uses display:contents so it never disturbs layout, and therefore has no box of its
    // own: measure the trigger element instead.
    const el = (triggerRef.current?.firstElementChild as HTMLElement | null) ?? triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < ESTIMATED_HEIGHT;
    setPos({ top: below ? r.bottom : r.top, left: r.left + r.width / 2, below });
    setVisible(true);
  }
  const hide = () => setVisible(false);

  return (
    <span className={children ? 'contents' : 'inline-block ml-1 align-middle'}>
      {/* A wrapped control is often a <button>, so the trigger must not be one itself. */}
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={children ? 'contents' : 'inline-block'}
      >
        {children ?? (
          <button
            type="button"
            className="text-gray-400 hover:text-blue-500 focus:text-blue-500 focus:outline-none text-xs leading-none transition-colors"
            aria-label="More information"
          >
            ⓘ
          </button>
        )}
      </span>

      {mounted && visible && createPortal(
        <span
          style={{
            position: 'fixed',
            top: pos.below ? pos.top + 10 : pos.top - 10,
            left: pos.left,
            transform: pos.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
          className="w-64 rounded-lg bg-[#001E2B] text-white text-xs px-3 py-2 shadow-xl pointer-events-none leading-relaxed"
        >
          {text}
          <span className={`absolute left-1/2 -translate-x-1/2 border-4 border-transparent ${
            pos.below ? 'bottom-full border-b-[#001E2B]' : 'top-full border-t-[#001E2B]'}`} />
        </span>,
        document.body,
      )}
    </span>
  );
}
