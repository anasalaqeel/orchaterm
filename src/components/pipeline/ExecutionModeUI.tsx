import React from 'react';
import { css, cx } from '@emotion/css';
import { ListOrdered, Zap } from 'lucide-react';

interface ExecutionModeBadgeProps {
  mode: 'sequential' | 'parallel';
  className?: string;
  size?: number;
  short?: boolean;
}

export const ExecutionModeBadge: React.FC<ExecutionModeBadgeProps> = ({ mode, className, size = 10, short = false }) => {
  const isSeq = mode === 'sequential';
  return (
    <span
      className={cx(styles.badge, isSeq ? styles.badgeSeq : styles.badgePar, className)}
      title={
        isSeq
          ? 'Sequential: tasks run one after another, each waiting for the previous to finish'
          : 'Parallel: tasks with no dependencies run concurrently'
      }
    >
      {isSeq ? <ListOrdered size={size} /> : <Zap size={size} />}
      {isSeq ? (short ? 'Seq' : 'Sequential') : (short ? 'Par' : 'Parallel')}
    </span>
  );
};

interface ExecutionModeToggleProps {
  mode: 'sequential' | 'parallel';
  onChange: (mode: 'sequential' | 'parallel') => void;
  className?: string;
  disabled?: boolean;
}

export const ExecutionModeToggle: React.FC<ExecutionModeToggleProps> = ({ mode, onChange, className, disabled }) => {
  return (
    <div className={cx(styles.toggleContainer, className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('sequential')}
        className={cx(styles.toggleBtn, mode === 'sequential' && styles.toggleBtnActive)}
        title="Sequential: task N waits for task N-1"
      >
        <ListOrdered size={11} /> Sequential
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('parallel')}
        className={cx(styles.toggleBtn, mode === 'parallel' && styles.toggleBtnActive)}
        title="Parallel: tasks run concurrently where dependencies allow"
      >
        <Zap size={11} /> Parallel
      </button>
    </div>
  );
};

const styles = {
  badge: css`
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 600; padding: 2px 6px;
    border-radius: 4px; border: 1px solid transparent;
  `,
  badgeSeq: css`
    color: var(--color-brand); background: rgba(var(--color-brand-rgb), 0.1); border-color: rgba(var(--color-brand-rgb), 0.25);
  `,
  badgePar: css`
    color: var(--color-warning); background: rgba(var(--color-warning-rgb), 0.1); border-color: rgba(var(--color-warning-rgb), 0.25);
  `,
  toggleContainer: css`
    display: flex; gap: 2px;
    background: var(--bg-input); border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm); padding: 2px;
  `,
  toggleBtn: css`
    flex: 1;
    display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    background: transparent; border: none; cursor: pointer;
    color: var(--text-tertiary); font-size: 11px; font-weight: 600;
    padding: 5px 8px; border-radius: 4px;
    &:hover:not(:disabled) { color: var(--text-primary); }
    &:disabled { opacity: 0.5; cursor: default; }
  `,
  toggleBtnActive: css`
    background: var(--color-brand); color: #fff;
    &:hover:not(:disabled) { color: #fff; }
  `,
};
