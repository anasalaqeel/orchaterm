import React from 'react';
import { Info } from 'lucide-react';
import { css, cx } from '@emotion/css';
import { Tooltip } from './Tooltip';

const iconStyle = css`
  width: 12px;
  height: 12px;
  color: var(--text-tertiary);
  cursor: help;
  flex-shrink: 0;
  transition: color 0.15s ease;

  &:hover {
    color: var(--color-brand, #3b82f6);
  }
`;

export interface InfoTooltipProps {
  content: React.ReactNode;
  className?: string;
  width?: number;
}

/** Info icon that reveals an explanatory tooltip on hover/focus — drop next to a label. */
export const InfoTooltip: React.FC<InfoTooltipProps> = ({ content, className, width }) => (
  <Tooltip content={content} width={width}>
    <Info className={cx(iconStyle, className)} />
  </Tooltip>
);
