/*
 * PipelineTemplates.tsx
 *
 * Tab view component for reusable pipeline templates.
 * Allows user to search, filter, edit, delete, run templates,
 * and load them directly into the Builder.
 */
import React, { useMemo, useState } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import {
  Plus, Edit2, Trash2, Search, X, Tag, Play, Workflow,
} from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { ConfirmDialog, Input, Select } from '../ui';
import { useDragReorder } from '../../hooks';
import { ExecutionModeToggle, ExecutionModeBadge, DraggableTaskRow, TaskRow } from './index';
import { orchestratorEngine } from '../../services/orchestratorEngine';
import type {
  OrchestratorPlan, PipelineTemplate, PipelineTemplateTask,
  Workspace, Space, TerminalSession,
} from '../../types';

interface PipelineTemplatesProps {
  workspaceId: string;
}

export const PipelineTemplates: React.FC<PipelineTemplatesProps> = ({ workspaceId }) => {
  const {
    pipelineTemplates, addPipelineTemplate, updatePipelineTemplate, deletePipelineTemplate,
    workspaces, spaces, terminalSessions, showToast, incrementTemplateUse,
    settings, llmProviders, addPlan,
  } = useDashboard();

  const [search, setSearch]   = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [editing, setEditing] = useState<PipelineTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [runTarget, setRunTarget] = useState<PipelineTemplate | null>(null);

  const allTags = useMemo(
    () => Array.from(new Set(pipelineTemplates.flatMap(t => t.tags))).filter(Boolean),
    [pipelineTemplates],
  );

  const filtered = useMemo(() => {
    const terms = search.toLowerCase().split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    return pipelineTemplates
      .filter(t => tagFilter.every(tag => t.tags.includes(tag)))
      .filter(t => terms.length === 0 || terms.every(term =>
        t.title.toLowerCase().includes(term) ||
        t.description.toLowerCase().includes(term) ||
        t.tasks.some(task => task.title.toLowerCase().includes(term)) ||
        t.tags.some(tag => tag.toLowerCase().includes(term)),
      ))
      .sort((a, b) => (b.usedAt ?? '').localeCompare(a.usedAt ?? ''));
  }, [pipelineTemplates, search, tagFilter]);

  const toggleTag = (tag: string) => {
    setTagFilter(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleRun = (
    template: PipelineTemplate,
    targetWorkspaceId: string,
    spaceId: string | null,
    agentByTaskId: Record<string, { id: string; title: string }>,
  ) => {
    const workspace = workspaces.find(w => w.id === targetWorkspaceId);
    if (!workspace) {
      showToast('Pick a workspace first', 'error');
      return;
    }
    const sessionsInScope = spaceId
      ? terminalSessions.filter(s => spaces.find(sp => sp.id === spaceId)?.sessionIds.includes(s.id) ?? false)
      : terminalSessions.filter(s => s.workspaceId === targetWorkspaceId);

    const idMap = new Map<string, string>();
    template.tasks.forEach(t => idMap.set(t.id, crypto.randomUUID()));

    const tasks = template.tasks.map(tt => {
      const assignment = agentByTaskId[tt.id];
      const session = assignment
        ? sessionsInScope.find(s => s.id === assignment.id) ?? sessionsInScope[0]
        : sessionsInScope[0];
      return {
        id:                   idMap.get(tt.id)!,
        title:                tt.title,
        description:          tt.description,
        assignedSessionId:    session?.id ?? '',
        assignedSessionTitle: session?.title ?? tt.agentHint ?? '(unassigned)',
        dependsOn:            tt.dependsOnIndices.map(i => idMap.get(template.tasks[i].id)!).filter(Boolean),
        status:               'pending' as const,
      };
    });

    const plan: OrchestratorPlan = {
      id: crypto.randomUUID(),
      goal: `${template.title} — ${template.description}`.slice(0, 200),
      tasks,
      status: 'approved',
      createdAt: Date.now(),
      workspaceId: targetWorkspaceId,
      spaceId,
      executionMode: template.executionMode,
    };

    orchestratorEngine.updateConfig({
      relayProvider:      llmProviders.relay,
      planGenProvider:    llmProviders.planGen,
      autoAnswerProvider: llmProviders.autoAnswer,
      taskTimeoutMinutes: settings.conductorTaskTimeoutMinutes,
      interactionMode:    settings.conductorInteractionMode,
      sessionTitles:      new Map(sessionsInScope.map(s => [s.id, s.title])),
    });

    orchestratorEngine.start(plan);
    addPlan(plan);
    void incrementTemplateUse(template.id);
    showToast(`Pipeline started in "${workspace.name}"`, 'success');
    setRunTarget(null);
    window.dispatchEvent(new CustomEvent('orchaterm:open-workspace', { detail: { workspaceId: targetWorkspaceId, spaceId } }));
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button
          onClick={() => { setEditing(null); setCreating(true); }}
          className={styles.primaryBtn}
        >
          <Plus size={12} />
          New Template
        </button>
      </div>

      {/* Filters */}
      <div className={styles.filtersArea}>
        <div className={styles.searchRow}>
          <Search size={12} className={styles.searchIcon} />
          <Input
            type="text"
            placeholder="Search templates…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={styles.searchInput}
          />
          {search && (
            <button onClick={() => setSearch('')} className={styles.clearBtn}>
              <X size={12} />
            </button>
          )}
        </div>
        {allTags.length > 0 && (
          <div className={styles.tagRow}>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cx(styles.tagChip, tagFilter.includes(tag) && styles.tagChipActive)}
              >
                <Tag size={10} /> {tag}
              </button>
            ))}
            {tagFilter.length > 0 && (
              <button onClick={() => setTagFilter([])} className={styles.clearTagsBtn}>
                Clear ({tagFilter.length})
              </button>
            )}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <Workflow size={24} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>No templates found</p>
          <p className={styles.emptySubtitle}>
            Save a template from the Builder or click "New Template" above.
          </p>
        </div>
      ) : (
        <div className={styles.cardsList}>
          {filtered.map(tpl => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              onEdit={() => { setEditing(tpl); setCreating(false); }}
              onDelete={() => { setPendingDeleteId(tpl.id); setConfirmOpen(true); }}
              onRun={() => { setRunTarget(tpl); }}
              onLoadIntoBuilder={() => {
                window.dispatchEvent(new CustomEvent('orchaterm:load-template', { detail: { templateId: tpl.id } }));
              }}
            />
          ))}
        </div>
      )}

      {/* Editor / creator modal */}
      {(creating || editing) && (
        <TemplateEditor
          template={editing}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSave={(data) => {
            if (editing) {
              updatePipelineTemplate(editing.id, data);
              showToast(`Template "${data.title}" updated`, 'success');
            } else {
              addPipelineTemplate(data);
              showToast(`Template "${data.title}" created`, 'success');
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={confirmOpen}
        message={`Delete template "${pipelineTemplates.find(t => t.id === pendingDeleteId)?.title ?? ''}"?`}
        onConfirm={() => {
          if (pendingDeleteId) {
            deletePipelineTemplate(pendingDeleteId);
            showToast('Template deleted', 'info');
          }
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
        onCancel={() => { setConfirmOpen(false); setPendingDeleteId(null); }}
      />

      {/* Run modal */}
      {runTarget && (
        <RunTemplateModal
          template={runTarget}
          currentWorkspaceId={workspaceId}
          workspaces={workspaces}
          spaces={spaces}
          terminalSessions={terminalSessions}
          onCancel={() => setRunTarget(null)}
          onRun={handleRun}
        />
      )}
    </div>
  );
};

// ── TemplateCard ─────────────────────────────────────────────────────────────

const TemplateCard: React.FC<{
  template: PipelineTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  onLoadIntoBuilder: () => void;
}> = ({ template, onEdit, onDelete, onRun, onLoadIntoBuilder }) => {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardInfo}>
          <div className={styles.cardTitleRow}>
            <Workflow size={13} className={styles.cardIcon} />
            <h4 className={styles.cardTitle}>{template.title}</h4>
            <ExecutionModeBadge mode={template.executionMode} size={9} short />
          </div>
          {template.description && (
            <p className={styles.cardDesc}>{template.description}</p>
          )}
          {template.tags.length > 0 && (
            <div className={styles.tagsList}>
              {template.tags.map(tag => (
                <span key={tag} className={styles.tagItem}><Tag size={8} /> {tag}</span>
              ))}
            </div>
          )}
        </div>
        <div className={styles.cardActions}>
          <button onClick={onRun} className={styles.runBtn} title="Run against a workspace">
            <Play size={11} /> Run
          </button>
          <button onClick={onEdit} className={styles.iconBtn} title="Edit"><Edit2 size={11} /></button>
          <button onClick={onDelete} className={cx(styles.iconBtn, styles.iconBtnDanger)} title="Delete"><Trash2 size={11} /></button>
        </div>
      </div>
      <div className={styles.taskList}>
        {template.tasks.map((task, i) => (
          <TaskRow
            key={task.id}
            index={i + 1}
            title={task.title}
            agentHint={task.agentHint}
            dependsOn={task.dependsOnIndices.length > 0 ? `after #${task.dependsOnIndices.map(j => j + 1).join(', #')}` : undefined}
          />
        ))}
      </div>
      <div className={styles.cardFooter}>
        <span className={styles.footerMeta}>{template.tasks.length} task{template.tasks.length !== 1 ? 's' : ''}</span>
        <span className={styles.footerMeta}>Used {template.useCount}×</span>
        <button onClick={onLoadIntoBuilder} className={styles.loadBtn} title="Load into current workspace Builder">
          Load in Builder
        </button>
      </div>
    </div>
  );
};

// ── TemplateEditor ───────────────────────────────────────────────────────────

const TemplateEditor: React.FC<{
  template: PipelineTemplate | null;
  onCancel: () => void;
  onSave: (data: Omit<PipelineTemplate, 'id' | 'createdAt' | 'usedAt' | 'useCount'>) => void;
}> = ({ template, onCancel, onSave }) => {
  const [title, setTitle]       = useState(template?.title ?? '');
  const [description, setDesc]  = useState(template?.description ?? '');
  const [tagsText, setTagsText] = useState((template?.tags ?? []).join(', '));
  const [mode, setMode]         = useState<'sequential' | 'parallel'>(template?.executionMode ?? 'sequential');
  const [tasks, setTasks]       = useState<PipelineTemplateTask[]>(
    template?.tasks ?? [{ id: crypto.randomUUID(), title: '', description: '', dependsOnIndices: [] }],
  );
  const { draggedIdx, setDraggedIdx, dragOver, setDragOver, handleDrop } = useDragReorder(tasks, setTasks);

  const updateTask = (id: string, updates: Partial<PipelineTemplateTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };
  const removeTask = (id: string) => setTasks(prev => prev.filter(t => t.id !== id));
  const addTask = () => setTasks(prev => [...prev, { id: crypto.randomUUID(), title: '', description: '', dependsOnIndices: prev.length > 0 ? [prev.length - 1] : [] }]);



  const submit = () => {
    if (!title.trim()) { return; }
    onSave({
      title: title.trim(),
      description: description.trim(),
      tags: tagsText.split(',').map(t => t.trim()).filter(Boolean),
      executionMode: mode,
      tasks: tasks.filter(t => t.title.trim()).map(t => ({
        ...t,
        dependsOnIndices: t.dependsOnIndices.filter(i => i < tasks.length),
      })),
    });
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalLarge}>
        <div className={styles.modalHeader}>
          <h3>{template ? 'Edit Template' : 'New Template'}</h3>
          <button onClick={onCancel} className={styles.closeBtn}><X size={16} /></button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.formRow}>
            <label className={styles.fieldLabel}>Title</label>
            <Input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Bug-fix pipeline"
              className={styles.input}
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.fieldLabel}>Description</label>
            <Input
              type="text"
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="What is this pipeline for?"
              className={styles.input}
            />
          </div>
          <div className={styles.formGrid2}>
            <div className={styles.formRow}>
              <label className={styles.fieldLabel}>Tags (comma-separated)</label>
              <Input
                type="text"
                value={tagsText}
                onChange={e => setTagsText(e.target.value)}
                placeholder="bugfix, refactor, …"
                className={styles.input}
              />
            </div>
            <div className={styles.formRow}>
              <label className={styles.fieldLabel}>Execution mode</label>
              <ExecutionModeToggle mode={mode} onChange={setMode} />
            </div>
          </div>

          <div className={styles.tasksSection}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionLabel}>Tasks</span>
              <button type="button" onClick={addTask} className={styles.addTaskBtn}>
                <Plus size={11} /> Add Task
              </button>
            </div>
            {tasks.map((task, i) => (
              <DraggableTaskRow
                key={task.id}
                index={i}
                dragState={{ draggedIdx, setDraggedIdx, dragOver, setDragOver, handleDrop }}
                onRemove={() => removeTask(task.id)}
              >
                <Input
                  type="text"
                  value={task.title}
                  onChange={e => updateTask(task.id, { title: e.target.value })}
                  placeholder="Task title…"
                  className={styles.input}
                />
                <Input
                  type="text"
                  value={task.agentHint ?? ''}
                  onChange={e => updateTask(task.id, { agentHint: e.target.value })}
                  placeholder="agent hint"
                  className={styles.input}
                />
                <Input
                  type="text"
                  value={task.dependsOnIndices.map(j => j + 1).join(',')}
                  onChange={e => updateTask(task.id, {
                    dependsOnIndices: e.target.value
                      .split(',').map(v => parseInt(v.trim(), 10) - 1).filter(v => !isNaN(v) && v >= 0 && v < tasks.length),
                  })}
                  placeholder="deps"
                  className={cx(styles.input, styles.depsInput)}
                />
              </DraggableTaskRow>
            ))}
            {tasks.length === 0 && (
              <p className={styles.emptyHint}>No tasks yet. Add at least one.</p>
            )}
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button onClick={onCancel} className={styles.cancelBtn}>Cancel</button>
          <button
            onClick={submit}
            className={styles.primaryBtnSmall}
            disabled={!title.trim() || tasks.filter(t => t.title.trim()).length === 0}
          >
            {template ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── RunTemplateModal ─────────────────────────────────────────────────────────

const RunTemplateModal: React.FC<{
  template: PipelineTemplate;
  currentWorkspaceId: string;
  workspaces: Workspace[];
  spaces: Space[];
  terminalSessions: TerminalSession[];
  onCancel: () => void;
  onRun: (
    template: PipelineTemplate,
    workspaceId: string,
    spaceId: string | null,
    agentByTaskId: Record<string, { id: string; title: string }>,
  ) => void;
}> = ({ template, currentWorkspaceId, workspaces, spaces, terminalSessions, onCancel, onRun }) => {
  const [workspaceId, setWorkspaceId] = useState(currentWorkspaceId || workspaces[0]?.id || '');
  const [spaceId, setSpaceId] = useState<string | null>(
    spaces.find(sp => sp.workspaceId === (currentWorkspaceId || workspaces[0]?.id))?.id ?? null,
  );
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const scopeSessions = useMemo(() => {
    if (spaceId) {
      const sp = spaces.find(s => s.id === spaceId);
      return terminalSessions.filter(s => sp?.sessionIds.includes(s.id) ?? false);
    }
    return terminalSessions.filter(s => s.workspaceId === workspaceId);
  }, [spaceId, workspaceId, spaces, terminalSessions]);

  const matchByHint = (hint?: string): string => {
    if (!hint) return scopeSessions[0]?.id ?? '';
    const lc = hint.toLowerCase();
    return scopeSessions.find(s => s.title.toLowerCase().includes(lc))?.id ?? scopeSessions[0]?.id ?? '';
  };

  // Pre-fill assignments from agentHint whenever the workspace/space changes.
  React.useEffect(() => {
    const next: Record<string, string> = {};
    template.tasks.forEach(t => { next[t.id] = matchByHint(t.agentHint); });
    setAssignments(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, spaceId]);

  const ready = template.tasks.every(t => assignments[t.id]);

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalLarge}>
        <div className={styles.modalHeader}>
          <h3>Run "{template.title}"</h3>
          <button onClick={onCancel} className={styles.closeBtn}><X size={16} /></button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.formGrid2}>
            <Select
              label="Workspace"
              value={workspaceId}
              onChange={(value) => {
                setWorkspaceId(value);
                setSpaceId(spaces.find(sp => sp.workspaceId === value)?.id ?? null);
              }}
              options={workspaces.map(w => ({ value: w.id, name: w.name }))}
            />
            <Select
              label="Space (optional)"
              value={spaceId ?? ''}
              onChange={(value) => setSpaceId(value || null)}
              options={[
                { value: '', name: '— No space —' },
                ...spaces.filter(sp => sp.workspaceId === workspaceId).map(sp => ({ value: sp.id, name: sp.name })),
              ]}
            />
          </div>

          {scopeSessions.length === 0 && (
            <div className={styles.warningBanner}>
              No terminal sessions in this scope. Open at least one terminal tab in the workspace first.
            </div>
          )}

          <div className={styles.tasksSection}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionLabel}>Assign agents to tasks</span>
            </div>
            {template.tasks.map(task => (
              <div key={task.id} className={styles.editTaskRow}>
                <span className={styles.taskNum}>{template.tasks.indexOf(task) + 1}</span>
                <span className={styles.taskTitle}>{task.title}</span>
                <div className={styles.agentSelect}>
                  <Select
                    compact
                    value={assignments[task.id] ?? ''}
                    onChange={(value) => setAssignments(prev => ({ ...prev, [task.id]: value }))}
                    options={[
                      { value: '', name: '— Assign —', disabled: true },
                      ...scopeSessions.map(s => ({ value: s.id, name: s.title })),
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button onClick={onCancel} className={styles.cancelBtn}>Cancel</button>
          <button
            className={styles.primaryBtnSmall}
            disabled={!ready || scopeSessions.length === 0}
            onClick={() => {
              const agentByTaskId: Record<string, { id: string; title: string }> = {};
              for (const t of template.tasks) {
                const sid = assignments[t.id];
                const session = scopeSessions.find(s => s.id === sid);
                if (session) agentByTaskId[t.id] = { id: session.id, title: session.title };
              }
              onRun(template, workspaceId, spaceId, agentByTaskId);
            }}
          >
            <Play size={11} /> Start Pipeline
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Helpers ──

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const slideUp = keyframes`from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; }`;

const styles = {
  container: css`
    flex: 1; min-height: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px;
    padding: 12px;
    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
  `,
  header: css`
    display: flex; align-items: center; justify-content: flex-end; gap: var(--spacing-sm);
  `,
  primaryBtn: css`
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--gradient-brand); color: #fff;
    padding: 6px 12px; border: none; border-radius: var(--border-radius-md);
    font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold);
    cursor: pointer; transition: filter 0.15s;
    box-shadow: 0 2px 6px rgba(123, 104, 238, 0.25);
    &:hover { filter: brightness(1.06); }
  `,
  primaryBtnSmall: css`
    background: var(--gradient-brand); color: #fff;
    padding: 7px 14px; border: none; border-radius: var(--border-radius-md);
    font-size: var(--font-size-xs); font-weight: var(--font-weight-bold);
    cursor: pointer; transition: filter 0.15s;
    display: inline-flex; align-items: center; gap: 5px;
    &:hover:not(:disabled) { filter: brightness(1.06); }
    &:disabled { opacity: 0.4; cursor: default; }
  `,
  filtersArea: css`
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    padding: var(--spacing-sm);
    display: flex; flex-direction: column; gap: 8px;
  `,
  searchRow: css`
    display: flex; align-items: center; gap: 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 4px 8px;
  `,
  searchIcon: css`color: var(--text-tertiary); flex-shrink: 0;`,
  searchInput: css`
    flex: 1; background: transparent; border: none; outline: none;
    font-size: var(--font-size-xs); color: var(--text-primary);
    &::placeholder { color: var(--text-tertiary); }
  `,
  clearBtn: css`
    background: transparent; border: none; cursor: pointer;
    color: var(--text-tertiary); padding: 1px;
    &:hover { color: var(--text-primary); }
  `,
  tagRow: css`
    display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  `,
  tagChip: css`
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 8px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    font-size: 10px; color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
    &:hover { color: var(--text-primary); border-color: var(--border-color-hover); }
  `,
  tagChipActive: css`
    background: rgba(var(--color-brand-rgb), 0.15);
    border-color: var(--color-brand);
    color: var(--color-brand);
  `,
  clearTagsBtn: css`
    background: transparent; border: none; cursor: pointer;
    font-size: 10px; color: var(--text-tertiary); font-weight: 600;
    &:hover { color: var(--color-error); }
  `,
  emptyState: css`
    padding: var(--spacing-xl);
    text-align: center;
    border: 1px dashed var(--border-color);
    border-radius: var(--border-radius-md);
    background-color: var(--bg-secondary);
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  `,
  emptyIcon: css`color: var(--border-color-hover);`,
  emptyTitle: css`color: var(--text-secondary); margin: 0; font-size: var(--font-size-sm); font-weight: 600;`,
  emptySubtitle: css`font-size: 10px; color: var(--text-tertiary); margin: 0;`,
  cardsList: css`
    display: flex; flex-direction: column; gap: 10px;
  `,
  card: css`
    border-radius: var(--border-radius-md);
    border: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    overflow: hidden;
    transition: border-color 0.15s;
    &:hover { border-color: var(--border-color-hover); }
  `,
  cardHeader: css`
    padding: 10px 12px;
    display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;
  `,
  cardInfo: css`
    display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;
  `,
  cardTitleRow: css`
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  `,
  cardIcon: css`color: var(--color-brand); flex-shrink: 0;`,
  cardTitle: css`
    font-weight: var(--font-weight-bold); color: var(--text-primary);
    font-size: var(--font-size-sm); margin: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 150px;
  `,

  cardDesc: css`
    font-size: 10px; color: var(--text-secondary); margin: 0; line-height: 1.4;
  `,
  tagsList: css`
    display: flex; flex-wrap: wrap; gap: 3px;
  `,
  tagItem: css`
    display: inline-flex; align-items: center; gap: 2px;
    font-size: 9px; padding: 1px 5px; border-radius: 99px;
    background: var(--bg-tertiary); color: var(--text-secondary);
    border: 1px solid var(--border-color);
  `,
  cardActions: css`
    display: flex; gap: 4px; flex-shrink: 0;
  `,
  runBtn: css`
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--color-brand); color: #fff;
    padding: 4px 8px; border: none; border-radius: var(--border-radius-sm);
    font-size: 10px; font-weight: 700; cursor: pointer;
    &:hover { filter: brightness(1.08); }
  `,
  iconBtn: css`
    width: 24px; height: 24px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    color: var(--text-tertiary); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    transition: all 0.15s;
    &:hover { color: var(--text-primary); border-color: var(--border-color-hover); }
  `,
  iconBtnDanger: css`
    &:hover { color: var(--color-error); border-color: var(--color-error); background: rgba(var(--color-error-rgb), 0.1); }
  `,
  taskList: css`
    padding: 0 12px 10px;
    display: flex; flex-direction: column; gap: 3px;
  `,

  cardFooter: css`
    padding: 6px 12px;
    display: flex; align-items: center; gap: var(--spacing-sm);
    border-top: 1px solid var(--border-color);
    background: var(--bg-canvas);
  `,
  footerMeta: css`
    font-size: 9px; color: var(--text-tertiary); font-weight: 600;
  `,
  loadBtn: css`
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    padding: 3px 8px; border-radius: var(--border-radius-sm);
    font-size: 10px; font-weight: 600; cursor: pointer;
    &:hover { color: var(--color-brand); border-color: var(--color-brand); }
  `,

  modalOverlay: css`
    position: fixed; inset: 0; z-index: 80;
    display: flex; align-items: center; justify-content: center;
    padding: var(--spacing-md);
    background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    animation: ${fadeIn} 0.2s ease-out;
  `,
  modalLarge: css`
    width: 100%; max-width: 720px; max-height: 88vh;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    box-shadow: var(--shadow-lg);
    display: flex; flex-direction: column;
    animation: ${slideUp} 0.22s ease-out;
  `,
  modalHeader: css`
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--spacing-md) var(--spacing-lg);
    border-bottom: 1px solid var(--border-color);
    h3 { font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); margin: 0; color: var(--text-primary); }
  `,
  closeBtn: css`
    background: transparent; border: none; cursor: pointer;
    color: var(--text-tertiary); padding: 4px; border-radius: 4px;
    &:hover { color: var(--text-primary); background: var(--bg-hover); }
  `,
  modalBody: css`
    padding: var(--spacing-lg);
    overflow-y: auto;
    display: flex; flex-direction: column; gap: var(--spacing-md);
  `,
  modalFooter: css`
    padding: var(--spacing-md) var(--spacing-lg);
    border-top: 1px solid var(--border-color);
    display: flex; justify-content: flex-end; gap: 8px;
  `,
  cancelBtn: css`
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    padding: 7px 14px; border-radius: var(--border-radius-md);
    font-size: var(--font-size-xs); font-weight: 600;
    cursor: pointer;
    &:hover { color: var(--text-primary); border-color: var(--border-color-hover); }
  `,
  formRow: css`
    display: flex; flex-direction: column; gap: 6px;
  `,
  formGrid2: css`
    display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-md);
    @media (max-width: 640px) { grid-template-columns: 1fr; }
  `,
  fieldLabel: css`
    font-size: 11px; font-weight: 600; color: var(--text-secondary);
  `,
  input: css`
    width: 100%;
    background: var(--bg-input); border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 6px 10px;
    font-size: var(--font-size-sm); color: var(--text-primary);
    outline: none;
    &:focus { border-color: var(--color-brand); }
    &::placeholder { color: var(--text-tertiary); }
  `,
  tasksSection: css`
    display: flex; flex-direction: column; gap: 6px;
  `,
  sectionHead: css`
    display: flex; align-items: center; justify-content: space-between;
  `,
  sectionLabel: css`
    font-size: 11px; font-weight: 700; color: var(--text-tertiary);
    text-transform: uppercase; letter-spacing: 0.06em;
  `,
  addTaskBtn: css`
    display: inline-flex; align-items: center; gap: 4px;
    background: transparent; border: 1px solid var(--border-color);
    color: var(--text-secondary); font-size: 11px; font-weight: 600;
    padding: 4px 8px; border-radius: var(--border-radius-sm);
    cursor: pointer;
    &:hover { color: var(--color-brand); border-color: var(--color-brand); }
  `,
  editTaskRow: css`
    position: relative;
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
  `,
  taskNum: css`
    font-size: 10px; font-weight: 700; color: var(--text-tertiary);
    width: 16px; text-align: right; flex-shrink: 0;
  `,
  taskTitle: css`
    flex: 1; min-width: 0; font-size: 11px;
    color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  depsInput: css`
    width: 80px; flex: none;
  `,
  agentSelect: css`flex: 1; min-width: 0;`,
  emptyHint: css`font-size: 11px; color: var(--text-tertiary); font-style: italic; text-align: center; padding: 8px 0;`,
  warningBanner: css`
    background: rgba(var(--color-warning-rgb), 0.08);
    border: 1px solid rgba(var(--color-warning-rgb), 0.3);
    color: var(--color-warning);
    padding: 8px 12px; border-radius: var(--border-radius-sm);
    font-size: 11px;
  `,
};
