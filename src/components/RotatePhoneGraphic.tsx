import { cn } from '@/lib/utils';

/**
 * A phone outline that turns from upright to sideways and back, showing the
 * two side-by-side halves once it is sideways. Gentle by design: slow, small,
 * and still (drawn sideways) for anyone who prefers reduced motion.
 */
export default function RotatePhoneGraphic({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('rotate-phone-hint', className)} aria-hidden>
      <g className="rotate-phone-hint__phone">
        <rect x="10" y="4" width="12" height="24" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        {/* The two eyes, one above the other while upright = side by side once turned. */}
        <rect className="rotate-phone-hint__eyes" x="12.5" y="7.5" width="7" height="7.5" rx="0.8" fill="currentColor" />
        <rect className="rotate-phone-hint__eyes" x="12.5" y="17" width="7" height="7.5" rx="0.8" fill="currentColor" />
      </g>
    </svg>
  );
}
