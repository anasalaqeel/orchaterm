/*
 * TaskCard.tsx
 *
 * Rich per-task display used in the Live Run board and History view.
 * Shows status icon, title, agent pill, timing, dependencies, files modified,
 * and an expandable output section.
 */
import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { OrchestratorTask } from '../../types';

interface TaskCardProps {
  task: OrchestratorTask;
  /** 1-based position of this task in the plan (for the leading number badge). */
  index: number;
  /** Resolve a dependency task ID → its title and 1-based position in the plan
   *  (NOT the position within this task's own dependsOn list — a task can
   *  depend on e.g. task #2 while being task #4 itself). */
  resolveDependency: (id: string) => { title: string; index: number } | undefined;
  /** Optional color for the agent pill (matches the terminal tab). */
  agentColor?: string | null;
  /** Tick used to refresh elapsed timings for running tasks. Pass `Date.now()`. */
  now?: number;
  /** Default-expanded (e.g. failed or completed sentinel events). */
  defaultExpanded?: boolean;
}

const STATUS_COLORS: Record<OrchestratorTask['status'], string> = {
  pending:  'var(--text-tertiary)',
  running:  'var(--color-brand)',
  done:     'var(--color-success)',
  failed:   'var(--color-error)',
};

const STATUS_ICONS: Record<OrchestratorTask['status'], string> = {
  pending:  '○',
  running:  '▶',
  done:     '✓',
  failed:   '✗',
};

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  index,
  resolveDependency,
  agentColor,
  now,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [filesHover, setFilesHover] = useState(false);

  const color = STATUS_COLORS[task.status];
  const icon  = STATUS_ICONS[task.status];

  const elapsed = task.startedAt
    ? task.completedAt
      ? ((task.completedAt - task.startedAt) / 1000).toFixed(1) + 's'
      : Math.round(((now ?? Date.now()) - task.startedAt) / 1000) + 's…'
    : null;

  const depRefs = task.dependsOn
    .map(resolveDependency)
    .filter((r): r is { title: string; index: number } => Boolean(r));

  const hasDetails = Boolean(
    task.output?.summary || task.output?.raw || task.output?.relayedBrief ||
    task.output?.needs || task.status === 'failed',
  );

  const files = task.output?.filesModified ?? [];

  return (
    <div className={cx(s.card, task.status === 'running' && s.cardRunning)} style={{ borderLeftColor: color }}>
      <div className={s.header}>
        <span className={s.statusIcon} style={{ color }}>
          {task.status === 'running'
            ? <span className={s.spinner} />
            : icon}
        </span>
        <span className={s.indexBadge}>{index}</span>
        <button
          type="button"
          className={cx(s.titleBtn, hasDetails && s.titleBtnClickable)}
          onClick={() => hasDetails && setExpanded(p => !p)}
          title={hasDetails ? 'Toggle details' : undefined}
        >
          {hasDetails && (
            expanded
              ? <ChevronDown size={11} className={s.chevron} />
              : <ChevronRight size={11} className={s.chevron} />
          )}
          <span className={s.title}>{task.title}</span>
        </button>
        <span
          className={s.agentPill}
          style={{
            color: agentColor ?? 'var(--color-brand)',
            backgroundColor: (agentColor ?? 'var(--color-brand)') + '1a',
            borderColor: (agentColor ?? 'var(--color-brand)') + '44',
          }}
          title={task.assignedSessionTitle}
        >
          {task.assignedSessionTitle}
        </span>
        {elapsed && <span className={s.elapsed}>{elapsed}</span>}
        {files.length > 0 && (
          <span
            className={s.filesPill}
            onMouseEnter={() => setFilesHover(true)}
            onMouseLeave={() => setFilesHover(false)}
            title={files.join('\n')}
          >
            <FileText size={10} />
            {files.length}
            {filesHover && (
              <span className={s.filesPopover}>
                {files.map(f => <span key={f} className={s.filesPath}>{f}</span>)}
              </span>
            )}
          </span>
        )}
      </div>

      {depRefs.length > 0 && (
        <div className={s.deps}>after: {depRefs.map((r, i) => (
          <span key={i} className={s.dep}>#{r.index} {r.title}{i < depRefs.length - 1 ? ',' : ''}</span>
        ))}</div>
      )}

      {expanded && hasDetails && task.output && (
        <div className={s.body}>
          {task.output.summary && (
            <Section label="Summary">{task.output.summary}</Section>
          )}
          {task.output.relayedBrief && (
            <Section label="Relayed brief">{task.output.relayedBrief}</Section>
          )}
          {task.output.needs && task.output.needs !== 'none' && (
            <Section label="Handoff">{task.output.needs}</Section>
          )}
          {task.output.raw && (
            <Section label="Output">
              <pre className={s.raw}>{task.output.raw.slice(-2000)}</pre>
            </Section>
          )}
          {task.status === 'failed' && !task.output.raw && (
            <Section label="Status">
              <span style={{ color: 'var(--color-error)' }}>Task failed — check terminal for details.</span>
            </Section>
          )}
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className={s.section}>
    <div className={s.sectionLabel}>{label}</div>
    <div className={s.sectionValue}>{children}</div>
  </div>
);

const s = {
  card: css`
    position: relative;
    display: flex; flex-direction: column;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    border-left: 3px solid var(--text-tertiary);
    background: var(--bg-primary);
    gap: 4px;
  `,
  cardRunning: css`
    border-color: rgba(var(--color-brand-rgb), 0.4);
    box-shadow: 0 0 0 1px rgba(var(--color-brand-rgb), 0.15), 0 0 14px rgba(var(--color-brand-rgb), 0.15);
  `,
  header: css`
    display: flex; align-items: center; gap: 8px; min-width: 0;
  `,
  statusIcon: css`
    width: 14px; flex-shrink: 0;
    font-weight: 700; font-size: 12px;
    display: inline-flex; align-items: center; justify-content: center;
  `,
  spinner: css`
    display: inline-block;
    width: 11px; height: 11px;
    border: 2px solid rgba(var(--color-brand-rgb), 0.25);
    border-top-color: var(--color-brand);
    border-radius: 50%;
    animation: taskspin 0.8s linear infinite;
    @keyframes taskspin { to { transform: rotate(360deg); } }
  `,
  indexBadge: css`
    width: 18px; flex-shrink: 0;
    font-size: 10px; font-weight: 700;
    color: var(--text-tertiary); text-align: right;
  `,
  titleBtn: css`
    display: flex; align-items: center; gap: 3px;
    flex: 1; min-width: 0;
    background: transparent; border: none; cursor: default;
    padding: 0; text-align: left;
  `,
  titleBtnClickable: css`
    cursor: pointer;
    &:hover span { color: var(--color-brand); }
  `,
  chevron: css`
    color: var(--text-tertiary); flex-shrink: 0;
  `,
  title: css`
    font-size: 12px; color: var(--text-primary); font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  agentPill: css`
    font-size: 10px; font-weight: 600;
    padding: 1px 7px; border-radius: 99px;
    border: 1px solid; flex-shrink: 0;
    max-width: 100px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  elapsed: css`
    font-size: 10px; color: var(--text-secondary);
    flex-shrink: 0; min-width: 38px; text-align: right;
    font-variant-numeric: tabular-nums;
  `,
  filesPill: css`
    position: relative;
    display: inline-flex; align-items: center; gap: 3px;
    font-size: 10px; color: var(--color-success);
    padding: 1px 5px; border-radius: 99px;
    background: rgba(var(--color-success-rgb), 0.1);
    flex-shrink: 0; cursor: default;
  `,
  filesPopover: css`
    position: absolute; top: calc(100% + 4px); right: 0;
    background: var(--bg-secondary); border: 1px solid var(--border-color);
    border-radius: 6px; padding: 6px 8px;
    box-shadow: var(--shadow-lg);
    display: flex; flex-direction: column; gap: 2px;
    max-width: 280px; max-height: 200px; overflow-y: auto;
    z-index: 10;
  `,
  filesPath: css`
    font-family: var(--font-family-mono);
    font-size: 10px; color: var(--text-secondary);
    word-break: break-all;
  `,
  deps: css`
    font-size: 10px; color: var(--text-tertiary);
    padding-left: 36px;
  `,
  dep: css`
    color: var(--text-secondary);
  `,
  body: css`
    display: flex; flex-direction: column; gap: 6px;
    padding: 6px 10px 4px 36px;
    border-top: 1px dashed var(--border-color);
    margin-top: 2px;
  `,
  section: css`
    display: flex; flex-direction: column; gap: 2px;
  `,
  sectionLabel: css`
    font-size: 9px; font-weight: 700; color: var(--text-tertiary);
    text-transform: uppercase; letter-spacing: 0.06em;
  `,
  sectionValue: css`
    font-size: 11px; color: var(--text-primary); line-height: 1.5;
  `,
  raw: css`
    background: var(--bg-tertiary); border-radius: 4px;
    padding: 6px 8px; margin: 2px 0 0;
    font-family: var(--font-family-mono); font-size: 10px;
    color: var(--text-secondary); line-height: 1.5;
    overflow-x: auto; white-space: pre-wrap; max-height: 160px;
    overflow-y: auto;
  `,
};
