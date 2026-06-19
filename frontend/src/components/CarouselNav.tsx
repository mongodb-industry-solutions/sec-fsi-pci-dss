'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';

// Mobile-only horizontal nav with edge-overlay chevrons. Lives below the `md`
// breakpoint only; each consumer keeps its own desktop form (vertical sidebar).
// Chevrons + gradient fades appear only when the strip actually overflows, so a
// menu that fits (e.g. the 4-item customer bar) shows no controls at all.

export interface CarouselNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface CarouselNavProps {
  items: CarouselNavItem[];
  isActive: (href: string) => boolean;
  /** light = merchant section strip (white) · dark = role bottom bar (#001E2B) */
  variant: 'light' | 'dark';
}

const STYLES = {
  light: {
    fade: 'from-white',
    btn: 'bg-white/70 ring-1 ring-black/5 text-[#001E2B] shadow-sm',
    list: 'gap-1 px-2 py-2',
    iconSize: 16,
  },
  dark: {
    fade: 'from-[#001E2B]',
    btn: 'bg-[#001E2B]/70 ring-1 ring-white/10 text-[#00ED64]',
    list: '',
    iconSize: 20,
  },
} as const;

export function CarouselNav({ items, isActive, variant }: CarouselNavProps) {
  const s = STYLES[variant];
  const scroller = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Bring the active item into view (centered) when there is overflow.
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
    return () => ro.disconnect();
  }, [update]);

  const nudge = (dir: -1 | 1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <div className="relative">
      {/* Left fade + chevron */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-10 z-10 bg-gradient-to-r ${s.fade} to-transparent transition-opacity ${canLeft ? 'opacity-100' : 'opacity-0'}`}
      />
      <button
        type="button"
        aria-label="Scroll left"
        tabIndex={canLeft ? 0 : -1}
        onClick={() => nudge(-1)}
        className={`absolute left-1 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full backdrop-blur-sm flex items-center justify-center transition-opacity ${s.btn} ${canLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <ChevronLeft size={16} />
      </button>

      <ul
        ref={scroller}
        onScroll={update}
        className={`flex overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${s.list}`}
      >
        {items.map((it) => {
          const active = isActive(it.href);
          const Icon = it.icon;
          return (
            <li
              key={it.href}
              ref={active ? activeRef : undefined}
              className={variant === 'light' ? 'shrink-0' : 'flex-1 min-w-[64px]'}
            >
              {variant === 'light' ? (
                <Link
                  href={it.href}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    active ? 'bg-[#001E2B] text-[#00ED64]' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Icon size={s.iconSize} className="shrink-0" />
                  <span>{it.label}</span>
                </Link>
              ) : (
                <Link
                  href={it.href}
                  className={`w-full flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                    active ? 'text-[#00ED64]' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <Icon size={s.iconSize} className="shrink-0" />
                  <span className="truncate max-w-[56px] text-center leading-tight">{it.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {/* Right fade + chevron */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-10 z-10 bg-gradient-to-l ${s.fade} to-transparent transition-opacity ${canRight ? 'opacity-100' : 'opacity-0'}`}
      />
      <button
        type="button"
        aria-label="Scroll right"
        tabIndex={canRight ? 0 : -1}
        onClick={() => nudge(1)}
        className={`absolute right-1 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full backdrop-blur-sm flex items-center justify-center transition-opacity ${s.btn} ${canRight ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
