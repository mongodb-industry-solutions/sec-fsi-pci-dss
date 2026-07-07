'use client';
// Accessible tooltip primitive (Radix). Wrap the app once in <TooltipProvider>,
// then use <Tip label="…"> around any trigger. Keyboard + screen-reader friendly.
import * as RT from '@radix-ui/react-tooltip';
import { useState, type ReactNode } from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RT.Provider delayDuration={150} skipDelayDuration={300}>{children}</RT.Provider>;
}

export function Tip({
  label,
  children,
  side = 'top',
  asChild = true,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  asChild?: boolean;
}) {
  // Controlled so hover/focus AND click/tap all reveal the tooltip (better usability + touch).
  // Radix closes on pointer-down by default, so we re-open on click right after that fires.
  const [open, setOpen] = useState(false);
  return (
    <RT.Root open={open} onOpenChange={setOpen}>
      <RT.Trigger asChild={asChild} onClick={() => setOpen(true)}>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-[16rem] rounded-lg bg-leaf-ink px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-card [animation:tt-in_120ms_ease-out]"
        >
          {label}
          <RT.Arrow className="fill-leaf-ink" />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
