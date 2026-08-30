import React from 'react';
import { Badge, type BadgeProps } from './Badge';

export interface DevBadgeProps extends Omit<BadgeProps, 'children'> {
  /** Override or force visibility. Defaults to `import.meta.env.DEV`. */
  show?: boolean;
  /** Text label, defaults to "DEV" */
  label?: string;
}

/**
 * Specialized development indicator badge built directly on the generic Badge primitive.
 */
export const DevBadge: React.FC<DevBadgeProps> = ({
  show = import.meta.env.DEV,
  label = 'DEV',
  variant = 'warning',
  size = 'sm',
  pulse = true,
  title = 'Development Build — Running in developer mode',
  'aria-label': ariaLabel = 'Development build badge',
  ...rest
}) => {
  if (!show) return null;

  return (
    <Badge
      variant={variant}
      size={size}
      pulse={pulse}
      title={title}
      aria-label={ariaLabel}
      data-testid="dev-badge"
      {...rest}
    >
      {label}
    </Badge>
  );
};
