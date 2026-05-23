import React, { useState } from 'react';
import { css, cx, keyframes } from '@emotion/css';
import { useDashboard } from '../context/DashboardContext';
import { Agent } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { 
  Terminal, 
  Globe, 
  Cpu, 
  Play, 
  Plus, 
  Edit2, 
  Trash2, 
  Search,
  ExternalLink
} from 'lucide-react';

export const AgentsView: React.FC = () => {
  const { 
    agents, 
    addAgent, 
    updateAgent, 
    deleteAgent, 
    launchAgent,
    showToast 
  } = useDashboard();

  // Search filter state
  const [search, setSearch] = useState('');

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // Confirm delete dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteName, setPendingDeleteName] = useState('');

  // Form states
  const [name, setName] = useState('');
  const [type, setType] = useState<'terminal' | 'web' | 'ide-plugin' | 'other'>('terminal');
  const [launchUrl, setLaunchUrl] = useState('');
  const [launchCommand, setLaunchCommand] = useState('');
  const [bestUsedFor, setBestUsedFor] = useState('');
  const [color, setColor] = useState('#3b82f6');

  // Filter agents
  const filteredAgents = agents.filter(agent => 
    agent.name.toLowerCase().includes(search.toLowerCase()) ||
    agent.bestUsedFor.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => {
    setName('');
    setType('terminal');
    setLaunchUrl('');
    setLaunchCommand('');
    setBestUsedFor('');
    setColor('#3b82f6');
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Agent name is required', 'error');
      return;
    }

    addAgent({
      name,
      type,
      launchUrl: type === 'web' ? launchUrl.trim() : null,
      launchCommand: type === 'terminal' ? launchCommand.trim() : null,
      bestUsedFor,
      color,
      assignedWorkspaceId: null
    });

    resetForm();
    setShowAddModal(false);
  };

  const handleEditClick = (agent: Agent) => {
    setEditingAgent(agent);
    setName(agent.name);
    setType(agent.type);
    setLaunchUrl(agent.launchUrl || '');
    setLaunchCommand(agent.launchCommand || '');
    setBestUsedFor(agent.bestUsedFor || '');
    setColor(agent.color || '#3b82f6');
    setShowEditModal(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent) return;
    if (!name.trim()) {
      showToast('Agent name is required', 'error');
      return;
    }

    updateAgent(editingAgent.id, {
      name,
      type,
      launchUrl: type === 'web' ? launchUrl.trim() : null,
      launchCommand: type === 'terminal' ? launchCommand.trim() : null,
      bestUsedFor,
      color
    });

    setEditingAgent(null);
    resetForm();
    setShowEditModal(false);
    showToast('Agent configuration updated', 'success');
  };

  const handleDeleteClick = (id: string, name: string) => {
    setPendingDeleteId(id);
    setPendingDeleteName(name);
    setConfirmOpen(true);
  };

  return (
    <div className={styles.container}>
      
      {/* Header section */}
      <div className={styles.headerSection}>
        <div>
          <h2 className={styles.headerTitle}>Agent Registry</h2>
          <p className={styles.headerDesc}>Configure orchestrators, local binaries, or web coding environments.</p>
        </div>
        
        <button
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className={styles.registerButton}
        >
          <Plus className={styles.icon16} />
          <span>Register Agent</span>
        </button>
      </div>

      {/* Search Filter and Stats */}
      <div className={styles.filterBar}>
        <div className={styles.searchInputWrapper}>
          <Search className={cx(styles.icon16, styles.searchInputIcon)} />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <div className={styles.filterStats}>
          Showing {filteredAgents.length} of {agents.length} Agents
        </div>
      </div>

      {/* Agents Card Grid */}
      {filteredAgents.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyStateTitle}>No agents found matching your query.</p>
          <p className={styles.emptyStateSub}>Add a new agent above or adjust your search filters.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredAgents.map((agent) => {
            return (
              <div
                key={agent.id}
                className={styles.card}
              >
                {/* Left boundary accent bar */}
                <div 
                  className={styles.cardAccentBar}
                  style={{ backgroundColor: agent.color || '#3b82f6' }}
                />

                {/* Card Content */}
                <div>
                  <div className={styles.cardHeader}>
                    <div className={styles.cardHeaderLeft}>
                      {agent.type === 'terminal' ? (
                        <div className={styles.iconTerminal}>
                          <Terminal className={styles.icon20} />
                        </div>
                      ) : agent.type === 'web' ? (
                        <div className={styles.iconWeb}>
                          <Globe className={styles.icon20} />
                        </div>
                      ) : (
                        <div className={styles.iconOther}>
                          <Cpu className={styles.icon20} />
                        </div>
                      )}
                      <div>
                        <h4 className={styles.cardTitle}>{agent.name}</h4>
                        <span className={styles.cardSubtitle}>{agent.type}</span>
                      </div>
                    </div>

                    <div className={styles.cardActions}>
                      <button
                        onClick={() => handleEditClick(agent)}
                        className={styles.actionBtnEdit}
                        title="Edit Configuration"
                      >
                        <Edit2 className={styles.icon14} />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(agent.id, agent.name)}
                        className={styles.actionBtnDelete}
                        title="Delete Agent"
                      >
                        <Trash2 className={styles.icon14} />
                      </button>
                    </div>
                  </div>

                  <div className={styles.cardBody}>
                    <div>
                      <span className={styles.bodyLabel}>
                        Best Used For
                      </span>
                      <p className={styles.bodyText}>
                        {agent.bestUsedFor || 'No specific usage constraints.'}
                      </p>
                    </div>

                    {agent.type === 'terminal' && agent.launchCommand && (
                      <div>
                        <span className={styles.bodyLabel}>
                          Binary Launch Command
                        </span>
                        <code className={styles.codeBlock}>
                          {agent.launchCommand}
                        </code>
                      </div>
                    )}

                    {agent.type === 'web' && agent.launchUrl && (
                      <div>
                        <span className={styles.bodyLabel}>
                          External Browser Endpoint
                        </span>
                        <span className={styles.webEndpointLink}>
                          <ExternalLink className={cx(styles.icon12, styles.webEndpointIcon)} />
                          <span className={styles.truncateText}>{agent.launchUrl}</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Launch Button Trigger */}
                <div className={styles.cardFooter}>
                  <button
                    onClick={() => launchAgent(agent.id)}
                    className={styles.launchBtn}
                  >
                    <Play className={cx(styles.icon14, styles.playIcon)} />
                    <span>Launch Service Window</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DELETE CONFIRM DIALOG */}
      <ConfirmDialog
        isOpen={confirmOpen}
        message={`Delete agent "${pendingDeleteName}"? This cannot be undone.`}
        onConfirm={() => {
          if (pendingDeleteId) deleteAgent(pendingDeleteId);
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
      />

      {/* ADD AGENT MODAL */}
      {showAddModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Register New Developer Agent</h3>
            <form onSubmit={handleAddSubmit} className={styles.form}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Agent Name</label>
                <input
                  type="text"
                  placeholder="e.g. Claude Code, Cursor CLI"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={styles.input}
                  required
                />
              </div>

              <div className={styles.gridTwoCols}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Agent Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as Agent['type'])}
                    className={styles.select}
                  >
                    <option value="terminal">Terminal Binary</option>
                    <option value="web">Web Browser Page</option>
                    <option value="ide-plugin">IDE Plugin</option>
                    <option value="other">Other Service</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Accent Theme</label>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className={styles.colorInput}
                  />
                </div>
              </div>

              {type === 'terminal' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Terminal Launch command</label>
                  <input
                    type="text"
                    placeholder="e.g. claude, antigravity analyze"
                    value={launchCommand}
                    onChange={(e) => setLaunchCommand(e.target.value)}
                    className={styles.input}
                    required
                  />
                  <p className={styles.helpText}>Command will run in standard system prompt cmd.exe on launch.</p>
                </div>
              )}

              {type === 'web' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Browser Launch URL</label>
                  <input
                    type="url"
                    placeholder="https://localhost:3000 or https://dev.agent"
                    value={launchUrl}
                    onChange={(e) => setLaunchUrl(e.target.value)}
                    className={styles.input}
                    required
                  />
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Best Used For</label>
                <textarea
                  placeholder="e.g. Workspace question answering, fast refactoring..."
                  value={bestUsedFor}
                  onChange={(e) => setBestUsedFor(e.target.value)}
                  rows={2}
                  className={styles.textarea}
                />
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={styles.btnCancel}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.btnSubmit}
                >
                  Register Agent
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT AGENT MODAL */}
      {showEditModal && editingAgent && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Modify Agent Settings</h3>
            <form onSubmit={handleEditSubmit} className={styles.form}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Agent Name</label>
                <input
                  type="text"
                  placeholder="Agent Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={styles.input}
                  required
                />
              </div>

              <div className={styles.gridTwoCols}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Agent Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as Agent['type'])}
                    className={styles.select}
                  >
                    <option value="terminal">Terminal Binary</option>
                    <option value="web">Web Browser Page</option>
                    <option value="ide-plugin">IDE Plugin</option>
                    <option value="other">Other Service</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Accent Theme</label>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className={styles.colorInput}
                  />
                </div>
              </div>

              {type === 'terminal' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Terminal Launch command</label>
                  <input
                    type="text"
                    value={launchCommand}
                    onChange={(e) => setLaunchCommand(e.target.value)}
                    className={styles.input}
                    required
                  />
                </div>
              )}

              {type === 'web' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Browser Launch URL</label>
                  <input
                    type="url"
                    value={launchUrl}
                    onChange={(e) => setLaunchUrl(e.target.value)}
                    className={styles.input}
                    required
                  />
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Best Used For</label>
                <textarea
                  placeholder="Agent characteristics description..."
                  value={bestUsedFor}
                  onChange={(e) => setBestUsedFor(e.target.value)}
                  rows={2}
                  className={styles.textarea}
                />
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => {
                    setEditingAgent(null);
                    setShowEditModal(false);
                  }}
                  className={styles.btnCancel}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.btnSubmit}
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
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const slideUp = keyframes`
  from {
    transform: translateY(16px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
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
  headerSection: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  headerTitle: css`
    font-size: var(--font-size-3xl);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.025em;
    color: var(--text-primary);
    margin: 0;
  `,
  headerDesc: css`
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin-top: var(--spacing-xs);
  `,
  registerButton: css`
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-sm);
    background-color: var(--color-primary);
    color: var(--text-inverse);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    border: none;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.2);

    &:hover {
      transform: translateY(-1px) scale(1.02);
      box-shadow: 0 6px 16px rgba(var(--color-primary-rgb), 0.3);
      filter: brightness(1.1);
    }
    
    &:active {
      transform: translateY(0) scale(0.98);
    }
  `,
  filterBar: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    align-items: center;
    justify-content: space-between;
    background-color: var(--bg-secondary);
    padding: var(--spacing-md);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);

    @media (min-width: 640px) {
      flex-direction: row;
    }
  `,
  searchInputWrapper: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px 12px;
    width: 100%;

    @media (min-width: 640px) {
      max-width: 20rem;
    }

    &:focus-within {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.2);
    }
  `,
  searchInputIcon: css`
    color: var(--text-tertiary);
  `,
  searchInput: css`
    background: transparent;
    border: none;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    width: 100%;
    outline: none;

    &::placeholder {
      color: var(--text-tertiary);
    }
  `,
  filterStats: css`
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  `,
  emptyState: css`
    padding: 4rem;
    text-align: center;
    border: 1px dashed var(--border-color);
    border-radius: var(--border-radius-lg);
    background-color: var(--bg-secondary);
  `,
  emptyStateTitle: css`
    color: var(--text-secondary);
    margin-bottom: var(--spacing-xs);
    font-size: var(--font-size-base);
  `,
  emptyStateSub: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  `,
  grid: css`
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--spacing-lg);

    @media (min-width: 768px) {
      grid-template-columns: repeat(2, 1fr);
    }

    @media (min-width: 1280px) {
      grid-template-columns: repeat(3, 1fr);
    }
  `,
  card: css`
    position: relative;
    border-radius: var(--border-radius-lg);
    border: 1px solid var(--border-color);
    background-color: var(--bg-secondary);
    padding: var(--spacing-lg);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: var(--shadow-sm);

    &:hover {
      transform: translateY(-2px);
      border-color: rgba(59, 130, 246, 0.4);
      box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.3), 0 0 16px rgba(59, 130, 246, 0.15);
    }
  `,
  cardAccentBar: css`
    position: absolute;
    left: 0;
    top: var(--spacing-lg);
    bottom: var(--spacing-lg);
    width: 4px;
    border-top-right-radius: var(--border-radius-sm);
    border-bottom-right-radius: var(--border-radius-sm);
  `,
  cardHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-md);
  `,
  cardHeaderLeft: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  `,
  iconTerminal: css`
    padding: var(--spacing-sm);
    border-radius: var(--border-radius-sm);
    background-color: rgba(var(--color-warning-rgb), 0.1);
    color: var(--color-warning);
    display: flex;
    align-items: center;
    justify-content: center;
  `,
  iconWeb: css`
    padding: var(--spacing-sm);
    border-radius: var(--border-radius-sm);
    background-color: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
    display: flex;
    align-items: center;
    justify-content: center;

    [data-theme="dark"] & {
      color: #60a5fa;
    }
  `,
  iconOther: css`
    padding: var(--spacing-sm);
    border-radius: var(--border-radius-sm);
    background-color: rgba(var(--color-success-rgb), 0.1);
    color: var(--color-success);
    display: flex;
    align-items: center;
    justify-content: center;
  `,
  cardTitle: css`
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    font-size: var(--font-size-base);
    line-height: 1.25;
    margin: 0;
  `,
  cardSubtitle: css`
    font-size: 10px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: var(--font-weight-semibold);
    display: block;
  `,
  cardActions: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  `,
  actionBtnEdit: css`
    padding: 6px;
    border-radius: var(--border-radius-sm);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;

    &:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  actionBtnDelete: css`
    padding: 6px;
    border-radius: var(--border-radius-sm);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;

    &:hover {
      background-color: rgba(239, 68, 68, 0.15);
      color: var(--color-error);
    }
  `,
  cardBody: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    font-size: var(--font-size-xs);
  `,
  bodyLabel: css`
    font-size: 10px;
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: block;
    margin-bottom: var(--spacing-xs);
  `,
  bodyText: css`
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
    line-height: 1.625;
    margin: 0;
  `,
  codeBlock: css`
    display: block;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: var(--spacing-sm);
    font-size: 10px;
    font-family: var(--font-family-mono);
    color: var(--color-warning);
    word-break: break-all;
  `,
  webEndpointLink: css`
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    font-size: 10px;
    font-family: var(--font-family-mono);
    color: #3b82f6;
    word-break: break-all;

    [data-theme="dark"] & {
      color: #60a5fa;
    }
  `,
  webEndpointIcon: css`
    color: #3b82f6;

    [data-theme="dark"] & {
      color: #60a5fa;
    }
  `,
  truncateText: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  cardFooter: css`
    border-top: 1px solid var(--border-color);
    padding-top: var(--spacing-md);
    margin-top: var(--spacing-lg);
  `,
  launchBtn: css`
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-xs);
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      background-color: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  playIcon: css`
    color: var(--color-success);
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
    background-color: rgba(2, 6, 23, 0.7);
    backdrop-filter: blur(4px);
    animation: ${fadeIn} 0.2s ease-out forwards;
  `,
  modalContent: css`
    width: 100%;
    max-width: 28rem;
    border-radius: var(--border-radius-lg);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-lg), 0 0 20px rgba(59, 130, 246, 0.15);
    padding: var(--spacing-lg);
    animation: ${slideUp} 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  `,
  modalTitle: css`
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    margin-bottom: var(--spacing-md);
  `,
  form: css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  `,
  formGroup: css`
    display: flex;
    flex-direction: column;
  `,
  formLabel: css`
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
    margin-bottom: var(--spacing-xs);
  `,
  input: css`
    width: 100%;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px var(--spacing-sm);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;

    &:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.2);
    }
  `,
  select: css`
    width: 100%;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px var(--spacing-sm);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    cursor: pointer;

    &:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.2);
    }
  `,
  colorInput: css`
    width: 100%;
    height: 36px;
    background: transparent;
    border: none;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
  `,
  textarea: css`
    width: 100%;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px var(--spacing-sm);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    resize: vertical;

    &:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.2);
    }
  `,
  helpText: css`
    font-size: 10px;
    color: var(--text-tertiary);
    margin-top: var(--spacing-xs);
  `,
  gridTwoCols: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-md);
  `,
  modalFooter: css`
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    padding-top: var(--spacing-sm);
  `,
  btnCancel: css`
    background-color: transparent;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      border-color: var(--border-color-hover);
      color: var(--text-primary);
      background-color: var(--bg-hover);
    }
  `,
  btnSubmit: css`
    background-color: var(--color-primary);
    color: var(--text-inverse);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    border: none;
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      filter: brightness(1.1);
    }
  `,
  icon12: css`
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  `,
  icon14: css`
    width: 14px;
    height: 14px;
  `,
  icon16: css`
    width: 16px;
    height: 16px;
  `,
  icon20: css`
    width: 20px;
    height: 20px;
  `
};
