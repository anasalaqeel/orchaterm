import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { OrchestratorTask, OrchestratorTaskStatus, TerminalSession } from '../../types';
import {
  Clock, CheckCircle2, XCircle, Loader2, Circle,
  ChevronDown, ChevronUp, Trash2, GripVertical, Terminal,
} from 'lucide-react';
import { Select } from '../ui/Select';

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_META: Record<
  OrchestratorTaskStatus,
  { icon: React.ElementType; colorVar: string; label: string }
> = {
  pending: { icon: Circle,       colorVar: 'var(--text-tertiary)',   label: 'Pending' },
  running: { icon: Loader2,      colorVar: 'var(--color-brand)',     label: 'Running' },
  done:    { icon: CheckCircle2, colorVar: 'var(--color-success)',   label: 'Done' },
  failed:  { icon: XCircle,      colorVar: 'var(--color-danger)',    label: 'Failed' },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: OrchestratorTask;
  allTasks: OrchestratorTask[];
  sessions: TerminalSession[];
  /** If true, the card shows edit controls (used in PlanBuilder) */
  editable?: boolean;
  onChange?: (updated: Partial<OrchestratorTask>) => void;
  onDelete?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TaskCard: React.FC<TaskCardProps> = ({
  task, allTasks, sessions,
  editable = false, onChange, onDelete,
}) => {
  const [expanded, setExpanded] = useState(false);

  const meta = STATUS_META[task.status];
  const Icon = meta.icon;

  const assignedSession = sessions.find(s => s.id === task.assignedSessionId);
  const depTasks = allTasks.filter(t => task.dependsOn.includes(t.id));

  const toggleDep = (otherId: string) => {
    if (!onChange) return;
    const next = task.dependsOn.includes(otherId)
      ? task.dependsOn.filter(id => id !== otherId)
      : [...task.dependsOn, otherId];
    onChange({ dependsOn: next });
  };

  return (
    <div className={cx(
      styles.card,
      task.status === 'running' && styles.cardRunning,
      task.status === 'done'    && styles.cardDone,
      task.status === 'failed'  && styles.cardFailed,
    )}>
      {/* ── Header ── */}
      <div className={styles.header}>
        {editable && <GripVertical className={styles.grip} />}

        <Icon
          className={cx(styles.statusIcon, task.status === 'running' && styles.spin)}
          style={{ color: meta.colorVar }}
        />

        {editable ? (
          <input
            className={styles.titleInput}
            value={task.title}
            placeholder='Task title…'
            onChange={e => onChange?.({ title: e.target.value })}
          />
        ) : (
          <span className={styles.title}>{task.title}</span>
        )}

        {/* Session chip — shows which terminal this task is assigned to */}
        {(assignedSession || task.assignedSessionTitle) && (
          <span
            className={styles.sessionChip}
            style={assignedSession?.color
              ? { borderColor: assignedSession.color, color: assignedSession.color }
              : undefined
            }
          >
            <Terminal className={styles.chipIcon} />
            {assignedSession?.title ?? task.assignedSessionTitle}
          </span>
        )}

        {!editable && (
          <span className={styles.statusLabel} style={{ color: meta.colorVar }}>
            {meta.label}
          </span>
        )}

        <button
          className={styles.expandBtn}
          onClick={() => setExpanded(v => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded
            ? <ChevronUp className={styles.expandIcon} />
            : <ChevronDown className={styles.expandIcon} />
          }
        </button>

        {editable && onDelete && (
          <button className={styles.deleteBtn} onClick={onDelete} title='Remove task'>
            <Trash2 className={styles.expandIcon} />
          </button>
        )}
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className={styles.body}>
          {editable ? (
            <textarea
              className={styles.descTextarea}
              value={task.description}
              placeholder='What should this task accomplish?'
              rows={3}
              onChange={e => onChange?.({ description: e.target.value })}
            />
          ) : (
            task.description && <p className={styles.descText}>{task.description}</p>
          )}

          {/* Session picker (editable) */}
          {editable && (
            <div className={styles.fieldRow}>
              <Select
                label='Assign to terminal'
                value={task.assignedSessionId ?? ''}
                onChange={sid => {
                  const sess = sessions.find(s => s.id === sid);
                  onChange?.({
                    assignedSessionId: sid || undefined,
                    assignedSessionTitle: sess?.title ?? '',
                  });
                }}
                options={[
                  { value: '', name: '— None —' },
                  ...sessions.map(s => ({ value: s.id, name: s.title })),
                ]}
              />
            </div>
          )}

          {/* Dependencies (editable) */}
          {editable && allTasks.length > 1 && (
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Depends on</label>
              <div className={styles.depsGrid}>
                {allTasks
                  .filter(t => t.id !== task.id)
                  .map(t => (
                    <label key={t.id} className={styles.depCheckLabel}>
                      <input
                        type='checkbox'
                        className={styles.depCheck}
                        checked={task.dependsOn.includes(t.id)}
                        onChange={() => toggleDep(t.id)}
                      />
                      <span>{t.title || `Task ${t.id.slice(0, 6)}`}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}

          {/* Read-only deps */}
          {!editable && depTasks.length > 0 && (
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Depends on</label>
              <div className={styles.depsPills}>
                {depTasks.map(t => {
                  const m = STATUS_META[t.status];
                  return (
                    <span key={t.id} className={styles.depPill} style={{ color: m.colorVar }}>
                      {t.title || t.id.slice(0, 8)}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Output (done) */}
          {!editable && task.output && (
            <div className={styles.outputBlock}>
              <div className={styles.outputLabel}>
                <CheckCircle2 className={styles.outputIcon} /> Output Summary
              </div>
              {task.output.relayedBrief && (
                <p className={styles.outputText}><strong>Relayed brief:</strong> {task.output.relayedBrief}</p>
              )}
              {task.output.summary && <p className={styles.outputText}>{task.output.summary}</p>}
              {task.output.filesModified?.length > 0 && (
                <ul className={styles.fileList}>
                  {task.output.filesModified.map(f => (
                    <li key={f} className={styles.fileItem}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Timing */}
          {!editable && (task.startedAt || task.completedAt) && (
            <div className={styles.timing}>
              <Clock className={styles.timingIcon} />
              {task.startedAt && <span>Started {new Date(task.startedAt).toLocaleTimeString()}</span>}
              {task.completedAt && <span>· Completed {new Date(task.completedAt).toLocaleTimeString()}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  card: css`
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    background-color: var(--bg-secondary);
    transition: border-color 0.2s, box-shadow 0.2s;
    overflow: hidden;
  `,
  cardRunning: css`
    border-color: var(--color-brand);
    box-shadow: 0 0 0 1px var(--color-brand) inset, 0 0 12px rgba(123, 104, 238, 0.10);
  `,
  cardDone:   css`border-color: var(--color-success); opacity: 0.75;`,
  cardFailed: css`border-color: var(--color-danger);`,
  header: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
  `,
  grip: css`width:14px; height:14px; color:var(--text-tertiary); cursor:grab; flex-shrink:0;`,
  statusIcon: css`width:14px; height:14px; flex-shrink:0;`,
  spin: css`
    animation: spin 1.2s linear infinite;
    @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
  `,
  title: css`
    flex: 1;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  titleInput: css`
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-primary);
    font-size: var(--font-size-xs);
    font-weight: 600;
    padding: 2px 4px;
    outline: none;
    font-family: inherit;
    transition: border-color 0.15s;
    &::placeholder { color: var(--text-tertiary); }
    &:focus { border-bottom-color: var(--color-brand); }
  `,
  sessionChip: css`
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    padding: 1px 6px;
    white-space: nowrap;
    flex-shrink: 0;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  chipIcon: css`width:9px; height:9px; flex-shrink:0;`,
  statusLabel: css`
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    flex-shrink: 0;
  `,
  expandBtn: css`
    background: transparent; border: none; cursor: pointer;
    color: var(--text-tertiary); padding: 2px;
    display: flex; align-items: center; transition: color 0.15s; flex-shrink: 0;
    &:hover { color: var(--text-primary); }
  `,
  deleteBtn: css`
    background: transparent; border: none; cursor: pointer;
    color: var(--color-danger); padding: 2px;
    display: flex; align-items: center; opacity: 0.6;
    transition: opacity 0.15s; flex-shrink: 0;
    &:hover { opacity: 1; }
  `,
  expandIcon: css`width:13px; height:13px;`,
  body: css`
    padding: 10px 14px 12px;
    border-top: 1px solid var(--border-color);
    display: flex; flex-direction: column; gap: 10px;
    background-color: var(--bg-primary);
  `,
  descText: css`font-size:var(--font-size-xs); color:var(--text-secondary); line-height:1.5; margin:0;`,
  descTextarea: css`
    width: 100%; box-sizing: border-box;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px 10px;
    font-size: var(--font-size-xs); color: var(--text-primary);
    font-family: inherit; resize: vertical; outline: none; line-height: 1.5;
    transition: border-color 0.15s;
    &::placeholder { color: var(--text-tertiary); }
    &:focus { border-color: var(--color-brand); }
  `,
  fieldRow: css`display:flex; flex-direction:column; gap:5px;`,
  fieldLabel: css`
    font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary);
  `,
  depsGrid: css`display:flex; flex-direction:column; gap:5px;`,
  depCheckLabel: css`
    display:flex; align-items:center; gap:6px;
    font-size:var(--font-size-xs); color:var(--text-secondary);
    cursor:pointer; user-select:none;
  `,
  depCheck: css`accent-color: var(--color-brand); cursor:pointer;`,
  depsPills: css`display:flex; flex-wrap:wrap; gap:5px;`,
  depPill: css`font-size:10px; border:1px solid currentColor; border-radius:3px; padding:1px 6px; opacity:0.8;`,
  outputBlock: css`
    border: 1px solid var(--color-success);
    border-radius: var(--border-radius-sm);
    padding: 8px 10px;
    background-color: rgba(16,185,129,0.04);
    display: flex; flex-direction: column; gap: 5px;
  `,
  outputLabel: css`
    display:flex; align-items:center; gap:5px;
    font-size:10px; font-weight:700; text-transform:uppercase;
    letter-spacing:0.06em; color:var(--color-success);
  `,
  outputIcon: css`width:11px; height:11px;`,
  outputText: css`font-size:var(--font-size-xs); color:var(--text-secondary); line-height:1.5; margin:0;`,
  fileList: css`margin:0; padding-left:16px; display:flex; flex-direction:column; gap:2px;`,
  fileItem: css`font-size:11px; font-family:'JetBrains Mono','Fira Code',monospace; color:var(--text-tertiary);`,
  timing: css`display:flex; align-items:center; gap:5px; font-size:10px; color:var(--text-tertiary);`,
  timingIcon: css`width:11px; height:11px;`,
};
