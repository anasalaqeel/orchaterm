import React from 'react';
import { css, cx } from '@emotion/css';
import { TASK_STATUS_COLORS, TASK_STATUS_ICONS } from './pipelineConstants';
import type { OrchestratorTaskStatus } from '../../types';

export interface TaskRowProps {
  index: number;
  title: string;
  agentHint?: string;
  status?: OrchestratorTaskStatus;
  dependsOn?: string; // e.g. "after #1, #2"
  filesCount?: number;
  className?: string;
  onClick?: () => void;
}

export const TaskRow: React.FC<TaskRowProps> = ({
  index,
  title,
  agentHint,
  status,
  dependsOn,
  filesCount,
  className,
  onClick,
}) => {
  return (
    <div
      className={cx(styles.row, onClick && styles.clickable, className)}
      onClick={onClick}
    >
      {status && (
        <span className={styles.statusIcon} style={{ color: TASK_STATUS_COLORS[status] }}>
          {TASK_STATUS_ICONS[status]}
        </span>
      )}
      <span className={styles.num}>{index}.</span>
      <span className={styles.title} title={title}>{title}</span>
      {agentHint && <span className={styles.agent}>→ {agentHint}</span>}
      {dependsOn && <span className={styles.deps}>{dependsOn}</span>}
      {typeof filesCount === 'number' && filesCount > 0 ? (
        <span className={styles.filesBadge}>
          {filesCount} file{filesCount !== 1 ? 's' : ''}
        </span>
      ) : null}
    </div>
  );
};

const styles = {
  row: css`
    display: flex; align-items: center; gap: 6px;
    padding: 4px 6px; border-radius: 4px;
    font-size: 11px; color: var(--text-primary);
    &:hover { background: var(--bg-input); }
  `,
  clickable: css`
    cursor: pointer;
  `,
  statusIcon: css`
    font-size: 11px; font-weight: 700;
    width: 12px; text-align: center; flex-shrink: 0;
  `,
  num: css`
    font-size: 10px; font-weight: 700; color: var(--text-tertiary);
    width: 18px; text-align: right; flex-shrink: 0;
  `,
  title: css`
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  agent: css`
    font-size: 10px; color: var(--color-brand); font-weight: 600;
    flex-shrink: 0; max-width: 120px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  deps: css`
    font-size: 10px; color: var(--text-tertiary); font-style: italic;
    flex-shrink: 0;
  `,
  filesBadge: css`
    font-size: 10px; color: var(--text-tertiary);
    background: var(--bg-tertiary);
    padding: 1px 5px; border-radius: 4px;
    border: 1px solid var(--border-color); flex-shrink: 0;
  `,
};
