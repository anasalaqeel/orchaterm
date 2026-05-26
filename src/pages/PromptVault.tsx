import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SavedPrompt } from '../types';
import { 
  Search, 
  Copy, 
  Plus, 
  Edit2, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  Tag, 
  Calendar,
  X
} from 'lucide-react';
import { css, cx, keyframes } from '@emotion/css';

export const PromptVaultView: React.FC = () => {
  const {
    savedPrompts,
    workspaces,
    addSavedPrompt,
    updateSavedPrompt,
    deleteSavedPrompt,
    copyPromptToClipboard,
    showToast
  } = useDashboard();

  // Filter states
  const [search, setSearch] = useState('');
  const [filterWorkspace, setFilterWorkspace] = useState('all');

  // Expanded cards state
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);

  // Confirm delete dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteTitle, setPendingDeleteTitle] = useState('');

  // Form states
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [promptWorkspaceId, setPromptWorkspaceId] = useState('');
  const [tagInput, setTagInput] = useState('');

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const resetForm = () => {
    setTitle('');
    setContent('');
    setPromptWorkspaceId('');
    setTagInput('');
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      showToast('Title and prompt content are required', 'error');
      return;
    }

    const tags = tagInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    addSavedPrompt({
      title,
      content,
      workspaceId: promptWorkspaceId,
      spaceId: null,
      tags
    });

    resetForm();
    setShowAddModal(false);
  };

  const handleEditClick = (prompt: SavedPrompt, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid expanding card when clicking edit
    setEditingPrompt(prompt);
    setTitle(prompt.title);
    setContent(prompt.content);
    setPromptWorkspaceId(prompt.workspaceId);
    setTagInput(prompt.tags.join(', '));
    setShowEditModal(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPrompt) return;
    if (!title.trim() || !content.trim()) {
      showToast('Title and prompt content are required', 'error');
      return;
    }

    const tags = tagInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    updateSavedPrompt(editingPrompt.id, {
      title,
      content,
      workspaceId: promptWorkspaceId,
      tags
    });

    setEditingPrompt(null);
    resetForm();
    setShowEditModal(false);
    showToast('Prompt settings updated', 'success');
  };

  const handleDeleteClick = (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid expanding card when clicking delete
    setPendingDeleteId(id);
    setPendingDeleteTitle(title);
    setConfirmOpen(true);
  };

  const handleCopyClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid expanding card when clicking copy
    copyPromptToClipboard(id);
  };

  // Filter calculations
  const filteredPrompts = savedPrompts.filter(p => {
    const matchesWorkspace = filterWorkspace === 'all' || p.workspaceId === filterWorkspace;
    const matchesSearch =
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.content.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()));

    return matchesWorkspace && matchesSearch;
  });

  const formatRelativeTime = (isoString: string | null) => {
    if (!isoString) return 'Never';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className={styles.container}>
      
      {/* Header section */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Prompt Vault</h2>
          <p className={styles.description}>Store and query context instructions, system parameters, or custom developer templates.</p>
        </div>
        
        <button
          onClick={() => {
            resetForm();
            if (workspaces.length > 0) setPromptWorkspaceId(workspaces[0].id);
            setShowAddModal(true);
          }}
          className={styles.savePromptBtn}
        >
          <Plus className={styles.iconSm} />
          <span>Save Prompt</span>
        </button>
      </div>

      {/* Filters Area */}
      <div className={styles.filtersArea}>
        
        {/* Workspace Filter */}
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Filter Workspace</label>
          <select
            value={filterWorkspace}
            onChange={(e) => setFilterWorkspace(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="all">All Workspaces</option>
            {workspaces.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        {/* Global Search (title, content, tags) */}
        <div className={styles.searchFilterGroup}>
          <label className={styles.filterLabel}>Search Prompts</label>
          <div className={styles.searchWrapper}>
            <Search className={styles.iconSm} />
            <input
              type="text"
              placeholder="Search by keywords or tags..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.searchInput}
            />
            {search && (
              <button onClick={() => setSearch('')} className={styles.clearSearchBtn}>
                <X className={styles.iconXs} />
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Prompts Cards List */}
      {filteredPrompts.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyStateTitle}>No prompts stored yet.</p>
          <p className={styles.emptyStateSubtitle}>Save critical instructions or system boundaries above.</p>
        </div>
      ) : (
        <div className={styles.cardsList}>
          {filteredPrompts.map((prompt) => {
            const isExpanded = !!expandedIds[prompt.id];
            const workspaceObj = workspaces.find(w => w.id === prompt.workspaceId);

            return (
              <div
                key={prompt.id}
                onClick={() => toggleExpand(prompt.id)}
                className={cx(
                  styles.card,
                  isExpanded ? styles.cardExpanded : styles.cardCollapsed
                )}
              >
                {/* Header Summary Strip */}
                <div className={styles.cardHeader}>
                  <div className={styles.cardInfo}>
                    <div className={styles.cardTitleRow}>
                      <h4 className={styles.cardTitle}>
                        {prompt.title}
                      </h4>
                      {/* Workspace indicator badge */}
                      {workspaceObj && (
                        <span
                          className={styles.workspaceBadge}
                          style={{ backgroundColor: workspaceObj.color }}
                        >
                          {workspaceObj.name}
                        </span>
                      )}
                    </div>
                    {/* Tags List */}
                    <div className={styles.tagsList}>
                      {prompt.tags.map((tag, idx) => (
                        <span key={idx} className={styles.tagItem}>
                          <Tag className={styles.iconMin} />
                          <span>{tag}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions Area */}
                  <div className={styles.actionsArea}>
                    <button
                      onClick={(e) => handleCopyClick(prompt.id, e)}
                      className={styles.copyBtn}
                      title="Copy Prompt Content"
                    >
                      <Copy className={styles.iconXs} />
                      <span>Copy</span>
                    </button>
                    
                    <button
                      onClick={(e) => handleEditClick(prompt, e)}
                      className={styles.actionBtn}
                      title="Edit Prompt"
                    >
                      <Edit2 className={styles.iconXs} />
                    </button>
                    
                    <button
                      onClick={(e) => handleDeleteClick(prompt.id, prompt.title, e)}
                      className={styles.deleteBtn}
                      title="Delete Prompt"
                    >
                      <Trash2 className={styles.iconXs} />
                    </button>

                    <div className={styles.chevronWrapper}>
                      {isExpanded ? <ChevronUp className={styles.iconSm} /> : <ChevronDown className={styles.iconSm} />}
                    </div>
                  </div>
                </div>

                {/* Expanded Details Section */}
                {isExpanded && (
                  <div className={styles.expandedDetails}>
                    <div className={styles.expandedContent}>
                      {/* Monospaced prompt content block */}
                      <div className={styles.preWrapper}>
                        <pre className={styles.preContent}>
                          {prompt.content}
                        </pre>
                        <button
                          onClick={(e) => handleCopyClick(prompt.id, e)}
                          className={styles.inlineCopyBtn}
                          title="Copy block contents"
                        >
                          <Copy className={styles.iconSm} />
                        </button>
                      </div>

                      {/* Log Dates / Usage stats */}
                      <div className={styles.statsBar}>
                        <span className={styles.statItem}>
                          <Calendar className={styles.iconXxs} />
                          <span>Last Used: {formatRelativeTime(prompt.usedAt)}</span>
                        </span>
                        <span>Saved: {new Date(prompt.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ADD PROMPT MODAL */}
      {showAddModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalHeader}>Save Prompt Template</h3>
            <form onSubmit={handleAddSubmit} className={styles.modalForm}>
              <div>
                <label className={styles.fieldLabel}>Title</label>
                <input
                  type="text"
                  placeholder="e.g. Refactor API, TypeScript boilerplate instructions"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={styles.input}
                  required
                />
              </div>

              <div>
                <label className={styles.fieldLabel}>Associate Workspace</label>
                <select
                  value={promptWorkspaceId}
                  onChange={(e) => setPromptWorkspaceId(e.target.value)}
                  className={styles.input}
                  required
                >
                  <option value="" disabled>-- Select Workspace --</option>
                  {workspaces.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={styles.fieldLabel}>Tags (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. system, config, react, tailwind"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div>
                <label className={styles.fieldLabel}>Prompt Instructions Content</label>
                <textarea
                  placeholder="Paste instructions templates here..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  className={cx(styles.input, styles.textareaMono)}
                  required
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitBtn}
                >
                  Save Prompt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM DIALOG */}
      <ConfirmDialog
        isOpen={confirmOpen}
        message={`Delete prompt "${pendingDeleteTitle}"? This cannot be undone.`}
        onConfirm={() => {
          if (pendingDeleteId) deleteSavedPrompt(pendingDeleteId);
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
      />

      {/* EDIT PROMPT MODAL */}
      {showEditModal && editingPrompt && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalHeader}>Modify Prompt Configuration</h3>
            <form onSubmit={handleEditSubmit} className={styles.modalForm}>
              <div>
                <label className={styles.fieldLabel}>Title</label>
                <input
                  type="text"
                  placeholder="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={styles.input}
                  required
                />
              </div>

              <div>
                <label className={styles.fieldLabel}>Associate Workspace</label>
                <select
                  value={promptWorkspaceId}
                  onChange={(e) => setPromptWorkspaceId(e.target.value)}
                  className={styles.input}
                  required
                >
                  {workspaces.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={styles.fieldLabel}>Tags (comma-separated)</label>
                <input
                  type="text"
                  placeholder="system, config"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div>
                <label className={styles.fieldLabel}>Prompt Instructions Content</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  className={cx(styles.input, styles.textareaMono)}
                  required
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPrompt(null);
                    setShowEditModal(false);
                  }}
                  className={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitBtn}
                >
                  Update Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideUp = keyframes`
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const styles = {
  container: css`
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-xl);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xl);
    background-color: var(--bg-primary);
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-md);
  `,
  title: css`
    font-size: var(--font-size-3xl);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.025em;
    color: var(--text-primary);
  `,
  description: css`
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  `,
  savePromptBtn: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    background: var(--gradient-brand);
    color: #ffffff;
    padding: var(--spacing-sm) var(--spacing-md);
    border: none;
    border-radius: var(--border-radius-md);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    box-shadow: 0 4px 14px rgba(123, 104, 238, 0.3);

    &:hover {
      filter: brightness(1.06);
      transform: scale(1.02);
    }
  `,
  iconSm: css`
    width: 16px;
    height: 16px;
  `,
  iconXs: css`
    width: 14px;
    height: 14px;
  `,
  iconXxs: css`
    width: 12px;
    height: 12px;
  `,
  iconMin: css`
    width: 10px;
    height: 10px;
  `,
  filtersArea: css`
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
    padding: var(--spacing-lg);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);

    @media (min-width: 768px) {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  `,
  filterGroup: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  filterLabel: css`
    font-size: 10px;
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,
  filterSelect: css`
    width: 100%;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: var(--spacing-sm);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.2s ease;

    &:focus {
      border-color: var(--color-brand);
    }
  `,
  searchFilterGroup: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    @media (min-width: 768px) {
      grid-column: span 2 / span 2;
    }
  `,
  searchWrapper: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 6px var(--spacing-md);

    svg {
      color: var(--text-tertiary);
    }
  `,
  searchInput: css`
    background: transparent;
    border: none;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    outline: none;
    width: 100%;

    &::placeholder {
      color: var(--text-tertiary);
    }
  `,
  clearSearchBtn: css`
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: color 0.2s ease;

    &:hover {
      color: var(--text-primary);
    }
  `,
  emptyState: css`
    padding: var(--spacing-3xl);
    text-align: center;
    border: 1px dashed var(--border-color);
    border-radius: var(--border-radius-lg);
    background-color: var(--bg-secondary);
  `,
  emptyStateTitle: css`
    color: var(--text-secondary);
    margin-bottom: var(--spacing-sm);
  `,
  emptyStateSubtitle: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  `,
  cardsList: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  `,
  card: css`
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--border-color);
    transition: all 0.2s ease-in-out;
    cursor: pointer;
    overflow: hidden;
  `,
  cardExpanded: css`
    border-color: var(--color-brand);
    background-color: var(--bg-secondary);
    box-shadow: var(--shadow-brand);
  `,
  cardCollapsed: css`
    background-color: var(--bg-secondary);

    &:hover {
      border-color: var(--border-color-hover);
    }
  `,
  cardHeader: css`
    padding: var(--spacing-lg);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    user-select: none;

    @media (min-width: 768px) {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  `,
  cardInfo: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    flex: 1;
  `,
  cardTitleRow: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  `,
  cardTitle: css`
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    font-size: var(--font-size-base);
    line-height: 1.25;
  `,
  workspaceBadge: css`
    font-size: 9px;
    padding: 2px var(--spacing-sm);
    border-radius: var(--border-radius-sm);
    font-weight: 800;
    color: #ffffff;
  `,
  agentBadge: css`
    font-size: 9px;
    padding: 2px var(--spacing-sm);
    border-radius: var(--border-radius-sm);
    font-weight: var(--font-weight-semibold);
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
  `,
  tagsList: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  `,
  tagItem: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    padding: 2px var(--spacing-sm);
    border-radius: var(--border-radius-full);
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
  `,
  actionsArea: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    flex-shrink: 0;
  `,
  copyBtn: css`
    display: flex;
    align-items: center;
    gap: 6px;
    background-color: var(--color-brand);
    color: #ffffff;
    padding: 6px var(--spacing-md);
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    transition: filter 0.2s ease;
    border: none;
    cursor: pointer;

    &:hover {
      filter: brightness(1.06);
    }
  `,
  actionBtn: css`
    padding: 6px;
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  deleteBtn: css`
    padding: 6px;
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background-color: rgba(248, 113, 113, 0.15);
      color: var(--color-error);
      border-color: var(--color-error);
    }
  `,
  chevronWrapper: css`
    color: var(--text-tertiary);
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.2s ease;

    &:hover {
      color: var(--text-primary);
    }
  `,
  expandedDetails: css`
    padding-left: var(--spacing-lg);
    padding-right: var(--spacing-lg);
    padding-bottom: var(--spacing-lg);
    padding-top: 4px;
    border-top: 1px solid var(--border-color);
    background-color: var(--bg-tertiary);
    animation: ${fadeIn} 0.2s ease-out;
  `,
  expandedContent: css`
    margin-top: var(--spacing-sm);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  `,
  preWrapper: css`
    position: relative;
    
    &:hover button {
      opacity: 1;
    }
  `,
  preContent: css`
    display: block;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    padding: var(--spacing-md);
    font-size: var(--font-size-xs);
    font-family: var(--font-family-mono);
    color: var(--text-primary);
    line-height: 1.625;
    overflow-x: auto;
    user-select: text;
    white-space: pre-wrap;
  `,
  inlineCopyBtn: css`
    position: absolute;
    right: var(--spacing-md);
    top: var(--spacing-md);
    opacity: 0;
    transition: opacity 0.2s ease;
    padding: var(--spacing-sm);
    border-radius: var(--border-radius-sm);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    cursor: pointer;

    &:hover {
      background-color: var(--bg-hover);
    }
  `,
  statsBar: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-lg);
    font-size: 10px;
    color: var(--text-tertiary);
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,
  statItem: css`
    display: flex;
    align-items: center;
    gap: 4px;
  `,
  modalOverlay: css`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-md);
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    animation: ${fadeIn} 0.2s ease-out;
  `,
  modalContent: css`
    width: 100%;
    max-width: 32rem;
    border-radius: var(--border-radius-lg);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-lg);
    padding: var(--spacing-xl);
    animation: ${slideUp} 0.25s ease-out;
  `,
  modalHeader: css`
    font-size: var(--font-size-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    margin-bottom: var(--spacing-md);
  `,
  modalForm: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  `,
  fieldLabel: css`
    display: block;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
    margin-bottom: 4px;
  `,
  formGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--spacing-md);
  `,
  input: css`
    width: 100%;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: var(--spacing-sm);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;

    &:focus {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 1px var(--color-brand);
    }
  `,
  textareaMono: css`
    font-family: var(--font-family-mono);
  `,
  modalActions: css`
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    padding-top: var(--spacing-sm);
  `,
  cancelBtn: css`
    background: transparent;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--border-radius-md);
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      color: var(--text-primary);
      border-color: var(--border-color-hover);
      background-color: var(--bg-hover);
    }
  `,
  submitBtn: css`
    background: var(--gradient-brand);
    color: #ffffff;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--border-radius-md);
    border: none;
    transition: filter 0.2s ease;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(123, 104, 238, 0.25);

    &:hover {
      filter: brightness(1.06);
    }
  `
};
