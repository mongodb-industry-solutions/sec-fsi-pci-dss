'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  text: string;
}

interface Position {
  top: number;
  left: number;
}

export function Tooltip({ text }: Props) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<Position>({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setMounted(true); }, []);

  function show() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.top, left: r.left + r.width / 2 });
    setVisible(true);
  }

  return (
    <span className="inline-block ml-1 align-middle">
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
        onFocus={show}
        onBlur={() => setVisible(false)}
        className="text-gray-400 hover:text-blue-500 focus:text-blue-500 focus:outline-none text-xs leading-none transition-colors"
        aria-label="More information"
      >
        ⓘ
      </button>

      {mounted && visible && createPortal(
        <span
          style={{
            position: 'fixed',
            top: pos.top - 10,
            left: pos.left,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
          className="w-64 rounded-lg bg-[#001E2B] text-white text-xs px-3 py-2 shadow-xl pointer-events-none leading-relaxed"
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#001E2B]" />
        </span>,
        document.body,
      )}
    </span>
  );
}
