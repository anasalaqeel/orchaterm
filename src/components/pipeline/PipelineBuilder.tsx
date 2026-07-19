/*
 * PipelineBuilder.tsx
 *
 * Manual drag-drop builder for a pipeline. Lives inside the Pipeline tab's
 * "Builder" sub-tab. Lets the user add/edit/reorder tasks, switch execution
 * mode, save the current build as a template, and execute the pipeline.
 *
 * All state lives in the parent (RightPanel) — this is a controlled component.
 */
import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import {
  ListOrdered, Zap, Edit2, Check, X as XIcon, Plus, Save, Workflow,
} from 'lucide-react';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { DependencyGraph } from './DependencyGraph';
import { PendingPlanPreview } from './PendingPlanPreview';
import type { OrchestratorTask, PipelineTemplate } from '../../types';

interface SessionOption {
  id: string;
  title: string;
  color: string | null;
}

interface PipelineBuilderProps {
  /** Current build tasks (with assigned session IDs resolved). */
  tasks: OrchestratorTask[];
  setTasks: (next: OrchestratorTask[]) => void;
  executionMode: 'sequential' | 'parallel';
  setExecutionMode: (mode: 'sequential' | 'parallel') => void;
  /** Terminal tabs the user can assign tasks to. */
  sessions: SessionOption[];
  /** Pending plan (from chat-generated plan) shown above the builder. */
  pendingPlan: { goal: string; tasks: OrchestratorTask[] } | null;
  onRunPending: () => void;
  onDiscardPending: () => void;
  /** Run the manually-built pipeline. */
  onRunBuild: () => void;
  /** Save the current build (or pending plan) as a reusable template. */
  onSaveTemplate: (template: Omit<PipelineTemplate, 'id' | 'createdAt' | 'usedAt' | 'useCount'>) => void;
  /** Disabled flag (e.g. AI off, or another plan running). */
  disabled?: boolean;
}

