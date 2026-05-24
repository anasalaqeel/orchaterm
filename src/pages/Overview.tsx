import React, { useState, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { useDashboard } from '../context/DashboardContext';
import { TaskLog } from '../types';
import { TerminalContainer } from '../components/terminal/TerminalContainer';
import { WorkspacePanel } from '../components/ui/WorkspacePanel';
import { 
  Play, 
  AlertOctagon, 
  Clock, 
  CheckCircle, 
  User, 
  Plus, 
  ChevronRight, 
  Copy, 
  Edit2,
  ArrowLeft
} from 'lucide-react';

export const DashboardView: React.FC = () => {
  const {
    workspaces,
    agents,
    taskLogs,
    savedPrompts,
    activeWorkspaceId,
    setActiveWorkspaceId,
    updateWorkspace,
    addTaskLog,
    launchAgent,
    copyPromptToClipboard,
    showToast,
    addWorkspace,
    viewMode,
    setViewMode
  } = useDashboard();

  // Dialog state for adding workspace directly on Dashboard
  const [showAddProj, setShowAddProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjPath, setNewProjPath] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjColor, setNewProjColor] = useState('#3b82f6');
  const [newProjAgent, setNewProjAgent] = useState('');

  // Inline edit state for workspace task
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskValue, setEditTaskValue] = useState('');

  // Agent dropdown selection state per workspace
  const [activeDropdownProjId, setActiveDropdownProjId] = useState<string | null>(null);

  // Quick log add state
  const [logSummary, setLogSummary] = useState('');
  const [logStatus, setLogStatus] = useState<'in-progress' | 'done' | 'blocked'>('in-progress');


  const activeProject = workspaces.find(p => p.id === activeWorkspaceId) || workspaces[0];

  // Stats calculations
  const totalProjects = workspaces.length;
  const activeProjectsCount = workspaces.filter(p => p.status === 'active').length;
  const pausedProjectsCount = workspaces.filter(p => p.status === 'paused' || p.status === 'idle').length;
  const blockedLogsCount = taskLogs.filter(l => l.status === 'blocked').length;

  const handleTaskSave = (projId: string) => {
    updateWorkspace(projId, { currentTask: editTaskValue });
    setEditingTaskId(null);
    showToast('Workspace task updated', 'success');
  };

  const handleAgentAssign = (projId: string, agentId: string | null) => {
    updateWorkspace(projId, { agentId });
    setActiveDropdownProjId(null);
    showToast('Agent assigned to workspace', 'success');
  };

  // Close the agent-assignment dropdown when clicking outside it.
  useEffect(() => {
    if (!activeDropdownProjId) return;
    const close = () => setActiveDropdownProjId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [activeDropdownProjId]);

  const handleAddProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) {
      showToast('Workspace name is required', 'error');
      return;
    }
    if (!newProjPath.trim()) {
      showToast('Workspace path is required', 'error');
      return;
    }
    addWorkspace({
      name: newProjName,
      path: newProjPath,
      description: newProjDesc,
      color: newProjColor,
      status: 'active',
      currentTask: 'Initial planning and environment setup',
      agentId: newProjAgent || null,
    });
    setNewProjName('');
    setNewProjPath('');
    setNewProjDesc('');
    setNewProjColor('#3b82f6');
    setNewProjAgent('');
    setShowAddProj(false);
  };

  const handleQuickLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject) {
      showToast('No active workspace to add logs to', 'error');
      return;
    }
    if (!logSummary.trim()) {
      showToast('Log summary cannot be empty', 'error');
      return;
    }

    addTaskLog({
      workspaceId: activeProject.id,
      agentId: activeProject.agentId || '',
      summary: logSummary,
      status: logStatus,
    });

    setLogSummary('');
    setLogStatus('in-progress');
  };

  // Find last log for a workspace
  const getLastLog = (projId: string): TaskLog | undefined => {
    return taskLogs.find(log => log.workspaceId === projId);
  };

  // Find last used prompt for active workspace
  const getActiveProjLastPrompt = () => {
    if (!activeProject) return null;
    const activePrompts = savedPrompts.filter(p => p.workspaceId === activeProject.id);
    if (activePrompts.length === 0) return null;
    
    // sort by usedAt or createdAt desc
    return activePrompts.sort((a, b) => {
      const timeA = a.usedAt ? new Date(a.usedAt).getTime() : new Date(a.createdAt).getTime();
      const timeB = b.usedAt ? new Date(b.usedAt).getTime() : new Date(b.createdAt).getTime();
      return timeB - timeA;
    })[0];
  };

  const lastPrompt = getActiveProjLastPrompt();

  if (viewMode === 'console' && activeProject) {
    return (
      <div className={s.consoleRoot}>
        {/* Top Header Panel */}
        <div className={s.consoleHeader}>
          <div className={s.consoleHeaderLeft}>
            <span
              className={s.consolePulse}
              style={{ backgroundColor: activeProject.color || '#FF9D00' }}
            />
            <span className={s.consoleLabel}>Active Workspace:</span>
            <h2 className={s.consoleName}>{activeProject.name}</h2>
            <span className={s.consolePath}>({activeProject.path})</span>
          </div>

          <button
            onClick={() => setViewMode('grid')}
            className={s.consoleBackBtn}
          >
            <ArrowLeft className={s.iconSm} style={{ color: '#FF9D00' }} />
            <span>Workspaces List</span>
          </button>
        </div>

        {/* Horizontal Split Area: Left 60% Terminals, Right 40% WorkspacePanel */}
        <div className={s.consoleSplit}>
          {/* Left: Terminals */}
          <div className={s.consoleSplitLeft}>
            <TerminalContainer workspaceId={activeProject.id} workspacePath={activeProject.path} />
          </div>

          {/* Right: Workspace context panel */}
          <div className={s.consoleSplitRight}>
            <WorkspacePanel workspace={activeProject} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.root}>
      {/* Main Content Area */}
      <div className={s.mainContent}>
        
        {/* Top Header */}
        <div className={s.topHeader}>
          <div>
            <h2 className={s.topTitle}>System Overview</h2>
            <p className={s.topSubtitle}>Monitor active processes, agents, and handoffs.</p>
          </div>
          <button
            onClick={() => setShowAddProj(true)}
            className={s.createBtn}
          >
            <Plus className={s.iconSm} />
            <span>Create Workspace</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className={s.statsGrid}>
          <div className={cx(s.statCard, s.statCardBlue)}>
            <span className={s.statLabel}>Total Workspaces</span>
            <div className={s.statValue}>{totalProjects}</div>
            <div className={s.statHint}>Workspace count</div>
          </div>
          <div className={cx(s.statCard, s.statCardGreen)}>
            <span className={s.statLabel}>Active Run</span>
            <div className={cx(s.statValue, s.statValueGreen)}>{activeProjectsCount}</div>
            <div className={s.statHint}>Currently processing</div>
          </div>
          <div className={s.statCard}>
            <span className={s.statLabel}>Idle / Paused</span>
            <div className={cx(s.statValue, s.statValueAmber)}>{pausedProjectsCount}</div>
            <div className={s.statHint}>Awaiting input</div>
          </div>
          <div className={cx(s.statCard, s.statCardRed)}>
            <span className={s.statLabel}>Blocked Issues</span>
            <div className={cx(s.statValue, s.statValueRose)}>{blockedLogsCount}</div>
            <div className={s.statHint}>Logs flagged blocked</div>
          </div>
        </div>

        {/* Workspaces Cards Grid */}
        <div className={s.sectionBlock}>
          <h3 className={s.sectionTitle}>Project Workspaces</h3>
          {workspaces.length === 0 ? (
            <div className={s.emptyState}>
              <p className={s.emptyText}>No workspaces added yet. Create one to get started.</p>
              <button
                onClick={() => setShowAddProj(true)}
                className={s.emptyBtn}
              >
                <Plus className={s.iconSm} />
                <span>Add Your First Workspace</span>
              </button>
            </div>
          ) : (
            <div className={s.cardsGrid}>
              {workspaces.map((proj) => {
                const isCurrentActive = proj.id === activeProject?.id;
                const assignedAgent = agents.find(a => a.id === proj.agentId);
                const lastLog = getLastLog(proj.id);

                return (
                  <div
                    key={proj.id}
                    className={cx(
                      s.card,
                      isCurrentActive ? s.cardActive : s.cardInactive
                    )}
                  >
                    {/* Color Left Tag Strip */}
                    <div
                      className={s.colorStrip}
                      style={{ backgroundColor: proj.color || '#3b82f6' }}
                    />

                    <div>
                      {/* Title & Status Row */}
                      <div className={s.cardTitleRow}>
                        <div className={s.cardTitleLeft}>
                          <h4 className={s.cardName}>
                            {proj.name}
                          </h4>
                          <p className={s.cardPath}>{proj.path}</p>
                          <p className={s.cardDesc}>
                            {proj.description || 'No description provided.'}
                          </p>
                        </div>

                        <div className={s.cardBadgeArea}>
                          {/* Status Badge */}
                          <span className={cx(
                            s.statusBadge,
                            proj.status === 'active'
                              ? s.statusActive
                              : proj.status === 'paused'
                              ? s.statusPaused
                              : s.statusIdle
                          )}>
                            <span className={cx(
                              s.statusDot,
                              proj.status === 'active'
                                ? s.dotActive
                                : proj.status === 'paused'
                                ? s.dotPaused
                                : s.dotIdle
                            )} />
                            {proj.status}
                          </span>
                        </div>
                      </div>

                      {/* Inline Editable Task */}
                      <div className={s.taskBlock}>
                        <div className={s.taskLabel}>
                          Current Action Item
                        </div>
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
                            <button
                              onClick={() => handleTaskSave(proj.id)}
                              className={s.taskSaveBtn}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <div
                            onClick={() => {
                              setEditingTaskId(proj.id);
                              setEditTaskValue(proj.currentTask || '');
                            }}
                            className={s.taskDisplay}
                          >
                            <span>{proj.currentTask || 'Click to edit task...'}</span>
                            <Edit2 className={s.taskEditIcon} />
                          </div>
                        )}
                      </div>

                      {/* Last Handoff / Log Entry Preview */}
                      <div className={s.handoffBlock}>
                        <span className={s.handoffLabel}>
                          Last Handoff
                        </span>
                        {lastLog ? (
                          <div className={s.handoffRow}>
                            {lastLog.status === 'done' ? (
                              <CheckCircle className={s.handoffIconGreen} />
                            ) : lastLog.status === 'blocked' ? (
                              <AlertOctagon className={s.handoffIconRed} />
                            ) : (
                              <Clock className={s.handoffIconBlue} />
                            )}
                            <p className={s.handoffText}>
                              "{lastLog.summary}"
                            </p>
                          </div>
                        ) : (
                          <p className={s.handoffEmpty}>No handoff recorded yet.</p>
                        )}
                      </div>
                    </div>

                    {/* Footer Row: Agent Chip and Switch Button */}
                    <div className={s.cardFooter}>
                      {/* Clickable Assigned Agent Chip */}
                      <div className={s.agentChipWrapper} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setActiveDropdownProjId(activeDropdownProjId === proj.id ? null : proj.id)}
                          className={s.agentChip}
                          style={assignedAgent ? { borderLeft: `3px solid ${assignedAgent.color || '#3b82f6'}` } : {}}
                        >
                          <User className={s.agentChipIcon} />
                          <span>{assignedAgent ? assignedAgent.name : 'Unassigned'}</span>
                        </button>

                        {/* Dropdown overlay */}
                        {activeDropdownProjId === proj.id && (
                          <div className={s.dropdown}>
                            <div className={s.dropdownTitle}>
                              Assign Agent
                            </div>
                            {agents.map((agent) => (
                              <button
                                key={agent.id}
                                onClick={() => handleAgentAssign(proj.id, agent.id)}
                                className={s.dropdownItem}
                              >
                                <span className={s.dropdownDot} style={{ backgroundColor: agent.color }} />
                                <span>{agent.name}</span>
                              </button>
                            ))}
                            {proj.agentId && (
                              <button
                                onClick={() => handleAgentAssign(proj.id, null)}
                                className={s.dropdownItemDanger}
                              >
                                <span className={cx(s.dropdownDot, s.dotDanger)} />
                                <span>Unassign</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Switch To / Active Button */}
                      {isCurrentActive ? (
                        <button
                          onClick={() => setViewMode('console')}
                          className={s.openConsoleBtn}
                        >
                          <span>Open Console</span>
                          <ChevronRight className={s.iconXs} />
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setActiveWorkspaceId(proj.id);
                            setViewMode('console');
                            showToast(`Context switched: ${proj.name}`, 'info');
                          }}
                          className={s.switchBtn}
                        >
                          <span>Switch to</span>
                          <ChevronRight className={s.iconXs} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>


      </div>

      {/* Active Context Sidebar (Right Panel) */}
      <div className={s.sidebar}>
        {activeProject ? (
          <div className={s.sidebarInner}>
            {/* Active Details */}
            <div className={s.sidebarDetails}>
              <div>
                <span className={s.sidebarTargetLabel}>
                  Target Workspace
                </span>
                <h3 className={s.sidebarName}>
                  {activeProject.name}
                </h3>
                <p className={s.sidebarPath}>{activeProject.path}</p>
                <p className={s.sidebarDesc}>
                  {activeProject.description || 'No description provided for this workspace.'}
                </p>
              </div>

              {/* Assigned Agent Details & Launch */}
              <div className={s.sidebarPanel}>
                <span className={s.sidebarPanelLabel}>
                  Assigned Orchestrator
                </span>
                {(() => {
                  const agent = agents.find(a => a.id === activeProject.agentId);
                  if (!agent) {
                    return (
                      <div>
                        <p className={s.sidebarEmptyText}>No agent assigned yet.</p>
                        <p className={s.sidebarEmptyHint}>Assign an agent from Settings or Workspace card chip to enable launches.</p>
                      </div>
                    );
                  }

                  return (
                    <div className={s.agentDetailBlock}>
                      <div className={s.agentDetailRow}>
                        <div className={s.agentDetailName}>
                          <span className={s.agentDot} style={{ backgroundColor: agent.color }} />
                          <span className={s.agentNameText}>{agent.name}</span>
                        </div>
                        <span className={s.agentTypeLabel}>
                          {agent.type}
                        </span>
                      </div>
                      <p className={s.agentDesc}>
                        {agent.bestUsedFor}
                      </p>
                      <button
                        onClick={() => launchAgent(agent.id)}
                        className={s.launchBtn}
                      >
                        <Play className={s.launchIcon} />
                        <span>Launch {agent.name}</span>
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Last Used Prompt Preview */}
              <div className={s.sidebarPanel}>
                <span className={s.sidebarPanelLabel}>
                  Last Used Prompt
                </span>
                {lastPrompt ? (
                  <div className={s.promptBlock}>
                    <div className={s.promptHeader}>
                      <span className={s.promptTitle}>
                        {lastPrompt.title}
                      </span>
                      <button
                        onClick={() => copyPromptToClipboard(lastPrompt.id)}
                        className={s.copyBtn}
                        title="Copy to Clipboard"
                      >
                        <Copy className={s.iconXs} />
                        <span>Copy</span>
                      </button>
                    </div>
                    <div className={s.promptPreview}>
                      {lastPrompt.content}
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className={s.sidebarEmptyText}>No prompt available.</p>
                    <p className={s.sidebarEmptyHint}>Go to Prompt Vault to save a prompt for this workspace.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Handoff Log Add Form */}
            <div className={s.quickLogSection}>
              <span className={s.quickLogLabel}>
                Log Quick-Add
              </span>
              <form onSubmit={handleQuickLogSubmit} className={s.quickLogForm}>
                <div>
                  <textarea
                    placeholder="Describe task progress or handoff notes..."
                    value={logSummary}
                    onChange={(e) => setLogSummary(e.target.value)}
                    rows={3}
                    className={s.quickLogTextarea}
                  />
                </div>
                
                <div className={s.quickLogRow}>
                  <select
                    value={logStatus}
                    onChange={(e) => setLogStatus(e.target.value as 'in-progress' | 'done' | 'blocked')}
                    className={s.quickLogSelect}
                  >
                    <option value="in-progress">In Progress</option>
                    <option value="done">Completed</option>
                    <option value="blocked">Blocked</option>
                  </select>

                  <button
                    type="submit"
                    className={s.quickLogSubmitBtn}
                  >
                    Add Log Entry
                  </button>
                </div>
              </form>
            </div>

          </div>
        ) : (
          <div className={s.sidebarEmpty}>
            <div>
              <p className={s.sidebarEmptyMainText}>No workspace selected.</p>
              <p className={s.sidebarEmptySubText}>Create or select a workspace to inspect active context.</p>
            </div>
          </div>
        )}
      </div>

      {/* CREATE WORKSPACE DIALOG OVERLAY */}
      {showAddProj && (
        <div className={s.dialogOverlay}>
          <div className={s.dialogBox}>
            <h3 className={s.dialogTitle}>New Workspace</h3>
            <form onSubmit={handleAddProjectSubmit} className={s.dialogForm}>
              <div>
                <label className={s.dialogLabel}>Workspace Name</label>
                <input
                  type="text"
                  placeholder="e.g. Factinme, Bulkin"
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
                  placeholder="e.g. C:\Users\anasa\Desktop\agentdeck"
                  value={newProjPath}
                  onChange={(e) => setNewProjPath(e.target.value)}
                  className={s.dialogInput}
                  required
                />
              </div>

              <div>
                <label className={s.dialogLabel}>Description</label>
                <textarea
                  placeholder="Brief summary of workspace goals..."
                  value={newProjDesc}
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  rows={2}
                  className={s.dialogInput}
                />
              </div>

              <div className={s.dialogGrid2}>
                <div>
                  <label className={s.dialogLabel}>Color Accent</label>
                  <input
                    type="color"
                    value={newProjColor}
                    onChange={(e) => setNewProjColor(e.target.value)}
                    className={s.colorPicker}
                  />
                </div>

                <div>
                  <label className={s.dialogLabel}>Assign Agent</label>
                  <select
                    value={newProjAgent}
                    onChange={(e) => setNewProjAgent(e.target.value)}
                    className={s.dialogSelect}
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={s.dialogActions}>
                <button
                  type="button"
                  onClick={() => setShowAddProj(false)}
                  className={s.dialogCancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={s.dialogSubmitBtn}
                >
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

/* ── Emotion Styles ─────────────────────────────────────────────────────── */

const s = {
  /* ─── Console (full-screen terminal) mode ─── */
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
  consolePulse: css`
    width: 12px;
    height: 12px;
    border-radius: var(--border-radius-full);
    animation: pulse 2s infinite;
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
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
    @media (max-width: 768px) {
      display: none;
    }
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
    transition: all 0.15s ease;
    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  consoleSplit: css`
    flex: 1;
    display: flex;
    min-height: 0;
    width: 100%;
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

  /* ─── Grid / Overview mode ─── */
  root: css`
    display: flex;
    flex: 1;
    height: 100vh;
    overflow: hidden;
  `,
  mainContent: css`
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-xl);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xl);
    background: var(--bg-tertiary);
  `,

  /* ─── Top Header ─── */
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
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.25);
    &:hover {
      filter: brightness(1.15);
      transform: scale(1.02);
    }
  `,

  /* ─── Stats Grid ─── */
  statsGrid: css`
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--spacing-md);
    @media (max-width: 900px) {
      grid-template-columns: repeat(2, 1fr);
    }
    @media (max-width: 600px) {
      grid-template-columns: 1fr;
    }
  `,
  statCard: css`
    padding: 20px;
    border-radius: var(--border-radius-lg);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    transition: border-color 0.2s;
  `,
  statCardBlue: css`
    box-shadow: 0 0 20px rgba(var(--color-info-rgb), 0.06);
  `,
  statCardGreen: css`
    box-shadow: 0 0 20px rgba(var(--color-success-rgb), 0.06);
  `,
  statCardRed: css`
    box-shadow: 0 0 20px rgba(var(--color-error-rgb), 0.06);
  `,
  statLabel: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,
  statValue: css`
    font-size: var(--font-size-4xl);
    font-weight: var(--font-weight-bold);
    margin-top: 4px;
    color: var(--text-primary);
  `,
  statValueGreen: css`
    color: var(--color-success);
  `,
  statValueAmber: css`
    color: var(--color-warning);
  `,
  statValueRose: css`
    color: var(--color-error);
  `,
  statHint: css`
    font-size: 10px;
    color: var(--text-tertiary);
    margin-top: 6px;
    font-weight: var(--font-weight-medium);
  `,

  /* ─── Section Block ─── */
  sectionBlock: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  `,
  sectionTitle: css`
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-size-xl);
  `,

  /* ─── Empty State ─── */
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
    transition: all 0.2s ease;
    &:hover {
      filter: brightness(1.15);
    }
  `,

  /* ─── Cards Grid ─── */
  cardsGrid: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-lg);
    @media (max-width: 1200px) {
      grid-template-columns: 1fr;
    }
  `,
  card: css`
    position: relative;
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--border-color);
    padding: var(--spacing-lg);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    transition: all 0.2s ease;
    &:hover {
      border-color: var(--border-color-hover);
      box-shadow: var(--shadow-md);
    }
  `,
  cardActive: css`
    border-color: rgba(var(--color-primary-rgb), 0.4);
    background: var(--bg-secondary);
    box-shadow: 0 0 24px rgba(var(--color-primary-rgb), 0.06);
  `,
  cardInactive: css`
    background: var(--bg-secondary);
  `,
  colorStrip: css`
    position: absolute;
    left: 0;
    top: var(--spacing-lg);
    bottom: var(--spacing-lg);
    width: 3px;
    border-radius: 0 4px 4px 0;
  `,

  /* ─── Card Title Row ─── */
  cardTitleRow: css`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--spacing-md);
    margin-bottom: 12px;
  `,
  cardTitleLeft: css`
    min-width: 0;
  `,
  cardName: css`
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    font-size: var(--font-size-xl);
    line-height: 1.3;
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
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
  `,

  /* ─── Status Badge ─── */
  cardBadgeArea: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-shrink: 0;
  `,
  statusBadge: css`
    font-size: 10px;
    padding: 2px 8px;
    border-radius: var(--border-radius-full);
    font-weight: var(--font-weight-bold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid transparent;
  `,
  statusActive: css`
    background: rgba(var(--color-success-rgb), 0.1);
    color: var(--color-success);
    border-color: rgba(var(--color-success-rgb), 0.2);
  `,
  statusPaused: css`
    background: rgba(var(--color-warning-rgb), 0.1);
    color: var(--color-warning);
    border-color: rgba(var(--color-warning-rgb), 0.2);
  `,
  statusIdle: css`
    background: rgba(128, 128, 128, 0.1);
    color: var(--text-tertiary);
    border-color: rgba(128, 128, 128, 0.2);
  `,
  statusDot: css`
    width: 6px;
    height: 6px;
    border-radius: var(--border-radius-full);
  `,
  dotActive: css`
    background: var(--color-success);
  `,
  dotPaused: css`
    background: var(--color-warning);
  `,
  dotIdle: css`
    background: var(--text-tertiary);
  `,

  /* ─── Inline Editable Task ─── */
  taskBlock: css`
    margin-bottom: var(--spacing-md);
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-sm);
    padding: 12px;
    border: 1px solid var(--border-color);
    position: relative;
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
    width: 100%;
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
    padding: 4px 8px;
    border-radius: var(--border-radius-sm);
    color: var(--text-inverse);
    font-weight: var(--font-weight-semibold);
    border: none;
    cursor: pointer;
    white-space: nowrap;
    &:hover {
      filter: brightness(1.15);
    }
  `,
  taskDisplay: css`
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: color 0.15s ease;
    &:hover {
      color: var(--text-primary);
    }
  `,
  taskEditIcon: css`
    width: 14px;
    height: 14px;
    opacity: 0;
    transition: opacity 0.15s ease;
    margin-left: 8px;
    flex-shrink: 0;
    color: var(--text-tertiary);
    /* show on parent hover */
    *:hover > & {
      opacity: 0.6;
    }
  `,

  /* ─── Last Handoff ─── */
  handoffBlock: css`
    font-size: var(--font-size-xs);
    margin-bottom: 20px;
  `,
  handoffLabel: css`
    font-size: 10px;
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: block;
    margin-bottom: 4px;
  `,
  handoffRow: css`
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-sm);
    color: var(--text-secondary);
  `,
  handoffIconGreen: css`
    width: 14px;
    height: 14px;
    color: var(--color-success);
    margin-top: 2px;
    flex-shrink: 0;
  `,
  handoffIconRed: css`
    width: 14px;
    height: 14px;
    color: var(--color-error);
    margin-top: 2px;
    flex-shrink: 0;
  `,
  handoffIconBlue: css`
    width: 14px;
    height: 14px;
    color: rgb(var(--color-info-rgb));
    margin-top: 2px;
    flex-shrink: 0;
  `,
  handoffText: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    font-style: italic;
    color: var(--text-secondary);
  `,
  handoffEmpty: css`
    color: var(--text-tertiary);
    font-style: italic;
  `,

  /* ─── Card Footer ─── */
  cardFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--border-color);
    padding-top: var(--spacing-md);
    margin-top: var(--spacing-sm);
  `,
  agentChipWrapper: css`
    position: relative;
  `,
  agentChip: css`
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: var(--border-radius-full);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    border: 1px solid var(--border-color);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
      border-color: var(--border-color-hover);
    }
  `,
  agentChipIcon: css`
    width: 12px;
    height: 12px;
    color: var(--text-tertiary);
  `,

  /* ─── Dropdown ─── */
  dropdown: css`
    position: absolute;
    left: 0;
    bottom: 32px;
    z-index: 20;
    width: 192px;
    border-radius: var(--border-radius-sm);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-lg);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  dropdownTitle: css`
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    font-weight: var(--font-weight-semibold);
    padding: 4px;
  `,
  dropdownItem: css`
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    transition: all 0.1s ease;
    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  dropdownItemDanger: css`
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    color: var(--color-error);
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    transition: all 0.1s ease;
    &:hover {
      background: rgba(var(--color-error-rgb), 0.08);
    }
  `,
  dropdownDot: css`
    width: 8px;
    height: 8px;
    border-radius: var(--border-radius-full);
  `,
  dotDanger: css`
    background: var(--color-error);
  `,

  /* ─── Console / Switch Buttons ─── */
  openConsoleBtn: css`
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(var(--color-primary-rgb), 0.1);
    color: var(--color-primary);
    border: 1px solid rgba(var(--color-primary-rgb), 0.2);
    padding: 6px 12px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    transition: all 0.15s ease;
    animation: pulse 2s infinite;
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    &:hover {
      background: rgba(var(--color-primary-rgb), 0.2);
    }
  `,
  switchBtn: css`
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    border: 1px solid var(--border-color);
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
      border-color: var(--border-color-hover);
      color: var(--text-primary);
      background: var(--bg-hover);
    }
  `,

  /* ─── Right Sidebar ─── */
  sidebar: css`
    width: 384px;
    border-left: 1px solid var(--border-color);
    background: var(--bg-secondary);
    backdrop-filter: blur(16px);
    padding: var(--spacing-lg);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow-y: auto;
    flex-shrink: 0;
  `,
  sidebarInner: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
    flex: 1;
    justify-content: space-between;
  `,
  sidebarDetails: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-lg);
  `,
  sidebarTargetLabel: css`
    font-size: 10px;
    font-weight: var(--font-weight-bold);
    color: var(--color-primary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    display: block;
    margin-bottom: 4px;
  `,
  sidebarName: css`
    font-size: var(--font-size-2xl);
    font-weight: 800;
    color: var(--text-primary);
    line-height: 1.3;
  `,
  sidebarPath: css`
    font-size: 11px;
    font-family: var(--font-family-mono);
    color: var(--text-tertiary);
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  sidebarDesc: css`
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin-top: 8px;
    line-height: 1.6;
  `,

  /* ─── Sidebar Panels ─── */
  sidebarPanel: css`
    padding: var(--spacing-md);
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--border-color);
    background: var(--bg-tertiary);
  `,
  sidebarPanelLabel: css`
    font-size: 10px;
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: block;
    margin-bottom: 8px;
  `,
  sidebarEmptyText: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-style: italic;
  `,
  sidebarEmptyHint: css`
    font-size: 10px;
    color: var(--text-tertiary);
    margin-top: 4px;
  `,

  /* ─── Agent Detail ─── */
  agentDetailBlock: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  agentDetailRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  agentDetailName: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  `,
  agentDot: css`
    width: 12px;
    height: 12px;
    border-radius: var(--border-radius-full);
  `,
  agentNameText: css`
    font-weight: var(--font-weight-bold);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  `,
  agentTypeLabel: css`
    font-size: 9px;
    text-transform: uppercase;
    font-weight: var(--font-weight-bold);
    color: var(--text-tertiary);
    letter-spacing: 0.06em;
  `,
  agentDesc: css`
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.6;
  `,
  launchBtn: css`
    width: 100%;
    margin-top: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    background: var(--bg-hover);
    color: var(--text-primary);
    padding: 8px 12px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
      background: var(--bg-active);
      border-color: var(--border-color-hover);
    }
  `,
  launchIcon: css`
    width: 12px;
    height: 12px;
    color: var(--color-success);
  `,

  /* ─── Prompt Block ─── */
  promptBlock: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
  `,
  promptHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  promptTitle: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 180px;
  `,
  copyBtn: css`
    font-size: 10px;
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--color-primary);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    transition: color 0.15s ease;
    &:hover {
      filter: brightness(1.2);
    }
  `,
  promptPreview: css`
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px;
    max-height: 80px;
    overflow-y: auto;
    font-size: 10px;
    font-family: var(--font-family-mono);
    color: var(--text-secondary);
  `,

  /* ─── Quick Log Section ─── */
  quickLogSection: css`
    margin-top: var(--spacing-xl);
    border-top: 1px solid var(--border-color);
    padding-top: var(--spacing-lg);
  `,
  quickLogLabel: css`
    font-size: 10px;
    font-weight: var(--font-weight-bold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: block;
    margin-bottom: 12px;
  `,
  quickLogForm: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  quickLogTextarea: css`
    width: 100%;
    font-size: var(--font-size-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 10px;
    color: var(--text-primary);
    resize: vertical;
    outline: none;
    font-family: var(--font-family);
    &::placeholder {
      color: var(--text-tertiary);
    }
    &:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.15);
    }
  `,
  quickLogRow: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    justify-content: space-between;
  `,
  quickLogSelect: css`
    font-size: var(--font-size-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 6px 10px;
    color: var(--text-secondary);
    outline: none;
    &:focus {
      border-color: var(--color-primary);
    }
  `,
  quickLogSubmitBtn: css`
    background: var(--color-primary);
    color: var(--text-inverse);
    font-weight: var(--font-weight-bold);
    font-size: var(--font-size-xs);
    padding: 6px 14px;
    border-radius: var(--border-radius-sm);
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
      filter: brightness(1.15);
    }
  `,

  /* ─── Sidebar Empty ─── */
  sidebarEmpty: css`
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--text-tertiary);
  `,
  sidebarEmptyMainText: css`
    font-size: var(--font-size-sm);
  `,
  sidebarEmptySubText: css`
    font-size: var(--font-size-xs);
    margin-top: 4px;
  `,

  /* ─── Dialog Overlay ─── */
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
      to { opacity: 1; }
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
      to { transform: translateY(0); opacity: 1; }
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
    &::placeholder {
      color: var(--text-tertiary);
    }
  `,
  dialogGrid2: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-md);
  `,
  colorPicker: css`
    width: 100%;
    height: 36px;
    background: transparent;
    border: none;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
  `,
  dialogSelect: css`
    width: 100%;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    outline: none;
    &:focus {
      border-color: var(--color-primary);
    }
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
    transition: all 0.15s ease;
    &:hover {
      color: var(--text-primary);
      border-color: var(--border-color-hover);
    }
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
    transition: all 0.15s ease;
    &:hover {
      filter: brightness(1.15);
    }
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
