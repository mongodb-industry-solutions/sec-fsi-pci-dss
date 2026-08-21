'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  children: React.ReactNode;
}

interface Position {
  top: number;
  left: number;
  width: number;
}

export function StepExplainer({ title, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position>({ top: 0, left: 0, width: 320 });
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current  && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function toggle() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const panelW = 320;
    // Prefer opening to the left if too close to the right edge
    const leftEdge = Math.min(r.left, window.innerWidth - panelW - 12);
    setPos({ top: r.bottom + 8, left: Math.max(8, leftEdge), width: panelW });
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="ml-2 px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition-colors font-medium"
      >
        ? About this step
      </button>

      {mounted && open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 9999,
          }}
          className="rounded-xl bg-white border border-blue-200 shadow-xl p-4"
        >
          <p className="font-semibold text-gray-800 mb-2">{title}</p>
          <div className="text-sm text-gray-600 space-y-2 leading-relaxed">{children}</div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 text-xs text-gray-400 hover:text-gray-600"
          >
            Close
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
