// Small dynamic building blocks: counting numbers, drifting colour fields, pointer
// spotlights and credits. All of them go still when animations are switched off.
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { brand } from '@/config/brand';
import { formatNumber, t } from '@/i18n';
import { cx } from './ui';

function motionAllowed(): boolean {
  if (document.documentElement.dataset.motion === 'off') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A number that counts up to its value when it appears or changes. */
export function CountUp({ value, duration = 900, className }: { value: number; duration?: number; className?: string }) {
  const [shown, setShown] = useState(() => (motionAllowed() ? 0 : value));
  const from = useRef(0);
  useEffect(() => {
    if (!motionAllowed()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      setShown(Math.round(origin + (value - origin) * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, duration]);
  // The real value is always what assistive technology reads.
  return (
    <span className={cx('tabular-nums', className)} aria-label={formatNumber(value)} data-value={value}>
      {formatNumber(shown)}
    </span>
  );
}

/** Decorative drifting colour fields. Purely visual. */
export function Aurora() {
  return (
    <span className="aurora" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/** A surface with a soft light that follows the pointer. */
export function Spotlight({ className, children, ...rest }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('spotlight', className)}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** "A Product of Unique Labs. Developed by Shahriar Ahmed" with links, from brand.config.json. */
export function Credits({ className, stacked }: { className?: string; stacked?: boolean }) {
  const link = 'link-underline font-medium text-zinc-700 hover:text-brand-700 dark:text-zinc-200 dark:hover:text-brand-300';
  const product = brand.productOf.replace(brand.company, '').trim();
  return (
    <span className={cx('text-zinc-500 dark:text-zinc-400', className)} data-testid="credits">
      <span>
        {product}{' '}
        <a href={brand.urls.homepage} target="_blank" rel="noopener noreferrer" className={link}>
          {brand.company}
        </a>
        .
      </span>
      {stacked ? <br /> : ' '}
      <span>
        {t('Developed by')}{' '}
        <a href={brand.developer.url} target="_blank" rel="noopener noreferrer" className={link}>
          {brand.developer.name}
        </a>
        .
      </span>
    </span>
  );
}
