import React, { useState, useEffect, useMemo, useRef } from 'react';
import { css, cx } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useDashboard, DEFAULT_TERMINAL_WORKSPACE } from '../context/DashboardContext';
import { WorkspaceConsole } from '../components/workspace/WorkspaceConsole';
import { WindowControls } from '../components/layout/WindowControls';
import { Input } from '../components/ui';
import {
  Plus,
  ChevronRight,
  Edit2,
  Terminal,
  FolderOpen,
  ImagePlus,
  X as XIcon,
} from 'lucide-react';

const MAX_ICON_BYTES = 300 * 1024; // 300KB — icons are persisted as data URLs in the settings store

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ── Animation variants ─────────────────────────────────────────────────────── */

const ease = [0.4, 0, 0.2, 1] as [number, number, number, number];

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.18 } },
};

const gridVariants = {
  animate: { transition: { staggerChildren: 0.06 } },
};

const cardVariants = {
  initial: { opacity: 0, y: 20, scale: 0.97 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.28, ease },
  },
};

/* ── Component ──────────────────────────────────────────────────────────────── */

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
    newWorkspaceModalOpen,
    setNewWorkspaceModalOpen,
  } = useDashboard();

  const [showAddProj, setShowAddProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjPath, setNewProjPath] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjColor, setNewProjColor] = useState('#2f8f7a');
  const [newProjIcon, setNewProjIcon] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskValue, setEditTaskValue] = useState('');
  const newIconInputRef = useRef<HTMLInputElement>(null);

  const handleIconFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    onLoaded: (dataUrl: string) => void
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Pick an image file', 'error');
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      showToast('Icon too large — 300KB max', 'error');
      return;
    }
    onLoaded(await readImageAsDataUrl(file));
  };

  // Tracks which workspaces have ever had their console opened this session.
  // Once mounted, a WorkspaceConsole stays mounted (PTY sessions survive workspace switches).
  const [mountedConsoleIds, setMountedConsoleIds] = useState<Set<string>>(new Set());

  // Mark the active workspace as mounted whenever console view is active.
  useEffect(() => {
    if (viewMode === 'console' && activeWorkspaceId) {
      setMountedConsoleIds((prev) => {
        if (prev.has(activeWorkspaceId)) return prev;
        return new Set([...prev, activeWorkspaceId]);
      });
    }
  }, [viewMode, activeWorkspaceId]);

  // Open the New Workspace modal whenever the sidebar + button sets the flag.
  useEffect(() => {
    if (newWorkspaceModalOpen) {
      setShowAddProj(true);
      setNewWorkspaceModalOpen(false);
    }
  }, [newWorkspaceModalOpen, setNewWorkspaceModalOpen]);

  const activeProject = useMemo(() => {
    if (activeWorkspaceId === DEFAULT_TERMINAL_WORKSPACE.id) return DEFAULT_TERMINAL_WORKSPACE;
    return workspaces.find((p) => p.id === activeWorkspaceId) || workspaces[0];
  }, [workspaces, activeWorkspaceId]);

  const handleTaskSave = (projId: string) => {
    updateWorkspace(projId, { currentTask: editTaskValue });
    setEditingTaskId(null);
    showToast('Task updated', 'success');
  };

  const handleBrowseDirectory = async () => {
    const selected = await openDialog({ directory: true, multiple: false, recursive: false });
    if (typeof selected === 'string' && selected) {
      setNewProjPath(selected);
      // Auto-fill name from the last path segment if the field is empty
      if (!newProjName.trim()) {
        const parts = selected.replace(/\\/g, '/').split('/').filter(Boolean);
        setNewProjName(parts[parts.length - 1] ?? '');
      }
    }
  };

  const handleAddProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) {
      showToast('Name required', 'error');
      return;
    }
    addWorkspace({
      name: newProjName,
      path: newProjPath,
      description: newProjDesc,
      color: newProjColor,
      icon: newProjIcon,
      status: 'active',
      currentTask: '',
    });
    setNewProjName('');
    setNewProjPath('');
    setNewProjDesc('');
    setNewProjColor('#2f8f7a');
    setNewProjIcon(null);
    setShowAddProj(false);
  };

  const showConsole = viewMode === 'console' && !!activeProject;

  /*
   * Console view is ALWAYS mounted (once opened) so PTY sessions survive both
   * viewMode switches and workspace switches. Each workspace gets its own
   * WorkspaceConsole instance keyed by workspace.id; only the active one is
   * visible (CSS display toggle). The grid flies in as an absolute overlay on top.
   */
  return (
    <div className={s.pageRoot}>
      {/* ── Per-workspace consoles: lazy-mounted on first open, never unmounted ── */}
      {[...workspaces, DEFAULT_TERMINAL_WORKSPACE]
        .filter((w) => mountedConsoleIds.has(w.id))
        .map((workspace) => {
          const isThisActive = workspace.id === activeWorkspaceId;
          // Only resolve the active space for the currently visible workspace.
          // Non-active workspaces always get a stable panelKey so their
          // TerminalContainer never remounts due to space changes elsewhere.
          const thisSpace =
            isThisActive && activeSpaceId
              ? (spaces.find((sp) => sp.id === activeSpaceId && sp.workspaceId === workspace.id) ??
                null)
              : null;
          return (
            <WorkspaceConsole
              key={workspace.id}
              active={showConsole && isThisActive}
              project={workspace}
              space={thisSpace}
              panelKey={`${workspace.id}::${thisSpace?.id ?? 'workspace'}`}
            />
          );
        })}

      {/* ── Grid — absolute overlay, animates in/out over the console ───────── */}
      <AnimatePresence>
        {!showConsole && (
          <motion.div
            key="grid"
            className={s.gridRoot}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {/* Header */}
            <div className={s.gridHeader} data-tauri-drag-region="deep">
              <div>
                <h1 className={s.gridTitle}>Workspaces</h1>
                <p className={s.gridSubtitle}>
                  {workspaces.length === 0
                    ? 'Create a workspace to get started'
                    : `${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div className={s.gridHeaderRight}>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowAddProj(true)}
                  className={s.createBtn}
                >
                  <Plus size={15} />
                  <span>New Workspace</span>
                </motion.button>
                <WindowControls />
              </div>
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
                  const isActive = proj.id === activeProject?.id;
                  const spaceCount = spaces.filter((sp) => sp.workspaceId === proj.id).length;
                  return (
                    <motion.div
                      key={proj.id}
                      variants={cardVariants}
                      whileHover={{ y: -3, transition: { duration: 0.2 } }}
                      className={cx(s.card, isActive && s.cardActive)}
                      style={{ '--card-color': proj.color } as React.CSSProperties}
                    >
                      <div className={s.cardHeader}>
                        <label
                          className={s.cardAvatar}
                          style={
                            !proj.icon
                              ? {
                                  backgroundColor: proj.color + '33',
                                  borderColor: proj.color + 'aa',
                                }
                              : { borderColor: proj.color + 'aa' }
                          }
                          title={proj.icon ? 'Replace icon' : 'Add an icon or logo'}
                        >
                          {proj.icon ? (
                            <img src={proj.icon} alt="" className={s.cardAvatarImg} />
                          ) : (
                            <Terminal size={13} className={s.cardAvatarIcon} />
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            className={s.hiddenFileInput}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              handleIconFile(e, (dataUrl) =>
                                updateWorkspace(proj.id, { icon: dataUrl })
                              )
                            }
                          />
                        </label>
                        <div className={s.cardMeta}>
                          <h4 className={s.cardName}>{proj.name}</h4>
                          <p className={s.cardPath}>{proj.path}</p>
                        </div>
                      </div>
                      {proj.description && <p className={s.cardDesc}>{proj.description}</p>}
                      {spaceCount > 0 && (
                        <div className={s.cardBadges}>
                          <span className={s.spaceBadge}>
                            {spaceCount} space{spaceCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                      <div className={s.taskBlock}>
                        {editingTaskId === proj.id ? (
                          <div className={s.taskEditRow}>
                            <Input
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
                              placeholder="What are you working on?"
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
                            <span
                              className={cx(s.taskText, !proj.currentTask && s.taskPlaceholder)}
                            >
                              {proj.currentTask || 'Set a focus…'}
                            </span>
                            <Edit2 size={11} className={s.taskEditIcon} />
                          </div>
                        )}
                      </div>
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
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setShowAddProj(false);
                  }}
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
                        <Input
                          type="text"
                          placeholder="e.g. My API"
                          value={newProjName}
                          onChange={(e) => setNewProjName(e.target.value)}
                          className={s.fieldInput}
                          required
                        />
                      </div>
                      <div className={s.fieldGroup}>
                        <label className={s.fieldLabel}>
                          Directory path <span className={s.optional}>(optional)</span>
                        </label>
                        <div className={s.pathInputRow}>
                          <Input
                            type="text"
                            placeholder="C:\Users\me\projects\my-app"
                            value={newProjPath}
                            onChange={(e) => setNewProjPath(e.target.value)}
                            className={cx(s.fieldInput, s.pathInput)}
                          />
                          <button
                            type="button"
                            className={s.browseBtn}
                            onClick={handleBrowseDirectory}
                            title="Browse for folder"
                          >
                            <FolderOpen size={14} />
                            <span>Browse</span>
                          </button>
                        </div>
                      </div>
                      <div className={s.fieldGroup}>
                        <label className={s.fieldLabel}>
                          Description <span className={s.optional}>(optional)</span>
                        </label>
                        <textarea
                          placeholder="What does this workspace do?"
                          value={newProjDesc}
                          onChange={(e) => setNewProjDesc(e.target.value)}
                          rows={2}
                          className={s.fieldInput}
                        />
                      </div>
                      <div className={s.fieldGroup}>
                        <label className={s.fieldLabel}>
                          Icon <span className={s.optional}>(optional)</span>
                        </label>
                        <div className={s.iconRow}>
                          <button
                            type="button"
                            className={s.iconPreviewBtn}
                            onClick={() => newIconInputRef.current?.click()}
                            style={
                              !newProjIcon
                                ? {
                                    backgroundColor: newProjColor + '33',
                                    borderColor: newProjColor + 'aa',
                                  }
                                : undefined
                            }
                            title={newProjIcon ? 'Replace icon' : 'Upload an icon or logo'}
                          >
                            {newProjIcon ? (
                              <img src={newProjIcon} alt="" className={s.iconPreviewImg} />
                            ) : (
                              <ImagePlus size={15} className={s.iconPreviewGlyph} />
                            )}
                          </button>
                          {newProjIcon && (
                            <button
                              type="button"
                              className={s.iconClearBtn}
                              onClick={() => setNewProjIcon(null)}
                              title="Remove icon"
                            >
                              <XIcon size={12} />
                            </button>
                          )}
                          <input
                            ref={newIconInputRef}
                            type="file"
                            accept="image/*"
                            className={s.hiddenFileInput}
                            onChange={(e) => handleIconFile(e, setNewProjIcon)}
                          />
                        </div>
                      </div>
                      <div className={s.fieldGroup}>
                        <label className={s.fieldLabel}>Color</label>
                        <div className={s.colorRow}>
                          {[
                            '#2f8f7a',
                            '#565d61',
                            '#4a7ca3',
                            '#6b8f3f',
                            '#0e8a80',
                            '#9c5fa3',
                            '#c98a1f',
                            '#5a6570',
                          ].map((c) => (
                            <button
                              key={c}
                              type="button"
                              className={cx(
                                s.colorSwatch,
                                newProjColor === c && s.colorSwatchActive
                              )}
                              style={{ backgroundColor: c }}
                              onClick={() => setNewProjColor(c)}
                            />
                          ))}
                          <input
                            type="color"
                            value={newProjColor}
                            onChange={(e) => setNewProjColor(e.target.value)}
                            className={s.colorCustom}
                            title="Custom color"
                          />
                        </div>
                      </div>
                      <div className={s.dialogActions}>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddProj(false);
                            setNewProjIcon(null);
                          }}
                          className={s.cancelBtn}
                        >
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
        )}
      </AnimatePresence>
    </div>
  );
};

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const s = {
  /* ── Page shell (single always-rendered root) ── */
  pageRoot: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    overflow: hidden;
    position: relative; /* grid overlay anchors here */
    background: var(--bg-canvas);
  `,

  /* ── Grid view — absolute overlay so console stays mounted beneath ── */
  gridRoot: css`
    position: absolute;
    inset: 0;
    z-index: 10;
    overflow-y: auto;
    padding: 36px 36px 48px;
    display: flex;
    flex-direction: column;
    gap: 32px;
    background: var(--bg-primary);
    scrollbar-width: thin;
  `,
  gridHeader: css`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  `,
  gridHeaderRight: css`
    display: flex;
    align-items: flex-start;
    flex-shrink: 0;
  `,
  gridTitle: css`
    font-size: 26px;
    font-weight: 800;
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
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--gradient-brand);
    color: #fff;
    padding: 9px 18px;
    border-radius: var(--radius-xl);
    font-size: 12px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(47, 143, 122, 0.3);
    transition:
      box-shadow 0.2s,
      filter 0.2s;
    &:hover {
      box-shadow: 0 6px 24px rgba(47, 143, 122, 0.4);
      filter: brightness(1.06);
    }
  `,

  /* Empty state */
  emptyState: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 64px 32px;
    text-align: center;
    border: 1px dashed var(--border-color-hover);
    border-radius: var(--radius-xl);
    background: var(--bg-secondary);
  `,
  emptyIcon: css`
    width: 64px;
    height: 64px;
    border-radius: var(--radius-xl);
    background: var(--bg-hover);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  `,
  emptyTitle: css`
    font-size: 16px;
    font-weight: 700;
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
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
    cursor: default;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
    &:hover {
      border-color: var(--border-color-hover);
      box-shadow: var(--shadow-md);
    }
  `,
  cardActive: css`
    border-color: rgba(var(--color-brand-rgb), 0.4) !important;
    box-shadow: var(--shadow-brand) !important;
  `,
  cardHeader: css`
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px 0;
  `,
  cardAvatar: css`
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md);
    border: 1.5px solid;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    cursor: pointer;
  `,
  cardAvatarImg: css`
    width: 100%;
    height: 100%;
    object-fit: cover;
  `,
  cardAvatarIcon: css`
    color: var(--material-brass);
  `,
  cardMeta: css`
    flex: 1;
    min-width: 0;
  `,
  cardName: css`
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
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
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.55;
    padding: 0 16px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  `,
  cardBadges: css`
    display: flex;
    gap: 6px;
    padding: 0 16px;
  `,
  spaceBadge: css`
    display: inline-flex;
    align-items: center;
    background: var(--bg-hover);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 600;
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
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  taskInput: css`
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color-hover);
    border-radius: var(--radius-lg);
    padding: 5px 9px;
    font-size: 12px;
    color: var(--text-primary);
    outline: none;
    font-family: var(--font-family);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
    &:focus {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 3px rgba(var(--color-brand-rgb), 0.15);
    }
    &::placeholder {
      color: var(--text-tertiary);
    }
  `,
  taskSaveBtn: css`
    font-size: 11px;
    background: var(--gradient-brand);
    padding: 5px 11px;
    border-radius: 6px;
    color: #fff;
    font-weight: 700;
    border: none;
    cursor: pointer;
    white-space: nowrap;
    &:hover {
      filter: brightness(1.1);
    }
  `,
  taskDisplay: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    cursor: pointer;
    padding: 2px 0;
    transition: opacity 0.15s;
    &:hover {
      opacity: 0.8;
    }
  `,
  taskText: css`
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 11px 16px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    border: none;
    border-top: 1px solid var(--border-color);
    background: transparent;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
    &:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }
  `,
  openBtnActive: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 11px 16px;
    font-size: 12px;
    font-weight: 700;
    color: var(--color-brand);
    border: none;
    border-top: 1px solid rgba(var(--color-brand-rgb), 0.2);
    background: rgba(var(--color-brand-rgb), 0.06);
    cursor: pointer;
    transition: background 0.15s;
    &:hover {
      background: rgba(var(--color-brand-rgb), 0.1);
    }
  `,

  /* Dialog */
  overlay: css`
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: var(--overlay-scrim);
    backdrop-filter: blur(6px);
  `,
  dialog: css`
    width: 100%;
    max-width: 460px;
    border-radius: var(--radius-xl);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color-hover);
    box-shadow: var(--shadow-lg);
    padding: 28px;
  `,
  dialogTitle: css`
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin-bottom: 4px;
  `,
  dialogSubtitle: css`
    font-size: 12px;
    color: var(--text-tertiary);
    margin-bottom: 24px;
  `,
  dialogForm: css`
    display: flex;
    flex-direction: column;
    gap: 18px;
  `,
  fieldGroup: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  fieldLabel: css`
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
  `,
  optional: css`
    color: var(--text-tertiary);
    font-weight: 400;
  `,
  fieldInput: css`
    width: 100%;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xl);
    padding: 9px 12px;
    font-size: 12px;
    color: var(--text-primary);
    outline: none;
    font-family: var(--font-family);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
    &:focus {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 3px rgba(var(--color-brand-rgb), 0.12);
    }
    &::placeholder {
      color: var(--text-tertiary);
    }
    resize: none;
  `,
  pathInputRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  pathInput: css`
    flex: 1;
    min-width: 0;
    font-family: var(--font-family-mono);
    font-size: 11px;
  `,
  browseBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-hover);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xl);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
    &:hover {
      background: var(--bg-secondary);
      border-color: var(--color-brand);
      color: var(--text-primary);
    }
  `,
  colorRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  `,
  iconRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  iconPreviewBtn: css`
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    border: 1.5px solid var(--border-color-hover);
    background: var(--bg-input);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    overflow: hidden;
    padding: 0;
    transition: border-color 0.15s ease;
    &:hover {
      border-color: var(--color-brand);
    }
  `,
  iconPreviewImg: css`
    width: 100%;
    height: 100%;
    object-fit: cover;
  `,
  iconPreviewGlyph: css`
    color: var(--text-tertiary);
  `,
  iconClearBtn: css`
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    &:hover {
      color: var(--color-error);
      border-color: var(--color-error);
    }
  `,
  hiddenFileInput: css`
    display: none;
  `,
  colorSwatch: css`
    width: 24px;
    height: 24px;
    border-radius: var(--radius-md);
    border: 2px solid transparent;
    cursor: pointer;
    transition:
      transform 0.12s,
      border-color 0.12s;
    &:hover {
      transform: scale(1.15);
    }
  `,
  colorSwatchActive: css`
    border-color: var(--material-paper) !important;
    transform: scale(1.1);
  `,
  colorCustom: css`
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
  `,
  dialogActions: css`
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 6px;
  `,
  cancelBtn: css`
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    border: 1px solid var(--border-color);
    padding: 9px 18px;
    border-radius: var(--radius-xl);
    cursor: pointer;
    transition: all 0.15s;
    &:hover {
      color: var(--text-primary);
      border-color: var(--border-color-hover);
      background: var(--bg-hover);
    }
  `,
  submitBtn: css`
    background: var(--gradient-brand);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    padding: 9px 20px;
    border-radius: var(--radius-xl);
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(47, 143, 122, 0.3);
    transition:
      box-shadow 0.2s,
      filter 0.2s;
    &:hover {
      box-shadow: 0 6px 20px rgba(47, 143, 122, 0.4);
      filter: brightness(1.06);
    }
  `,
};
