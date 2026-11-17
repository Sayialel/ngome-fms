import { useId } from 'react';
import { cn } from '@/lib/utils';

// The Ngome motif, carried over from the NUC: a linework echo of the shield and
// crossed spears in the Ngome mark. A small badge beside page titles, and a faint
// repeating pattern on the dark sidebar and sign-in screen.

const GOLD = 'hsl(var(--sidebar-primary))';

function MarkPaths() {
  return (
    <>
      <path d="M10.5 9.5 L37.5 40.5 M37.5 9.5 L10.5 40.5" />
      <path d="M6 4.5 L13.5 7.5 L10.8 10.6 Z M42 4.5 L34.5 7.5 L37.2 10.6 Z" />
      <path d="M24 7 C31 12 34 18 34 25 C34 32 31 38 24 43 C17 38 14 32 14 25 C14 18 17 12 24 7 Z" />
      <path d="M24 7 V43" />
      <path d="M27 14 L31 18 M27 20 L32.5 25 L27 30 M27 34 L31 31" />
    </>
  );
}

export function SpearsMark({ className, strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={cn('shrink-0', className)}>
      <MarkPaths />
    </svg>
  );
}

/** Faint repeating motif for dark surfaces. Place inside a `relative` parent. */
export function MotifPattern({ className, opacity = 0.07 }: { className?: string; opacity?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg aria-hidden="true" focusable="false" className={cn('pointer-events-none absolute inset-0 h-full w-full', className)} style={{ opacity }}>
      <defs>
        <pattern id={`ngome-motif-${id}`} width="96" height="96" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={GOLD} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" transform="translate(24 24)">
            <MarkPaths />
          </g>
          <g fill="none" stroke={GOLD} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" transform="translate(72 72) scale(0.5) translate(-24 -24)">
            <MarkPaths />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#ngome-motif-${id})`} />
    </svg>
  );
}
