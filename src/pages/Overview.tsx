import React, { useState, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { useDashboard } from '../context/DashboardContext';
import { TerminalContainer } from '../components/terminal/TerminalContainer';
import { WorkspacePanel } from '../components/ui/WorkspacePanel';
import { WorkspaceConductor } from '../components/conductor/WorkspaceConductor';
import { GroupChat } from '../components/ui/GroupChat';
import {
  Plus,
  ChevronRight,
  Edit2,
  ArrowLeft,
  Network,
  MessageSquare,
  Layers,
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const {
    workspaces,
    spaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeSpaceId,
    updateWorkspace,
    showToast,
    addWorkspace,
    viewMode,
    setViewMode,
  } = useDashboard();

  // Dialog state
  const [showAddProj, setShowAddProj] = useState(false);

  // Open new-workspace dialog when triggered from Sidebar shortcut
  useEffect(() => {
    if (localStorage.getItem('agentdeck:open-new-workspace') === '1') {
      localStorage.removeItem('agentdeck:open-new-workspace');
      setShowAddProj(true);
    }
  }, []);
  const [newProjName, setNewProjName] = useState('');
  const [newProjPath, setNewProjPath] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjColor, setNewProjColor] = useState('#3b82f6');

  // Inline task edit state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskValue, setEditTaskValue] = useState('');

  // Console right-panel tab
  const [rightPanel, setRightPanel] = useState<'workspace' | 'conductor' | 'chat'>('workspace');

  const activeProject = workspaces.find(p => p.id === activeWorkspaceId) || workspaces[0];

  const handleTaskSave = (projId: string) => {
    updateWorkspace(projId, { currentTask: editTaskValue });
    setEditingTaskId(null);
    showToast('Task updated', 'success');
  };

  const handleAddProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) { showToast('Workspace name is required', 'error'); return; }
    if (!newProjPath.trim()) { showToast('Workspace path is required', 'error'); return; }
    addWorkspace({
      name: newProjName,
      path: newProjPath,
      description: newProjDesc,
      color: newProjColor,
      status: 'active',
      currentTask: '',
    });
    setNewProjName('');
    setNewProjPath('');
    setNewProjDesc('');
    setNewProjColor('#3b82f6');
    setShowAddProj(false);
  };

  // ── Console view ──────────────────────────────────────────────────────────
  if (viewMode === 'console' && activeProject) {
    const activeSpace = activeSpaceId
      ? spaces.find(sp => sp.id === activeSpaceId && sp.workspaceId === activeProject.id)
      : null;
    // Key for right-panel components: remount when workspace OR space changes
    const panelKey = `${activeProject.id}::${activeSpaceId ?? 'workspace'}`;

    return (
      <div className={s.consoleRoot}>
        <div className={s.consoleHeader}>
          <div className={s.consoleHeaderLeft}>
            <span
              className={s.consoleDot}
              style={{ backgroundColor: activeProject.color || '#FF9D00' }}
            />
            <span className={s.consoleLabel}>Workspace</span>
            <h2 className={s.consoleName}>{activeProject.name}</h2>
            <span className={s.consolePath}>({activeProject.path})</span>

            {/* Active space pill — only shown when a space is selected */}
            {activeSpace && (
              <div className={s.spacePill} style={{ borderColor: activeSpace.color + '60' }}>
                <Layers className={s.spacePillIcon} style={{ color: activeSpace.color }} />
                <span className={s.spacePillName} style={{ color: activeSpace.color }}>
                  {activeSpace.name}
                </span>
              </div>
            )}
          </div>
          <button onClick={() => setViewMode('grid')} className={s.consoleBackBtn}>
            <ArrowLeft className={s.iconSm} style={{ color: '#FF9D00' }} />
            <span>Workspaces</span>
          </button>
        </div>

        <div className={s.consoleSplit}>
          <div className={s.consoleSplitLeft}>
            <TerminalContainer key={panelKey} scopeKey={panelKey} workspaceId={activeProject.id} workspacePath={activeProject.path} />
          </div>
          <div className={s.consoleSplitRight}>
            <div className={s.rightTabBar}>
              <button
                className={cx(s.rightTab, rightPanel === 'workspace' && s.rightTabActive)}
                onClick={() => setRightPanel('workspace')}
              >
                Workspace
              </button>
              <button
                className={cx(s.rightTab, rightPanel === 'conductor' && s.rightTabActive)}
                onClick={() => setRightPanel('conductor')}
              >
                <Network className={s.rightTabIcon} />
                Conductor
                {activeProject && localStorage.getItem(`agentdeck:conductor:running:${activeProject.id}`) === 'true' && (
                  <span className={s.tabRunningDot} />
                )}
              </button>
              <button
                className={cx(s.rightTab, rightPanel === 'chat' && s.rightTabActive)}
                onClick={() => setRightPanel('chat')}
              >
                <MessageSquare className={s.rightTabIcon} />
                Chat
              </button>
            </div>
            <div className={s.rightPanelContent}>
              {rightPanel === 'workspace' && <WorkspacePanel workspace={activeProject} />}
              {rightPanel === 'conductor' && <WorkspaceConductor key={panelKey} workspaceId={activeProject.id} />}
              {rightPanel === 'chat'      && <GroupChat key={panelKey} workspaceId={activeProject.id} />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Grid / Overview view ──────────────────────────────────────────────────
  return (
    <div className={s.root}>
      {/* Header */}
      <div className={s.topHeader}>
        <div>
          <h2 className={s.topTitle}>Workspaces</h2>
          <p className={s.topSubtitle}>
            {workspaces.length === 0
              ? 'No workspaces yet.'
              : `${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={() => setShowAddProj(true)} className={s.createBtn}>
          <Plus className={s.iconSm} />
          <span>New Workspace</span>
        </button>
      </div>

      {/* Empty state */}
      {workspaces.length === 0 ? (
        <div className={s.emptyState}>
          <p className={s.emptyText}>No workspaces added yet. Create one to get started.</p>
          <button onClick={() => setShowAddProj(true)} className={s.emptyBtn}>
            <Plus className={s.iconSm} />
            <span>Add Your First Workspace</span>
          </button>
        </div>
      ) : (
        <div className={s.cardsGrid}>
          {workspaces.map((proj) => {
            const isActive = proj.id === activeProject?.id;

            return (
              <div key={proj.id} className={cx(s.card, isActive && s.cardActive)}>
                {/* Color accent strip */}
                <div
                  className={s.colorStrip}
                  style={{ backgroundColor: proj.color || '#3b82f6' }}
                />

                {/* Workspace identity */}
                <div className={s.cardMeta}>
                  <h4 className={s.cardName}>{proj.name}</h4>
                  <p className={s.cardPath}>{proj.path}</p>
                  {proj.description && <p className={s.cardDesc}>{proj.description}</p>}
                  {(() => {
                    const spaceCount = spaces.filter(sp => sp.workspaceId === proj.id).length;
                    return spaceCount > 0 ? (
                      <div className={s.cardSpaceBadge}>
                        {spaceCount} space{spaceCount !== 1 ? 's' : ''}
                      </div>
                    ) : null;
                  })()}
                </div>

                {/* Inline-editable current task */}
                <div className={s.taskBlock}>
                  <div className={s.taskLabel}>Current Task</div>
                  {editingTaskId === proj.id ? (
                    <div className={s.taskEditRow}>
                      <input
                        type="text"
                        value={editTaskValue}
                        onChange={(e) => setEditTaskValue(e.target.value)}
                        onBlur={() => handleTaskSave(proj.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleTaskSave(proj.id);
                          if (e.key === 'Escape') setEditingTaskId(null);
                        }}
                        className={s.taskInput}
                        autoFocus
                      />
                      <button onClick={() => handleTaskSave(proj.id)} className={s.taskSaveBtn}>
                        Save
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => { setEditingTaskId(proj.id); setEditTaskValue(proj.currentTask || ''); }}
                      className={s.taskDisplay}
                    >
                      <span>{proj.currentTask || 'Click to set a task…'}</span>
                      <Edit2 className={s.taskEditIcon} />
                    </div>
                  )}
                </div>

                {/* Footer action */}
                <div className={s.cardFooter}>
                  <button
                    onClick={() => {
                      if (!isActive) {
                        setActiveWorkspaceId(proj.id);
                        showToast(`Switched to ${proj.name}`, 'info');
                      }
                      setViewMode('console');
                    }}
                    className={isActive ? s.openConsoleBtn : s.switchBtn}
                  >
                    <span>Open Console</span>
                    <ChevronRight className={s.iconXs} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Workspace Dialog */}
      {showAddProj && (
        <div className={s.dialogOverlay}>
          <div className={s.dialogBox}>
            <h3 className={s.dialogTitle}>New Workspace</h3>
            <form onSubmit={handleAddProjectSubmit} className={s.dialogForm}>
              <div>
                <label className={s.dialogLabel}>Workspace Name</label>
                <input
                  type="text"
                  placeholder="e.g. My Project"
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  className={s.dialogInput}
                  required
                />
              </div>
              <div>
                <label className={s.dialogLabel}>Local Directory Path</label>
                <input
                  type="text"
                  placeholder="e.g. C:\Users\me\projects\my-app"
                  value={newProjPath}
                  onChange={(e) => setNewProjPath(e.target.value)}
                  className={s.dialogInput}
                  required
                />
              </div>
              <div>
                <label className={s.dialogLabel}>Description</label>
                <textarea
                  placeholder="Brief summary of workspace goals…"
                  value={newProjDesc}
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  rows={2}
                  className={s.dialogInput}
                />
              </div>
              <div>
                <label className={s.dialogLabel}>Color Accent</label>
                <input
                  type="color"
                  value={newProjColor}
                  onChange={(e) => setNewProjColor(e.target.value)}
                  className={s.colorPicker}
                />
              </div>
              <div className={s.dialogActions}>
                <button
                  type="button"
                  onClick={() => setShowAddProj(false)}
                  className={s.dialogCancelBtn}
                >
                  Cancel
                </button>
                <button type="submit" className={s.dialogSubmitBtn}>
                  Create Workspace
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Emotion Styles ──────────────────────────────────────────────────────── */

const s = {
  /* ─── Console mode ─── */
  consoleRoot: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100vh;
    overflow: hidden;
    background: #070d14;
  `,
  consoleHeader: css`
    padding: var(--spacing-md) var(--spacing-lg);
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    user-select: none;
  `,
  consoleHeaderLeft: css`
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  `,
  consoleDot: css`
    width: 10px;
    height: 10px;
    border-radius: var(--border-radius-full);
    flex-shrink: 0;
  `,
  consoleLabel: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  `,
  consoleName: css`
    font-size: var(--font-size-lg);
    font-weight: 800;
    color: var(--text-primary);
  `,
  consolePath: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--font-family-mono);
    @media (max-width: 768px) { display: none; }
  `,
  spacePill: css`
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px 2px 6px;
    border-radius: var(--border-radius-full);
    border: 1px solid;
    background: rgba(0, 0, 0, 0.25);
    margin-left: 4px;
  `,
  spacePillIcon: css`
    width: 11px;
    height: 11px;
    flex-shrink: 0;
  `,
  spacePillName: css`
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  `,
  consoleBackBtn: css`
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    padding: 6px 12px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    &:hover { background: var(--bg-hover); color: var(--text-primary); }
  `,
  consoleSplit: css`
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  `,
  consoleSplitLeft: css`
    width: 62%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #070d14;
  `,
  consoleSplitRight: css`
    width: 38%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid var(--border-color);
    background: var(--bg-primary);
  `,
  rightTabBar: css`
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    padding: 0 4px;
    flex-shrink: 0;
  `,
  rightTab: css`
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-tertiary);
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
    margin-bottom: -1px;
    &:hover { color: var(--text-primary); }
  `,
  rightTabActive: css`
    color: #FF9D00 !important;
    border-bottom-color: #FF9D00;
  `,
  rightTabIcon: css`
    width: 12px;
    height: 12px;
  `,
  tabRunningDot: css`
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #ff9d00;
    margin-left: 4px;
    flex-shrink: 0;
    animation: tabDotPulse 1.5s ease-in-out infinite;
    @keyframes tabDotPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  `,
  rightPanelContent: css`
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,

  /* ─── Grid view ─── */
  root: css`
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-xl);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xl);
    background: var(--bg-tertiary);
  `,
  topHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  topTitle: css`
    font-size: var(--font-size-3xl);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.02em;
  `,
  topSubtitle: css`
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
    margin-top: 2px;
  `,
  createBtn: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    background: var(--color-primary);
    color: var(--text-inverse);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    border: none;
    cursor: pointer;
    transition: filter 0.2s ease;
    box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.25);
    &:hover { filter: brightness(1.12); }
  `,

  /* ─── Empty state ─── */
  emptyState: css`
    padding: var(--spacing-2xl);
    text-align: center;
    border: 1px dashed var(--border-color);
    border-radius: var(--border-radius-lg);
    background: var(--bg-secondary);
  `,
  emptyText: css`
    color: var(--text-tertiary);
    margin-bottom: var(--spacing-md);
  `,
  emptyBtn: css`
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-sm);
    background: var(--color-primary);
    color: var(--text-inverse);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    border: none;
    cursor: pointer;
    &:hover { filter: brightness(1.12); }
  `,

  /* ─── Cards grid ─── */
  cardsGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--spacing-lg);
    align-content: start;
  `,
  card: css`
    position: relative;
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--border-color);
    padding: var(--spacing-lg);
    padding-left: calc(var(--spacing-lg) + 6px);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    transition: border-color 0.2s, box-shadow 0.2s;
    &:hover {
      border-color: var(--border-color-hover);
      box-shadow: var(--shadow-md);
    }
  `,
  cardActive: css`
    border-color: rgba(var(--color-primary-rgb), 0.35);
    box-shadow: 0 0 0 1px rgba(var(--color-primary-rgb), 0.1), var(--shadow-sm);
  `,
  colorStrip: css`
    position: absolute;
    left: 0;
    top: var(--spacing-lg);
    bottom: var(--spacing-lg);
    width: 3px;
    border-radius: 0 4px 4px 0;
  `,
  cardMeta: css`
    min-width: 0;
  `,
  cardName: css`
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    font-size: var(--font-size-xl);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  cardPath: css`
    font-size: 10px;
    font-family: var(--font-family-mono);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 2px;
  `,
  cardDesc: css`
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: 4px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  `,
  cardSpaceBadge: css`
    display: inline-flex;
    align-items: center;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    padding: 2px 8px;
    margin-top: 6px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
  `,

  /* ─── Task block ─── */
  taskBlock: css`
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-sm);
    padding: 10px 12px;
    border: 1px solid var(--border-color);
  `,
  taskLabel: css`
    font-size: 10px;
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  `,
  taskEditRow: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  `,
  taskInput: css`
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color-hover);
    border-radius: var(--border-radius-sm);
    padding: 4px 8px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;
    &:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.15);
    }
  `,
  taskSaveBtn: css`
    font-size: var(--font-size-xs);
    background: var(--color-primary);
    padding: 4px 10px;
    border-radius: var(--border-radius-sm);
    color: var(--text-inverse);
    font-weight: var(--font-weight-semibold);
    border: none;
    cursor: pointer;
    white-space: nowrap;
    &:hover { filter: brightness(1.12); }
  `,
  taskDisplay: css`
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    &:hover { color: var(--text-primary); }
  `,
  taskEditIcon: css`
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    color: var(--text-tertiary);
    opacity: 0.45;
  `,

  /* ─── Card footer ─── */
  cardFooter: css`
    display: flex;
    border-top: 1px solid var(--border-color);
    padding-top: var(--spacing-md);
    margin-top: auto;
  `,
  openConsoleBtn: css`
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(var(--color-primary-rgb), 0.1);
    color: var(--color-primary);
    border: 1px solid rgba(var(--color-primary-rgb), 0.25);
    padding: 6px 14px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    transition: background 0.15s;
    &:hover { background: rgba(var(--color-primary-rgb), 0.2); }
  `,
  switchBtn: css`
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 14px;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    border: 1px solid var(--border-color);
    background: transparent;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
    &:hover {
      border-color: var(--border-color-hover);
      color: var(--text-primary);
      background: var(--bg-hover);
    }
  `,

  /* ─── Dialog ─── */
  dialogOverlay: css`
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-md);
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.15s ease;
    @keyframes fadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
  `,
  dialogBox: css`
    width: 100%;
    max-width: 448px;
    border-radius: var(--border-radius-lg);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-lg);
    padding: var(--spacing-lg);
    animation: slideUp 0.2s ease;
    @keyframes slideUp {
      from { transform: translateY(12px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
  `,
  dialogTitle: css`
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    margin-bottom: var(--spacing-md);
  `,
  dialogForm: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  `,
  dialogLabel: css`
    display: block;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
    margin-bottom: 4px;
  `,
  dialogInput: css`
    width: 100%;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;
    font-family: var(--font-family);
    &:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.15);
    }
    &::placeholder { color: var(--text-tertiary); }
  `,
  colorPicker: css`
    width: 100%;
    height: 36px;
    background: transparent;
    border: none;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
  `,
  dialogActions: css`
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: var(--spacing-sm);
  `,
  dialogCancelBtn: css`
    background: transparent;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    border: 1px solid var(--border-color);
    padding: 8px var(--spacing-md);
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    &:hover { color: var(--text-primary); border-color: var(--border-color-hover); }
  `,
  dialogSubmitBtn: css`
    background: var(--color-primary);
    color: var(--text-inverse);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    padding: 8px var(--spacing-md);
    border-radius: var(--border-radius-sm);
    border: none;
    cursor: pointer;
    transition: filter 0.15s ease;
    &:hover { filter: brightness(1.12); }
  `,

  /* ─── Shared icons ─── */
  iconSm: css`
    width: 16px;
    height: 16px;
  `,
  iconXs: css`
    width: 14px;
    height: 14px;
  `,
};