export const PipelineBuilder: React.FC<PipelineBuilderProps> = ({
  tasks,
  setTasks,
  executionMode,
  setExecutionMode,
  sessions,
  pendingPlan,
  onRunPending,
  onDiscardPending,
  onRunBuild,
  onSaveTemplate,
  disabled,
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [newSessionId, setNewSessionId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSessionId, setEditSessionId] = useState('');
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<{ index: number; pos: 'top' | 'bottom' } | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [tplTitle, setTplTitle] = useState('');
  const [tplDesc, setTplDesc] = useState('');
  const [tplTags, setTplTags] = useState('');

  // ── Add / remove / edit ────────────────────────────────────────────────────
  const addTask = () => {
    if (!newTitle.trim() || !newSessionId) return;
    const session = sessions.find(s => s.id === newSessionId);
    if (!session) return;
    const next: OrchestratorTask = {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      description: newTitle.trim(),
      assignedSessionId: session.id,
      assignedSessionTitle: session.title,
      dependsOn: [],
      status: 'pending',
    };
    setTasks([...tasks, next]);
    setNewTitle('');
    setNewSessionId('');
  };

  const removeTask = (id: string) => {
    setTasks(tasks.filter(t => t.id !== id));
  };

  const startEditing = (task: OrchestratorTask) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditSessionId(task.assignedSessionId);
  };

  const saveEditing = () => {
    if (!editingId || !editTitle.trim() || !editSessionId) return;
    const session = sessions.find(s => s.id === editSessionId);
    if (!session) return;
    setTasks(tasks.map(t => t.id === editingId ? {
      ...t,
      title: editTitle.trim(),
      description: editTitle.trim(),
      assignedSessionId: session.id,
      assignedSessionTitle: session.title,
    } : t));
    setEditingId(null);
  };

  // ── Drag-drop reorder ──────────────────────────────────────────────────────
  const onDrop = (targetIdx: number, pos: 'top' | 'bottom') => {
    if (draggedIdx === null) return;
    const insertAt = pos === 'top' ? targetIdx : targetIdx + 1;
    const finalIdx = draggedIdx < insertAt ? insertAt - 1 : insertAt;
    if (finalIdx === draggedIdx) {
      setDraggedIdx(null);
      setDragOver(null);
      return;
    }
    const items = [...tasks];
    const [moved] = items.splice(draggedIdx, 1);
    items.splice(finalIdx, 0, moved);
    setTasks(items);
    setDraggedIdx(null);
    setDragOver(null);
  };

  const clearAll = () => {
    setTasks([]);
    setNewTitle('');
    setNewSessionId('');
  };

  // ── Save as template ───────────────────────────────────────────────────────
  const submitTemplate = () => {
    if (!tplTitle.trim() || tasks.length === 0) return;
    onSaveTemplate({
      title: tplTitle.trim(),
      description: tplDesc.trim(),
      executionMode,
      tags: tplTags.split(',').map(t => t.trim()).filter(Boolean),
      tasks: tasks.map((t, i) => ({
        id: crypto.randomUUID(),
        title: t.title,
        description: t.description,
        agentHint: t.assignedSessionTitle,
        dependsOnIndices:
          executionMode === 'sequential'
            ? (i > 0 ? [i - 1] : [])
            : tasks
                .map((other, j) => (other.id !== t.id && t.dependsOn.includes(other.id) ? j : -1))
                .filter(j => j >= 0),
      })),
    });
    setShowSave(false);
    setTplTitle('');
    setTplDesc('');
    setTplTags('');
  };

  const sessionOpts = sessions.map(s => ({ value: s.id, name: s.title }));

  return (
    <div className={s.root}>
      {pendingPlan && (
        <PendingPlanPreview
          goal={pendingPlan.goal}
          tasks={pendingPlan.tasks}
          executionMode={executionMode}
          onExecutionModeChange={setExecutionMode}
          onRun={onRunPending}
          onDiscard={onDiscardPending}
        />
      )}

      <div className={s.section}>
        <div className={s.sectionLabel}>
          <Workflow size={11} />
          <span>Builder</span>
        </div>

        {tasks.length > 0 && (
          <div className={s.taskList}>
            {tasks.map((task, i) => {
              const isEditing = editingId === task.id;
              return (
                <div
                  key={task.id}
                  className={cx(
                    s.taskItem,
                    draggedIdx === i && s.taskItemDragging,
                    dragOver?.index === i && dragOver.pos === 'top' && s.taskItemDragTop,
                    dragOver?.index === i && dragOver.pos === 'bottom' && s.taskItemDragBottom,
                  )}
                  draggable={!isEditing}
                  onDragStart={(e) => {
                    if (isEditing) { e.preventDefault(); return; }
                    setDraggedIdx(i);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => { setDraggedIdx(null); setDragOver(null); }}
                  onDragOver={(e) => {
                    if (isEditing) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (draggedIdx === null) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pos = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
                    if (dragOver?.index !== i || dragOver?.pos !== pos) {
                      setDragOver({ index: i, pos });
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node) && dragOver?.index === i) {
                      setDragOver(null);
                    }
                  }}
                  onDrop={(e) => {
                    if (isEditing) return;
                    e.preventDefault();
                    const pos = dragOver?.index === i ? dragOver.pos : 'top';
                    onDrop(i, pos);
                  }}
                >
                  <span className={s.taskGrip} title="Drag to reorder">⋮⋮</span>
                  <span className={s.taskNum}>{i + 1}.</span>

                  {isEditing ? (
                    <div className={s.editRow}>
                      <Input
                        type="text"
                        className={s.titleInput}
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEditing();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                      />
                      <div className={s.editSelect}>
                        <Select
                          compact
                          value={editSessionId}
                          onChange={setEditSessionId}
                          options={sessionOpts}
                        />
                      </div>
                      <button
                        className={s.iconSaveBtn}
                        onClick={saveEditing}
                        disabled={!editTitle.trim() || !editSessionId}
                        title="Save (Enter)"
                      >
                        <Check size={11} />
                      </button>
                      <button className={s.iconRemoveBtn} onClick={() => setEditingId(null)} title="Cancel (Esc)">
                        <XIcon size={11} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className={s.taskTitle} onDoubleClick={() => startEditing(task)} title="Double-click to edit">{task.title}</span>
                      <span className={s.taskAgent} onDoubleClick={() => startEditing(task)}>→ {task.assignedSessionTitle}</span>
                      <button className={s.iconEditBtn} onClick={() => startEditing(task)} title="Edit step">
                        <Edit2 size={11} />
                      </button>
                      <button className={s.iconRemoveBtn} onClick={() => removeTask(task.id)} title="Remove step">
                        <XIcon size={11} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tasks.length === 0 && !pendingPlan && (
          <p className={s.empty}>No tasks yet — add steps below then click Execute.</p>
        )}

        {/* Add task row */}
        <div className={s.addRow}>
          <Input
            type="text"
            className={s.titleInput}
            placeholder="Task description…"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTask()}
          />
          <div className={s.agentSelect}>
            <Select
              compact
              value={newSessionId}
              onChange={setNewSessionId}
              options={[
                { value: '', name: 'Select tab…', disabled: true },
                ...sessionOpts,
              ]}
            />
          </div>
          <button
            className={s.addBtn}
            onClick={addTask}
            disabled={!newTitle.trim() || !newSessionId}
            title="Add step (Enter)"
          >
            <Plus size={11} /> Add Step
          </button>
        </div>

        {/* Mode + actions */}
        {tasks.length > 0 && (
          <>
            <div className={s.modeBar}>
              <span className={s.modeLabel}>Execution Mode</span>
              <div className={s.modeToggle}>
                <button
                  className={cx(s.modeBtn, executionMode === 'sequential' && s.modeBtnActive)}
                  onClick={() => setExecutionMode('sequential')}
                  title="Run steps one after another"
                >
                  <ListOrdered size={12} />
                  Sequential
                </button>
                <button
                  className={cx(s.modeBtn, executionMode === 'parallel' && s.modeBtnActive)}
                  onClick={() => setExecutionMode('parallel')}
                  title="Run all steps concurrently"
                >
                  <Zap size={12} />
                  Parallel
                </button>
              </div>
            </div>

            <div className={s.graphRow}>
              <DependencyGraph
                tasks={tasks.map((t, i) => executionMode === 'sequential' && i > 0
                  ? { ...t, dependsOn: [tasks[i - 1].id] }
                  : { ...t, dependsOn: [] })}
                compact
                title={<span>Preview · {tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>}
              />
            </div>

            <div className={s.footerActions}>
              <button className={s.runBtn} onClick={onRunBuild} disabled={disabled} title="Execute pipeline">
                ▶ Execute Pipeline ({tasks.length} {tasks.length === 1 ? 'step' : 'steps'})
              </button>
              <button className={s.saveTplBtn} onClick={() => setShowSave(p => !p)} title="Save as reusable template">
                <Save size={11} /> Save as Template
              </button>
              <button className={s.clearBtn} onClick={clearAll}>Clear</button>
            </div>

            {showSave && (
              <div className={s.tplForm}>
                <Input
                  type="text"
                  className={s.titleInput}
                  placeholder="Template name…"
                  value={tplTitle}
                  onChange={e => setTplTitle(e.target.value)}
                  autoFocus
                />
                <Input
                  type="text"
                  className={s.titleInput}
                  placeholder="Short description (optional)…"
                  value={tplDesc}
                  onChange={e => setTplDesc(e.target.value)}
                />
                <Input
                  type="text"
                  className={s.titleInput}
                  placeholder="Tags (comma-separated)…"
                  value={tplTags}
                  onChange={e => setTplTags(e.target.value)}
                />
                <div className={s.tplActions}>
                  <button
                    className={s.tplConfirmBtn}
                    onClick={submitTemplate}
                    disabled={!tplTitle.trim()}
                  >
                    Save Template
                  </button>
                  <button className={s.clearBtn} onClick={() => setShowSave(false)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const s = {
  root: css`
    flex: 1; min-height: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px;
    padding: 12px;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
  `,
  section: css`
    display: flex; flex-direction: column; gap: 8px;
  `,
  sectionLabel: css`
    display: flex; align-items: center; gap: 5px;
    font-size: 10px; font-weight: 700; color: var(--text-tertiary);
    text-transform: uppercase; letter-spacing: 0.06em;
  `,
  empty: css`
    font-size: 11px; color: var(--text-tertiary);
    text-align: center; padding: 8px 0; font-style: italic;
  `,

  taskList: css`
    display: flex; flex-direction: column; gap: 3px;
  `,
  taskItem: css`
    position: relative;
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    cursor: grab;
    transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
    user-select: none;
    &:active { cursor: grabbing; }
  `,
  taskItemDragging: css`
    opacity: 0.45; border-style: dashed;
  `,
  taskItemDragTop: css`
    &::before {
      content: ''; position: absolute;
      top: -3px; left: 0; right: 0;
      height: 3px; background: var(--color-brand);
      border-radius: 3px;
      box-shadow: 0 0 6px rgba(var(--color-brand-rgb), 0.6);
      pointer-events: none; z-index: 10;
    }
  `,
  taskItemDragBottom: css`
    &::after {
      content: ''; position: absolute;
      bottom: -3px; left: 0; right: 0;
      height: 3px; background: var(--color-brand);
      border-radius: 3px;
      box-shadow: 0 0 6px rgba(var(--color-brand-rgb), 0.6);
      pointer-events: none; z-index: 10;
    }
  `,
  taskGrip: css`
    font-size: 10px; line-height: 1; letter-spacing: -1px;
    color: var(--text-tertiary); cursor: grab; flex-shrink: 0;
    &:hover { color: var(--text-secondary); }
  `,
  taskNum: css`
    font-size: 10px; color: var(--text-tertiary); font-weight: 700;
    flex-shrink: 0; width: 14px; text-align: right;
  `,
  taskTitle: css`
    flex: 1; font-size: 12px; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    cursor: text;
  `,
  taskAgent: css`
    font-size: 10px; color: var(--color-brand); font-weight: 600;
    flex-shrink: 0; max-width: 100px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  editRow: css`
    display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
  `,
  editSelect: css`width: 130px; flex-shrink: 0;`,
  titleInput: css`
    flex: 1; min-width: 0;
    background: var(--bg-input);
    border: 1px solid var(--border-color-hover);
    border-radius: 6px; padding: 5px 8px;
    font-size: 11px; color: var(--text-primary);
    outline: none; font-family: var(--font-family);
    transition: border-color 0.15s;
    &:focus { border-color: var(--color-brand); }
    &::placeholder { color: var(--text-tertiary); }
  `,

  iconEditBtn: css`
    display: flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 3px;
    background: transparent; border: none;
    color: var(--text-tertiary); cursor: pointer; flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
    &:hover { color: var(--color-brand); background: rgba(var(--color-brand-rgb), 0.12); }
  `,
  iconRemoveBtn: css`
    display: flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 3px;
    background: transparent; border: none;
    color: var(--text-tertiary); cursor: pointer; flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
    &:hover { color: var(--color-error); background: rgba(var(--color-error-rgb), 0.12); }
  `,
  iconSaveBtn: css`
    display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 4px;
    background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3);
    color: var(--color-success); cursor: pointer; flex-shrink: 0;
    &:hover:not(:disabled) { background: var(--color-success); color: #fff; }
    &:disabled { opacity: 0.35; cursor: default; }
  `,

  addRow: css`
    display: flex; align-items: center; gap: 5px;
  `,
  agentSelect: css`width: 130px; flex-shrink: 0;`,
  addBtn: css`
    height: 28px; flex-shrink: 0;
    padding: 0 10px;
    display: flex; align-items: center; gap: 4px; justify-content: center;
    border-radius: 6px;
    background: var(--bg-input);
    border: 1px solid var(--border-color-hover);
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    &:hover:not(:disabled) { background: var(--color-brand); border-color: var(--color-brand); color: #fff; }
    &:disabled { opacity: 0.35; cursor: default; }
  `,

  modeBar: css`
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-canvas);
    border: 1px solid rgba(var(--color-info-rgb), 0.15);
    border-radius: 8px;
  `,
  modeLabel: css`font-size: 11px; font-weight: 600; color: var(--text-secondary);`,
  modeToggle: css`
    display: flex; align-items: center; gap: 2px;
    background: var(--bg-input); border: 1px solid var(--border-color);
    border-radius: 6px; padding: 2px;
  `,
  modeBtn: css`
    display: flex; align-items: center; gap: 4px;
    border: none; background: transparent; color: var(--text-tertiary);
    font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 4px;
    cursor: pointer; transition: all 0.15s ease;
    &:hover { color: var(--text-primary); }
  `,
  modeBtnActive: css`
    background: var(--color-brand); color: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.15);
    &:hover { color: #fff; }
  `,

  graphRow: css`
    background: var(--bg-canvas); border-radius: 8px;
    border: 1px solid var(--border-color);
    padding: 8px;
  `,

  footerActions: css`
    display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  `,
  runBtn: css`
    flex: 1; min-width: 180px;
    background: var(--gradient-brand);
    color: #fff; border: none; border-radius: 7px;
    padding: 8px 12px;
    font-size: 12px; font-weight: 700;
    cursor: pointer;
    transition: filter 0.15s;
    &:hover:not(:disabled) { filter: brightness(1.08); }
    &:disabled { opacity: 0.4; cursor: default; filter: none; }
  `,
  saveTplBtn: css`
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    padding: 8px 12px;
    font-size: 11px; font-weight: 600;
    color: var(--text-secondary);
    display: flex; align-items: center; gap: 4px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    &:hover { border-color: var(--color-brand); color: var(--color-brand); }
  `,
  clearBtn: css`
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 7px;
    padding: 8px 12px;
    font-size: 11px; font-weight: 600;
    color: var(--text-tertiary); cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    &:hover { border-color: var(--border-color-hover); color: var(--text-secondary); }
  `,

  tplForm: css`
    display: flex; flex-direction: column; gap: 6px;
    padding: 10px;
    background: var(--bg-canvas);
    border: 1px solid rgba(var(--color-info-rgb), 0.2);
    border-radius: 8px;
  `,
  tplActions: css`
    display: flex; gap: 6px; justify-content: flex-end;
  `,
  tplConfirmBtn: css`
    background: var(--color-info); border: none; border-radius: 6px;
    padding: 6px 12px;
    color: var(--bg-secondary); font-size: 11px; font-weight: 700;
    cursor: pointer;
    &:hover:not(:disabled) { filter: brightness(1.08); }
    &:disabled { opacity: 0.4; cursor: default; }
  `,
};
