import React, { forwardRef } from 'react';
import { css, cx } from '@emotion/css';

export type BadgeVariant =
  'default' | 'brand' | 'warning' | 'success' | 'danger' | 'info' | 'neutral';

export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual color variant */
  variant?: BadgeVariant;
  /** Size variant */
  size?: BadgeSize;
  /** Whether to render a colored indicator dot */
  dot?: boolean;
  /** Whether the indicator dot should have a breathing pulse animation */
  pulse?: boolean;
  /** Render as rounded pill instead of standard chamfered tag */
  pill?: boolean;
  /** Optional leading icon */
  icon?: React.ReactNode;
  /** Content of the badge */
  children?: React.ReactNode;
}

/**
 * Generic, self-contained Badge component for labels, status chips, and dev tags.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  {
    variant = 'default',
    size = 'md',
    dot = false,
    pulse = false,
    pill = false,
    icon,
    className,
    children,
    ...props
  },
  ref
) {
  const showDot = dot || pulse;

  return (
    <span
      ref={ref}
      className={cx(
        styles.base,
        styles.variants[variant],
        styles.sizes[size],
        pill && styles.pill,
        className
      )}
      {...props}
    >
      {showDot && (
        <span
          className={cx(styles.dot, styles.dotVariants[variant], pulse && styles.pulseDot)}
          aria-hidden="true"
        />
      )}
      {icon && <span className={styles.icon}>{icon}</span>}
      {children && <span className={styles.content}>{children}</span>}
    </span>
  );
});

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const styles = {
  base: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-family-mono, monospace);
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.05em;
    user-select: none;
    border-radius: var(--radius-sm, 3px);
    border: 1px solid transparent;
    box-sizing: border-box;
    flex-shrink: 0;
    white-space: nowrap;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      color 0.15s ease;
  `,

  pill: css`
    border-radius: var(--radius-full, 9999px);
  `,

  sizes: {
    xs: css`
      padding: 1px 3.5px;
      font-size: 8.5px;
      gap: 3px;
    `,
    sm: css`
      padding: 1.5px 5px;
      font-size: 9.5px;
      gap: 4px;
    `,
    md: css`
      padding: 2px 7px;
      font-size: 10.5px;
      gap: 4.5px;
    `,
    lg: css`
      padding: 3px 9px;
      font-size: 12px;
      gap: 5px;
    `,
  },

  variants: {
    default: css`
      background: var(--bg-tertiary, #282e33);
      color: var(--text-secondary, #a3aaad);
      border-color: var(--border-color, rgba(86, 93, 97, 0.2));
    `,
    neutral: css`
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-tertiary, #6b7276);
      border-color: var(--border-color, rgba(86, 93, 97, 0.2));
    `,
    brand: css`
      background: rgba(47, 143, 122, 0.14);
      color: var(--color-brand, #2f8f7a);
      border-color: rgba(47, 143, 122, 0.38);
      box-shadow: 0 0 10px rgba(47, 143, 122, 0.15);
      &:hover {
        background: rgba(47, 143, 122, 0.22);
        border-color: rgba(47, 143, 122, 0.55);
      }
    `,
    warning: css`
      background: rgba(208, 151, 47, 0.14);
      color: var(--color-warning, #d0972f);
      border-color: rgba(208, 151, 47, 0.38);
      box-shadow: 0 0 10px rgba(208, 151, 47, 0.15);
      &:hover {
        background: rgba(208, 151, 47, 0.22);
        border-color: rgba(208, 151, 47, 0.6);
        box-shadow: 0 0 14px rgba(208, 151, 47, 0.28);
      }
    `,
    success: css`
      background: rgba(79, 157, 92, 0.14);
      color: var(--color-success, #4f9d5c);
      border-color: rgba(79, 157, 92, 0.38);
      box-shadow: 0 0 10px rgba(79, 157, 92, 0.15);
      &:hover {
        background: rgba(79, 157, 92, 0.22);
        border-color: rgba(79, 157, 92, 0.55);
      }
    `,
    danger: css`
      background: rgba(192, 57, 43, 0.14);
      color: var(--color-error, #c0392b);
      border-color: rgba(192, 57, 43, 0.38);
      box-shadow: 0 0 10px rgba(192, 57, 43, 0.15);
      &:hover {
        background: rgba(192, 57, 43, 0.22);
        border-color: rgba(192, 57, 43, 0.55);
      }
    `,
    info: css`
      background: rgba(47, 111, 168, 0.14);
      color: var(--color-info, #2f6fa8);
      border-color: rgba(47, 111, 168, 0.38);
      box-shadow: 0 0 10px rgba(47, 111, 168, 0.15);
      &:hover {
        background: rgba(47, 111, 168, 0.22);
        border-color: rgba(47, 111, 168, 0.55);
      }
    `,
  },

  dot: css`
    width: 4.5px;
    height: 4.5px;
    border-radius: 50%;
    flex-shrink: 0;
  `,

  pulseDot: css`
    animation: badgePulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    @keyframes badgePulse {
      0%,
      100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.35;
        transform: scale(0.75);
      }
    }
  `,

  dotVariants: {
    default: css`
      background: var(--text-secondary, #a3aaad);
    `,
    neutral: css`
      background: var(--text-tertiary, #6b7276);
    `,
    brand: css`
      background: var(--color-brand, #2f8f7a);
      box-shadow: 0 0 4px var(--color-brand, #2f8f7a);
    `,
    warning: css`
      background: var(--color-warning, #d0972f);
      box-shadow: 0 0 4px var(--color-warning, #d0972f);
    `,
    success: css`
      background: var(--color-success, #4f9d5c);
      box-shadow: 0 0 4px var(--color-success, #4f9d5c);
    `,
    danger: css`
      background: var(--color-error, #c0392b);
      box-shadow: 0 0 4px var(--color-error, #c0392b);
    `,
    info: css`
      background: var(--color-info, #2f6fa8);
      box-shadow: 0 0 4px var(--color-info, #2f6fa8);
    `,
  },

  icon: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  `,

  content: css`
    display: inline-block;
  `,
};
