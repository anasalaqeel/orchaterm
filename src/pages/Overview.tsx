import React, { useState, useEffect } from 'react';
import { css, cx } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { useDashboard } from '../context/DashboardContext';
import { TerminalContainer } from '../components/terminal/TerminalContainer';
import { WorkspacePanel } from '../components/ui/WorkspacePanel';
import { WorkspaceConductor } from '../components/conductor/WorkspaceConductor';
import { GroupChat } from '../components/ui/GroupChat';
import {
  Plus, ChevronRight, Edit2, ArrowLeft,
  Network, MessageSquare, Info, Terminal,
  FolderOpen,
} from 'lucide-react';

/* ── Animation variants ─────────────────────────────────────────────────────── */

const ease = [0.4, 0, 0.2, 1] as [number, number, number, number];

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease } },
  exit:    { opacity: 0, y: -6, transition: { duration: 0.18 } },
};

const gridVariants = {
  animate: { transition: { staggerChildren: 0.06 } },
};

const cardVariants = {
  initial: { opacity: 0, y: 20, scale: 0.97 },
  animate: {
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.28, ease },
  },
};

/* ── Component ──────────────────────────────────────────────────────────────── */

export const DashboardView: React.FC = () => {
  const {
    workspaces, spaces,
    activeWorkspaceId, setActiveWorkspaceId,
    activeSpaceId,
    updateWorkspace, showToast, addWorkspace,
    viewMode, setViewMode,
  } = useDashboard();

  const [showAddProj,   setShowAddProj]   = useState(false);
  const [newProjName,   setNewProjName]   = useState('');
  const [newProjPath,   setNewProjPath]   = useState('');
  const [newProjDesc,   setNewProjDesc]   = useState('');
  const [newProjColor,  setNewProjColor]  = useState('#7c3aed');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskValue, setEditTaskValue] = useState('');
  const [rightPanel,    setRightPanel]    = useState<'workspace' | 'conductor' | 'chat'>('workspace');

  useEffect(() => {
    if (localStorage.getItem('orchaterm:open-new-workspace') === '1') {
      localStorage.removeItem('orchaterm:open-new-workspace');
      setShowAddProj(true);
    }
  }, []);

  const activeProject = workspaces.find(p => p.id === activeWorkspaceId) || workspaces[0];

  const handleTaskSave = (projId: string) => {
    updateWorkspace(projId, { currentTask: editTaskValue });
    setEditingTaskId(null);
    showToast('Task updated', 'success');
  };

  const handleAddProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) { showToast('Name required', 'error'); return; }
    if (!newProjPath.trim()) { showToast('Path required', 'error'); return; }
    addWorkspace({
      name: newProjName, path: newProjPath, description: newProjDesc,
      color: newProjColor, status: 'active', currentTask: '',
    });
    setNewProjName(''); setNewProjPath(''); setNewProjDesc('');
    setNewProjColor('#7c3aed');
    setShowAddProj(false);
  };

  /* ── Console view ── */
  if (viewMode === 'console' && activeProject) {
    const activeSpace = activeSpaceId
      ? spaces.find(sp => sp.id === activeSpaceId && sp.workspaceId === activeProject.id)
      : null;
    const panelKey = `${activeProject.id}::${activeSpaceId ?? 'workspace'}`;

    return (
      <motion.div
        className={s.consoleRoot}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {/* Console header */}
        <div className={s.consoleHeader}>
          <div className={s.consoleHeaderLeft}>
            <span
              className={s.consoleDot}
              style={{ backgroundColor: activeProject.color }}
            />
            <h2 className={s.consoleName}>{activeProject.name}</h2>
            <span className={s.consolePath}>{activeProject.path}</span>

            <AnimatePresence>
              {activeSpace && (
                <motion.div
                  className={s.spacePill}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  style={{ borderColor: activeSpace.color + '40' }}
                >
                  <span className={s.spacePillDot} style={{ backgroundColor: activeSpace.color }} />
                  <span className={s.spacePillName} style={{ color: activeSpace.color }}>
                    {activeSpace.name}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.button
            whileHover={{ x: -2 }}
            onClick={() => setViewMode('grid')}
            className={s.backBtn}
          >
            <ArrowLeft size={13} />
            <span>Workspaces</span>
          </motion.button>
        </div>

        {/* Split */}
        <div className={s.consoleSplit}>
          <div className={s.consoleSplitLeft}>
            <TerminalContainer
              key={panelKey}
              scopeKey={panelKey}
              workspaceId={activeProject.id}
              workspacePath={activeProject.path}
            />
          </div>

          <div className={s.consoleSplitRight}>
            {/* Right panel tab bar */}
            <div className={s.rightTabBar}>
              {(['workspace', 'conductor', 'chat'] as const).map(tab => {
                const icons = { workspace: Info, conductor: Network, chat: MessageSquare };
                const labels = { workspace: 'Info', conductor: 'Conductor', chat: 'Chat' };
                const Icon = icons[tab];
                const isActive = rightPanel === tab;
                const hasRunning = tab === 'conductor' &&
                  localStorage.getItem(`orchaterm:conductor:running:${activeProject.id}`) === 'true';

                return (
                  <button
                    key={tab}
                    className={cx(s.rightTab, isActive && s.rightTabActive)}
                    onClick={() => setRightPanel(tab)}
                  >
                    <Icon size={12} />
                    {labels[tab]}
                    {hasRunning && <span className={s.runDot} />}
                    {isActive && (
                      <motion.span
                        layoutId="right-tab-indicator"
                        className={s.rightTabIndicator}
                        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className={s.rightPanelContent}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={rightPanel}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
                >
                  {rightPanel === 'workspace'  && <WorkspacePanel workspace={activeProject} />}
                  {rightPanel === 'conductor'  && <WorkspaceConductor key={panelKey} workspaceId={activeProject.id} />}
                  {rightPanel === 'chat'       && <GroupChat key={panelKey} workspaceId={activeProject.id} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  /* ── Grid view ── */
  return (
    <motion.div
      className={s.gridRoot}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* Header */}
      <div className={s.gridHeader}>
        <div>
          <h1 className={s.gridTitle}>Workspaces</h1>
          <p className={s.gridSubtitle}>
            {workspaces.length === 0
              ? 'Create a workspace to get started'
              : `${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowAddProj(true)}
          className={s.createBtn}
        >
          <Plus size={15} />
          <span>New Workspace</span>
        </motion.button>
      </div>

      {/* Empty state */}
      {workspaces.length === 0 ? (
        <motion.div
          className={s.emptyState}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <div className={s.emptyIcon}>
            <FolderOpen size={32} />
          </div>
          <p className={s.emptyTitle}>No workspaces yet</p>
          <p className={s.emptyText}>Add a project directory to start orchestrating agents</p>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setShowAddProj(true)}
            className={s.createBtn}
          >
            <Plus size={15} />
            <span>Add Your First Workspace</span>
          </motion.button>
        </motion.div>
      ) : (
        <motion.div
          className={s.cardsGrid}
          variants={gridVariants}
          initial="initial"
          animate="animate"
        >
          {workspaces.map((proj) => {
            const isActive   = proj.id === activeProject?.id;
            const spaceCount = spaces.filter(sp => sp.workspaceId === proj.id).length;

            return (
              <motion.div
                key={proj.id}
                variants={cardVariants}
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className={cx(s.card, isActive && s.cardActive)}
                style={{ '--card-color': proj.color } as React.CSSProperties}
              >
                {/* Color bar at top */}
                <div
                  className={s.cardBar}
                  style={{ background: `linear-gradient(90deg, ${proj.color}, ${proj.color}80)` }}
                />

                {/* Card header */}
                <div className={s.cardHeader}>
                  <div
                    className={s.cardAvatar}
                    style={{
                      backgroundColor: proj.color + '1a',
                      border: `1px solid ${proj.color}30`,
                    }}
                  >
                    <Terminal size={14} style={{ color: proj.color }} />
                  </div>
                  <div className={s.cardMeta}>
                    <h4 className={s.cardName}>{proj.name}</h4>
                    <p className={s.cardPath}>{proj.path}</p>
                  </div>
                </div>

                {/* Description */}
                {proj.description && (
                  <p className={s.cardDesc}>{proj.description}</p>
                )}

                {/* Badges row */}
                {spaceCount > 0 && (
                  <div className={s.cardBadges}>
                    <span className={s.spaceBadge}>
                      {spaceCount} space{spaceCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                {/* Task block */}
                <div className={s.taskBlock}>
                  {editingTaskId === proj.id ? (
                    <div className={s.taskEditRow}>
                      <input
                        type="text"
                        value={editTaskValue}
                        onChange={e => setEditTaskValue(e.target.value)}
                        onBlur={() => handleTaskSave(proj.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleTaskSave(proj.id);
                          if (e.key === 'Escape') setEditingTaskId(null);
                        }}
                        className={s.taskInput}
                        autoFocus
                        placeholder="What are you working on?"
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
                      <span className={cx(s.taskText, !proj.currentTask && s.taskPlaceholder)}>
                        {proj.currentTask || 'Set a focus…'}
                      </span>
                      <Edit2 size={11} className={s.taskEditIcon} />
                    </div>
                  )}
                </div>

                {/* Footer */}
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    if (!isActive) {
                      setActiveWorkspaceId(proj.id);
                      showToast(`Switched to ${proj.name}`, 'info');
                    }
                    setViewMode('console');
                  }}
                  className={isActive ? s.openBtnActive : s.openBtn}
                >
                  <span>Open Console</span>
                  <ChevronRight size={14} />
                </motion.button>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* New Workspace Dialog */}
      <AnimatePresence>
        {showAddProj && (
          <motion.div
            className={s.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={e => { if (e.target === e.currentTarget) setShowAddProj(false); }}
          >
            <motion.div
              className={s.dialog}
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 8 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            >
              <h3 className={s.dialogTitle}>New Workspace</h3>
              <p className={s.dialogSubtitle}>Connect a local project directory</p>

              <form onSubmit={handleAddProjectSubmit} className={s.dialogForm}>
                <div className={s.fieldGroup}>
                  <label className={s.fieldLabel}>Name</label>
                  <input
                    type="text"
                    placeholder="e.g. My API"
                    value={newProjName}
                    onChange={e => setNewProjName(e.target.value)}
                    className={s.fieldInput}
                    required
                  />
                </div>
                <div className={s.fieldGroup}>
                  <label className={s.fieldLabel}>Directory path</label>
                  <input
                    type="text"
                    placeholder="C:\Users\me\projects\my-app"
                    value={newProjPath}
                    onChange={e => setNewProjPath(e.target.value)}
                    className={s.fieldInput}
                    required
                  />
                </div>
                <div className={s.fieldGroup}>
                  <label className={s.fieldLabel}>Description <span className={s.optional}>(optional)</span></label>
                  <textarea
                    placeholder="What does this workspace do?"
                    value={newProjDesc}
                    onChange={e => setNewProjDesc(e.target.value)}
                    rows={2}
                    className={s.fieldInput}
                  />
                </div>
                <div className={s.fieldGroup}>
                  <label className={s.fieldLabel}>Color</label>
                  <div className={s.colorRow}>
                    {['#7B68EE','#6B5CE7','#3b82f6','#10b981','#ef4444','#ec4899','#06b6d4','#f59e0b'].map(c => (
                      <button
                        key={c}
                        type="button"
                        className={cx(s.colorSwatch, newProjColor === c && s.colorSwatchActive)}
                        style={{ backgroundColor: c }}
                        onClick={() => setNewProjColor(c)}
                      />
                    ))}
                    <input
                      type="color"
                      value={newProjColor}
                      onChange={e => setNewProjColor(e.target.value)}
                      className={s.colorCustom}
                      title="Custom color"
                    />
                  </div>
                </div>
                <div className={s.dialogActions}>
                  <button type="button" onClick={() => setShowAddProj(false)} className={s.cancelBtn}>
                    Cancel
                  </button>
                  <motion.button
                    type="submit"
                    className={s.submitBtn}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    Create Workspace
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const s = {

  /* ── Console mode ── */
  consoleRoot: css`
    display: flex; flex-direction: column;
    flex: 1; height: 100vh; overflow: hidden;
    background: var(--bg-canvas);
  `,
  consoleHeader: css`
    padding: 10px 20px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    user-select: none;
  `,
  consoleHeaderLeft: css`
    display: flex; align-items: center; gap: 8px;
    min-width: 0; overflow: hidden;
  `,
  consoleDot: css`
    width: 9px; height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 8px var(--color-brand);
  `,
  consoleName: css`
    font-size: 13px; font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
  `,
  consolePath: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--font-family-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  spacePill: css`
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 8px;
    border-radius: 99px;
    border: 1px solid;
    background: rgba(255,255,255,0.04);
    flex-shrink: 0;
  `,
  spacePillDot: css`
    width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
  `,
  spacePillName: css`
    font-size: 10px; font-weight: 600; white-space: nowrap;
  `,
  backBtn: css`
    display: flex; align-items: center; gap: 5px;
    background: transparent;
    color: var(--text-tertiary);
    padding: 5px 10px;
    border-radius: 8px;
    font-size: 11px; font-weight: 600;
    border: 1px solid var(--border-color);
    cursor: pointer; flex-shrink: 0;
    transition: all 0.15s;
    &:hover { border-color: var(--border-color-hover); color: var(--text-primary); background: var(--bg-hover); }
  `,
  consoleSplit: css`
    flex: 1; display: flex; min-height: 0; overflow: hidden;
  `,
  consoleSplitLeft: css`
    width: 62%; height: 100%;
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--bg-canvas);
  `,
  consoleSplitRight: css`
    width: 38%; height: 100%;
    display: flex; flex-direction: column; overflow: hidden;
    border-left: 1px solid var(--border-color);
    background: var(--bg-primary);
  `,
  rightTabBar: css`
    display: flex; align-items: center;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    padding: 0 6px;
    flex-shrink: 0;
  `,
  rightTab: css`
    display: flex; align-items: center; gap: 5px;
    padding: 9px 12px;
    font-size: 11px; font-weight: 600;
    color: var(--text-tertiary);
    border: none;
    background: transparent;
    cursor: pointer;
    transition: color 0.15s;
    position: relative;
    white-space: nowrap;
    &:hover { color: var(--text-secondary); }
  `,
  rightTabActive: css`
    color: var(--text-primary) !important;
  `,
  rightTabIndicator: css`
    position: absolute;
    bottom: -1px; left: 0; right: 0;
    height: 2px;
    background: var(--color-brand);
    border-radius: 2px 2px 0 0;
  `,
  runDot: css`
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--color-brand);
    animation: rdp 1.6s ease-in-out infinite;
    @keyframes rdp { 0%,100%{opacity:1} 50%{opacity:0.3} }
  `,
  rightPanelContent: css`
    flex: 1; min-height: 0; overflow: hidden;
    display: flex; flex-direction: column;
  `,

  /* ── Grid view ── */
  gridRoot: css`
    flex: 1;
    overflow-y: auto;
    padding: 36px 36px 48px;
    display: flex; flex-direction: column; gap: 32px;
    background: var(--bg-primary);
    scrollbar-width: thin;
  `,
  gridHeader: css`
    display: flex; align-items: flex-start; justify-content: space-between;
  `,
  gridTitle: css`
    font-size: 26px; font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--text-primary);
    line-height: 1.1;
  `,
  gridSubtitle: css`
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 5px;
    font-weight: 500;
  `,
  createBtn: css`
    display: flex; align-items: center; gap: 7px;
    background: var(--gradient-brand);
    color: #fff;
    padding: 9px 18px;
    border-radius: 10px;
    font-size: 12px; font-weight: 700;
    border: none; cursor: pointer;
    box-shadow: 0 4px 16px rgba(123, 104, 238, 0.30);
    transition: box-shadow 0.2s, filter 0.2s;
    &:hover { box-shadow: 0 6px 24px rgba(123, 104, 238, 0.40); filter: brightness(1.06); }
  `,

  /* Empty state */
  emptyState: css`
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 12px;
    padding: 64px 32px;
    text-align: center;
    border: 1px dashed var(--border-color-hover);
    border-radius: 16px;
    background: var(--bg-secondary);
  `,
  emptyIcon: css`
    width: 64px; height: 64px;
    border-radius: 16px;
    background: var(--bg-hover);
    display: flex; align-items: center; justify-content: center;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  `,
  emptyTitle: css`
    font-size: 16px; font-weight: 700;
    color: var(--text-primary);
  `,
  emptyText: css`
    font-size: 12px;
    color: var(--text-tertiary);
    max-width: 280px;
    line-height: 1.6;
  `,

  /* Cards grid */
  cardsGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 18px;
    align-content: start;
  `,
  card: css`
    position: relative;
    border-radius: 14px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    display: flex; flex-direction: column;
    gap: 14px;
    overflow: hidden;
    cursor: default;
    transition: border-color 0.2s, box-shadow 0.2s;
    &:hover {
      border-color: var(--border-color-hover);
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
    }
  `,
  cardActive: css`
    border-color: rgba(var(--color-brand-rgb), 0.3) !important;
    box-shadow: 0 0 0 1px rgba(var(--color-brand-rgb), 0.15), 0 8px 32px rgba(0,0,0,0.3) !important;
  `,
  cardBar: css`
    height: 3px; width: 100%;
    flex-shrink: 0;
  `,
  cardHeader: css`
    display: flex; align-items: flex-start; gap: 12px;
    padding: 14px 16px 0;
  `,
  cardAvatar: css`
    width: 36px; height: 36px;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  `,
  cardMeta: css`
    flex: 1; min-width: 0;
  `,
  cardName: css`
    font-size: 14px; font-weight: 700;
    color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  cardPath: css`
    font-size: 10px;
    font-family: var(--font-family-mono);
    color: var(--text-tertiary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    margin-top: 2px;
  `,
  cardDesc: css`
    font-size: 11px; color: var(--text-secondary);
    line-height: 1.55;
    padding: 0 16px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  `,
  cardBadges: css`
    display: flex; gap: 6px;
    padding: 0 16px;
  `,
  spaceBadge: css`
    display: inline-flex; align-items: center;
    background: var(--bg-hover);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    padding: 2px 8px;
    font-size: 10px; font-weight: 600;
    color: var(--text-tertiary);
  `,

  /* Task block */
  taskBlock: css`
    padding: 10px 16px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-canvas);
    margin: 0 -1px;
  `,
  taskEditRow: css`
    display: flex; align-items: center; gap: 8px;
  `,
  taskInput: css`
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color-hover);
    border-radius: 7px;
    padding: 5px 9px;
    font-size: 12px;
    color: var(--text-primary);
    outline: none;
    font-family: var(--font-family);
    transition: border-color 0.15s, box-shadow 0.15s;
    &:focus {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 3px rgba(var(--color-brand-rgb), 0.15);
    }
    &::placeholder { color: var(--text-tertiary); }
  `,
  taskSaveBtn: css`
    font-size: 11px;
    background: var(--gradient-brand);
    padding: 5px 11px;
    border-radius: 6px;
    color: #fff; font-weight: 700;
    border: none; cursor: pointer;
    white-space: nowrap;
    &:hover { filter: brightness(1.1); }
  `,
  taskDisplay: css`
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    cursor: pointer;
    padding: 2px 0;
    transition: opacity 0.15s;
    &:hover { opacity: 0.8; }
  `,
  taskText: css`
    font-size: 12px; color: var(--text-secondary);
    line-height: 1.4; flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  `,
  taskPlaceholder: css`
    color: var(--text-tertiary);
    font-style: italic;
  `,
  taskEditIcon: css`
    flex-shrink: 0;
    color: var(--text-tertiary);
    opacity: 0.5;
  `,

  /* Open button */
  openBtn: css`
    display: flex; align-items: center; justify-content: space-between;
    width: 100%;
    padding: 11px 16px;
    font-size: 12px; font-weight: 600;
    color: var(--text-secondary);
    border: none; border-top: 1px solid var(--border-color);
    background: transparent;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
    &:hover { color: var(--text-primary); background: var(--bg-hover); }
  `,
  openBtnActive: css`
    display: flex; align-items: center; justify-content: space-between;
    width: 100%;
    padding: 11px 16px;
    font-size: 12px; font-weight: 700;
    color: var(--color-brand);
    border: none; border-top: 1px solid rgba(var(--color-brand-rgb), 0.2);
    background: rgba(var(--color-brand-rgb), 0.06);
    cursor: pointer;
    transition: background 0.15s;
    &:hover { background: rgba(var(--color-brand-rgb), 0.1); }
  `,

  /* Dialog */
  overlay: css`
    position: fixed; inset: 0; z-index: 100;
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(6px);
  `,
  dialog: css`
    width: 100%; max-width: 460px;
    border-radius: 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color-hover);
    box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    padding: 28px;
  `,
  dialogTitle: css`
    font-size: 20px; font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin-bottom: 4px;
  `,
  dialogSubtitle: css`
    font-size: 12px; color: var(--text-tertiary);
    margin-bottom: 24px;
  `,
  dialogForm: css`
    display: flex; flex-direction: column; gap: 18px;
  `,
  fieldGroup: css`display: flex; flex-direction: column; gap: 6px;`,
  fieldLabel: css`
    font-size: 11px; font-weight: 600;
    color: var(--text-secondary);
  `,
  optional: css`
    color: var(--text-tertiary); font-weight: 400;
  `,
  fieldInput: css`
    width: 100%;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 12px;
    color: var(--text-primary);
    outline: none;
    font-family: var(--font-family);
    transition: border-color 0.15s, box-shadow 0.15s;
    &:focus {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 3px rgba(var(--color-brand-rgb), 0.12);
    }
    &::placeholder { color: var(--text-tertiary); }
    resize: none;
  `,
  colorRow: css`
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  `,
  colorSwatch: css`
    width: 24px; height: 24px;
    border-radius: 6px;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.12s, border-color 0.12s;
    &:hover { transform: scale(1.15); }
  `,
  colorSwatchActive: css`
    border-color: rgba(255,255,255,0.8) !important;
    transform: scale(1.1);
  `,
  colorCustom: css`
    width: 28px; height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
  `,
  dialogActions: css`
    display: flex; justify-content: flex-end; gap: 10px;
    padding-top: 6px;
  `,
  cancelBtn: css`
    background: transparent;
    font-size: 12px; font-weight: 600;
    color: var(--text-tertiary);
    border: 1px solid var(--border-color);
    padding: 9px 18px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
    &:hover { color: var(--text-primary); border-color: var(--border-color-hover); background: var(--bg-hover); }
  `,
  submitBtn: css`
    background: var(--gradient-brand);
    color: #fff;
    font-size: 12px; font-weight: 700;
    padding: 9px 20px;
    border-radius: 8px;
    border: none; cursor: pointer;
    box-shadow: 0 4px 14px rgba(123, 104, 238, 0.30);
    transition: box-shadow 0.2s, filter 0.2s;
    &:hover { box-shadow: 0 6px 20px rgba(123, 104, 238, 0.40); filter: brightness(1.06); }
  `,

  /* Shared */
  iconSm: css`width: 16px; height: 16px;`,
  iconXs: css`width: 14px; height: 14px;`,
};
