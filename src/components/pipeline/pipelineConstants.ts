import type { OrchestratorPlan, OrchestratorTaskStatus } from '../../types';

export const TASK_STATUS_COLORS: Record<OrchestratorTaskStatus, string> = {
  pending: 'var(--text-tertiary)',
  running: 'var(--color-brand)',
  done:    'var(--color-success)',
  failed:  'var(--color-error)',
};

export const TASK_STATUS_ICONS: Record<OrchestratorTaskStatus, string> = {
  pending: '○',
  running: '▶',
  done:    '✓',
  failed:  '✗',
};

export const PLAN_STATUS_COLORS: Record<OrchestratorPlan['status'] | 'unknown', string> = {
  draft:    'var(--text-tertiary)',
  approved: 'var(--color-info)',
  running:  'var(--color-brand)',
  paused:   'var(--color-warning)',
  done:     'var(--color-success)',
  failed:   'var(--color-error)',
  stopped:  'var(--text-tertiary)',
  unknown:  'var(--text-tertiary)',
};

export const PLAN_STATUS_ICONS: Record<OrchestratorPlan['status'], string> = {
  draft:    '○',
  approved: '→',
  running:  '⚡',
  paused:   '⏸',
  done:     '✓',
  failed:   '✗',
  stopped:  '⏹',
};
