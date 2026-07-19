/*
 * PipelineTemplates.tsx
 *
 * Full-page management view for reusable pipeline templates. Mirrors the
 * PromptVault structure: search/filter, cards with details, edit modal,
 * delete confirm, and a Run flow that targets a workspace/space.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { css, cx, keyframes } from '@emotion/css';
import {
  Plus, Edit2, Trash2, Search, X, ListOrdered, Zap, Tag, Play, Workflow,
} from 'lucide-react';
import { useDashboard } from '../context/DashboardContext';
import { ConfirmDialog, Input } from '../components/ui';
import { orchestratorEngine } from '../services/orchestratorEngine';
import type { OrchestratorPlan, PipelineTemplate, PipelineTemplateTask } from '../types';

export const PipelineTemplatesView: React.FC = () => {
  const navigate = useNavigate();
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

  // ── Run flow ──────────────────────────────────────────────────────────────
  const handleRun = (
    template: PipelineTemplate,
    workspaceId: string,
    spaceId: string | null,
    agentByTaskId: Record<string, { id: string; title: string }>,
  ) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (!workspace) {
      showToast('Pick a workspace first', 'error');
      return;
    }
    const sessionsInScope = spaceId
      ? terminalSessions.filter(s => spaces.find(sp => sp.id === spaceId)?.sessionIds.includes(s.id) ?? false)
      : terminalSessions.filter(s => s.workspaceId === workspaceId);

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
      workspaceId,
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
    // The dashboard's own active-workspace state is what we should mutate; we use
    // window events so the sidebar / workspace router picks it up.
    window.dispatchEvent(new CustomEvent('orchaterm:open-workspace', { detail: { workspaceId, spaceId } }));
    navigate('/');
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Pipeline Templates</h2>
          <p className={styles.description}>
            Reusable multi-step pipelines. Run them against any workspace, or load them into the Builder.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setCreating(true); }}
          className={styles.primaryBtn}
        >
          <Plus size={14} />
          New Template
        </button>
      </div>

      {/* Filters */}
      <div className={styles.filtersArea}>
        <div className={styles.searchRow}>
          <Search size={12} className={styles.searchIcon} />
          <Input
            type="text"
            placeholder="Search by title, description, tag, or task…"
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
          <Workflow size={28} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>No templates yet.</p>
          <p className={styles.emptySubtitle}>
            Build a pipeline in the Pipeline tab and click "Save as Template", or create one from scratch here.
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
                showToast(`Loaded "${tpl.title}" into the Builder — open the console to continue`, 'info');
                navigate('/');
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
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={confirmOpen}
        message={`Delete template "${pipelineTemplates.find(t => t.id === pendingDeleteId)?.title ?? ''}"? This cannot be undone.`}
        onConfirm={() => {
          if (pendingDeleteId) deletePipelineTemplate(pendingDeleteId);
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
        onCancel={() => { setConfirmOpen(false); setPendingDeleteId(null); }}
      />

      {/* Run modal */}
      {runTarget && (
        <RunTemplateModal
          template={runTarget}
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
  const isSeq = template.executionMode === 'sequential';
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardInfo}>
          <div className={styles.cardTitleRow}>
            <Workflow size={14} className={styles.cardIcon} />
            <h4 className={styles.cardTitle}>{template.title}</h4>
            <span className={cx(styles.modeBadge, isSeq ? styles.modeSeq : styles.modePar)} title={`Execution: ${template.executionMode}`}>
              {isSeq ? <ListOrdered size={10} /> : <Zap size={10} />}
              {isSeq ? 'Sequential' : 'Parallel'}
            </span>
          </div>
          {template.description && (
            <p className={styles.cardDesc}>{template.description}</p>
          )}
          <div className={styles.tagsList}>
            {template.tags.map(tag => (
              <span key={tag} className={styles.tagItem}><Tag size={9} /> {tag}</span>
            ))}
          </div>
        </div>
        <div className={styles.cardActions}>
          <button onClick={onRun} className={styles.runBtn} title="Run against a workspace">
            <Play size={12} /> Run
          </button>
          <button onClick={onEdit} className={styles.iconBtn} title="Edit template"><Edit2 size={12} /></button>
          <button onClick={onDelete} className={cx(styles.iconBtn, styles.iconBtnDanger)} title="Delete template"><Trash2 size={12} /></button>
        </div>
      </div>
      <div className={styles.taskList}>
        {template.tasks.map((task, i) => (
          <div key={task.id} className={styles.taskRow}>
            <span className={styles.taskNum}>{i + 1}</span>
            <span className={styles.taskTitle}>{task.title}</span>
            {task.agentHint && <span className={styles.taskAgent}>→ {task.agentHint}</span>}
            {task.dependsOnIndices.length > 0 && (
              <span className={styles.taskDeps}>after #{task.dependsOnIndices.map(j => j + 1).join(', #')}</span>
            )}
          </div>
        ))}
      </div>
      <div className={styles.cardFooter}>
        <span className={styles.footerMeta}>{template.tasks.length} task{template.tasks.length !== 1 ? 's' : ''}</span>
        <span className={styles.footerMeta}>Used {template.useCount}× {template.usedAt ? `· last ${formatRelative(template.usedAt)}` : ''}</span>
        <button onClick={onLoadIntoBuilder} className={styles.loadBtn} title="Open in the Builder (current workspace)">
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

  const updateTask = (id: string, updates: Partial<PipelineTemplateTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };
  const removeTask = (id: string) => setTasks(prev => prev.filter(t => t.id !== id));
  const addTask = () => setTasks(prev => [...prev, { id: crypto.randomUUID(), title: '', description: '', dependsOnIndices: prev.length > 0 ? [prev.length - 1] : [] }]);
  const moveTask = (idx: number, dir: -1 | 1) => {
    const next = [...tasks];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setTasks(next);
  };

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
              <div className={styles.modeToggle}>
                <button
                  type="button"
                  className={cx(styles.modeBtn, mode === 'sequential' && styles.modeBtnActive)}
                  onClick={() => setMode('sequential')}
                >
                  <ListOrdered size={11} /> Sequential
                </button>
                <button
                  type="button"
                  className={cx(styles.modeBtn, mode === 'parallel' && styles.modeBtnActive)}
                  onClick={() => setMode('parallel')}
                >
                  <Zap size={11} /> Parallel
                </button>
              </div>
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
              <div key={task.id} className={styles.editTaskRow}>
                <span className={styles.taskNum}>{i + 1}</span>
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
                  placeholder="agent hint (tab name)"
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
                  className={styles.depsInput}
                />
                <button type="button" onClick={() => moveTask(i, -1)} disabled={i === 0} className={styles.moveBtn} title="Move up">↑</button>
                <button type="button" onClick={() => moveTask(i, 1)} disabled={i === tasks.length - 1} className={styles.moveBtn} title="Move down">↓</button>
                <button type="button" onClick={() => removeTask(task.id)} className={styles.removeBtn} title="Remove">
                  <Trash2 size={11} />
                </button>
              </div>
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
  workspaces: { id: string; name: string }[];
  spaces: { id: string; name: string; workspaceId: string; sessionIds: string[] }[];
  terminalSessions: { id: string; title: string; color: string | null; workspaceId: string }[];
  onCancel: () => void;
  onRun: (
    template: PipelineTemplate,
    workspaceId: string,
    spaceId: string | null,
    agentByTaskId: Record<string, { id: string; title: string }>,
  ) => void;
}> = ({ template, workspaces, spaces, terminalSessions, onCancel, onRun }) => {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [spaceId, setSpaceId] = useState<string | null>(
    spaces.find(sp => sp.workspaceId === workspaces[0]?.id)?.id ?? null,
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
            <div className={styles.formRow}>
              <label className={styles.fieldLabel}>Workspace</label>
              <select
                className={styles.selectInput}
                value={workspaceId}
                onChange={e => {
                  setWorkspaceId(e.target.value);
                  setSpaceId(spaces.find(sp => sp.workspaceId === e.target.value)?.id ?? null);
                }}
              >
                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className={styles.formRow}>
              <label className={styles.fieldLabel}>Space (optional)</label>
              <select
                className={styles.selectInput}
                value={spaceId ?? ''}
                onChange={e => setSpaceId(e.target.value || null)}
              >
                <option value="">— No space —</option>
                {spaces.filter(sp => sp.workspaceId === workspaceId).map(sp => (
                  <option key={sp.id} value={sp.id}>{sp.name}</option>
                ))}
              </select>
            </div>
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
                <select
                  className={cx(styles.selectInput, styles.agentSelect)}
                  value={assignments[task.id] ?? ''}
                  onChange={e => setAssignments(prev => ({ ...prev, [task.id]: e.target.value }))}
                >
                  <option value="">— Assign —</option>
                  {scopeSessions.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  try {
    const ms = new Date(iso).getTime();
    const diff = Date.now() - ms;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return new Date(ms).toLocaleDateString();
  } catch {
    return '';
  }
}

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const slideUp = keyframes`from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; }`;

const styles = {
  container: css`
    flex: 1; overflow-y: auto;
    padding: var(--spacing-xl);
    display: flex; flex-direction: column; gap: var(--spacing-xl);
    background-color: var(--bg-primary);
  `,
  header: css`
    display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-md);
  `,
  title: css`
    font-size: var(--font-size-3xl); font-weight: var(--font-weight-bold);
    letter-spacing: -0.025em; color: var(--text-primary); margin: 0;
  `,
  description: css`
    font-size: var(--font-size-sm); color: var(--text-secondary); margin: 4px 0 0;
  `,
  primaryBtn: css`
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--gradient-brand); color: #fff;
    padding: 8px 14px; border: none; border-radius: var(--border-radius-md);
    font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold);
    cursor: pointer; transition: filter 0.15s;
    box-shadow: 0 4px 14px rgba(123, 104, 238, 0.3);
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
    border-radius: var(--border-radius-lg);
    padding: var(--spacing-md);
    display: flex; flex-direction: column; gap: 10px;
  `,
  searchRow: css`
    display: flex; align-items: center; gap: 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 6px 12px;
  `,
  searchIcon: css`color: var(--text-tertiary); flex-shrink: 0;`,
  searchInput: css`
    flex: 1; background: transparent; border: none; outline: none;
    font-size: var(--font-size-sm); color: var(--text-primary);
    &::placeholder { color: var(--text-tertiary); }
  `,
  clearBtn: css`
    background: transparent; border: none; cursor: pointer;
    color: var(--text-tertiary); padding: 2px;
    &:hover { color: var(--text-primary); }
  `,
  tagRow: css`
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  `,
  tagChip: css`
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    font-size: 11px; color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
    &:hover { color: var(--text-primary); border-color: var(--border-color-hover); }
  `,
  tagChipActive: css`
    background: rgba(var(--color-brand-rgb), 0.15) !important;
    border-color: var(--color-brand) !important;
    color: var(--color-brand) !important;
  `,
  clearTagsBtn: css`
    background: transparent; border: none; cursor: pointer;
    font-size: 11px; color: var(--text-tertiary); font-weight: 600;
    &:hover { color: var(--color-error); }
  `,

  emptyState: css`
    padding: var(--spacing-3xl);
    text-align: center;
    border: 1px dashed var(--border-color);
    border-radius: var(--border-radius-lg);
    background-color: var(--bg-secondary);
    display: flex; flex-direction: column; align-items: center; gap: 6px;
  `,
  emptyIcon: css`color: var(--border-color-hover);`,
  emptyTitle: css`color: var(--text-secondary); margin: 0;`,
  emptySubtitle: css`font-size: var(--font-size-xs); color: var(--text-tertiary); margin: 0;`,

  cardsList: css`
    display: flex; flex-direction: column; gap: var(--spacing-md);
  `,
  card: css`
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    overflow: hidden;
    transition: border-color 0.15s;
    &:hover { border-color: var(--border-color-hover); }
  `,
  cardHeader: css`
    padding: var(--spacing-md) var(--spacing-lg);
    display: flex; justify-content: space-between; align-items: flex-start; gap: var(--spacing-md);
  `,
  cardInfo: css`
    display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0;
  `,
  cardTitleRow: css`
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  `,
  cardIcon: css`color: var(--color-brand); flex-shrink: 0;`,
  cardTitle: css`
    font-weight: var(--font-weight-bold); color: var(--text-primary);
    font-size: var(--font-size-base); margin: 0;
  `,
  modeBadge: css`
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 9px; padding: 2px 8px; border-radius: 99px;
    border: 1px solid; font-weight: 700;
  `,
  modeSeq: css`
    background: rgba(var(--color-info-rgb), 0.12); color: var(--color-info);
    border-color: rgba(var(--color-info-rgb), 0.3);
  `,
  modePar: css`
    background: rgba(var(--color-warning-rgb), 0.12); color: var(--color-warning);
    border-color: rgba(var(--color-warning-rgb), 0.3);
  `,
  cardDesc: css`
    font-size: 11px; color: var(--text-secondary); margin: 0; line-height: 1.5;
  `,
  tagsList: css`
    display: flex; flex-wrap: wrap; gap: 4px;
  `,
  tagItem: css`
    display: inline-flex; align-items: center; gap: 3px;
    font-size: 9px; padding: 1px 6px; border-radius: 99px;
    background: var(--bg-tertiary); color: var(--text-secondary);
    border: 1px solid var(--border-color);
  `,
  cardActions: css`
    display: flex; gap: 4px; flex-shrink: 0;
  `,
  runBtn: css`
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--color-brand); color: #fff;
    padding: 5px 10px; border: none; border-radius: var(--border-radius-sm);
    font-size: 11px; font-weight: 700; cursor: pointer;
    &:hover { filter: brightness(1.08); }
  `,
  iconBtn: css`
    width: 28px; height: 28px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    color: var(--text-tertiary); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    transition: all 0.15s;
    &:hover { color: var(--text-primary); border-color: var(--border-color-hover); }
  `,
  iconBtnDanger: css`
    &:hover { color: var(--color-error) !important; border-color: var(--color-error) !important; background: rgba(var(--color-error-rgb), 0.1) !important; }
  `,

  taskList: css`
    padding: 0 var(--spacing-lg);
    display: flex; flex-direction: column; gap: 2px;
  `,
  taskRow: css`
    display: flex; align-items: center; gap: 8px;
    padding: 5px 8px;
    border-radius: var(--border-radius-sm);
    background: var(--bg-tertiary);
    font-size: 11px;
  `,
  taskNum: css`
    font-size: 10px; font-weight: 700; color: var(--text-tertiary);
    width: 16px; text-align: right; flex-shrink: 0;
  `,
  taskTitle: css`
    flex: 1; min-width: 0;
    color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  taskAgent: css`
    font-size: 10px; color: var(--color-brand); font-weight: 600;
    flex-shrink: 0;
  `,
  taskDeps: css`
    font-size: 10px; color: var(--text-tertiary); flex-shrink: 0;
  `,

  cardFooter: css`
    padding: 8px var(--spacing-lg);
    display: flex; align-items: center; gap: var(--spacing-md);
    border-top: 1px solid var(--border-color);
    background: var(--bg-canvas);
  `,
  footerMeta: css`
    font-size: 10px; color: var(--text-tertiary); font-weight: 600;
  `,
  loadBtn: css`
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    padding: 4px 10px; border-radius: var(--border-radius-sm);
    font-size: 11px; font-weight: 600; cursor: pointer;
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
  selectInput: css`
    background: var(--bg-input); border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 6px 10px;
    font-size: var(--font-size-sm); color: var(--text-primary);
    outline: none; cursor: pointer;
    &:focus { border-color: var(--color-brand); }
  `,

  modeToggle: css`
    display: flex; gap: 2px;
    background: var(--bg-input); border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm); padding: 2px;
  `,
  modeBtn: css`
    flex: 1;
    display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    background: transparent; border: none; cursor: pointer;
    color: var(--text-tertiary); font-size: 11px; font-weight: 600;
    padding: 5px 8px; border-radius: 4px;
    &:hover { color: var(--text-primary); }
  `,
  modeBtnActive: css`
    background: var(--color-brand); color: #fff;
    &:hover { color: #fff; }
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
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
  `,
  depsInput: css`
    width: 80px !important; flex: none !important;
  `,
  agentSelect: css`width: auto !important; flex: 1 !important;`,
  moveBtn: css`
    background: transparent; border: 1px solid var(--border-color);
    color: var(--text-tertiary); cursor: pointer;
    width: 22px; height: 24px; border-radius: 4px;
    &:hover:not(:disabled) { color: var(--text-primary); border-color: var(--border-color-hover); }
    &:disabled { opacity: 0.35; cursor: default; }
  `,
  removeBtn: css`
    background: transparent; border: 1px solid var(--border-color);
    color: var(--text-tertiary); cursor: pointer;
    width: 24px; height: 24px; border-radius: 4px;
    display: inline-flex; align-items: center; justify-content: center;
    &:hover { color: var(--color-error); border-color: var(--color-error); }
  `,
  emptyHint: css`font-size: 11px; color: var(--text-tertiary); font-style: italic; text-align: center; padding: 8px 0;`,

  warningBanner: css`
    background: rgba(var(--color-warning-rgb), 0.08);
    border: 1px solid rgba(var(--color-warning-rgb), 0.3);
    color: var(--color-warning);
    padding: 8px 12px; border-radius: var(--border-radius-sm);
    font-size: 11px;
  `,
};
