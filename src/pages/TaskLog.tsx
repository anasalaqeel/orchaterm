import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { TaskLog } from '../types';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui';
import {
  History,
  Search,
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle,
  Clock,
  X
} from 'lucide-react';
import { css, cx } from '@emotion/css';

export const TaskLogView: React.FC = () => {
  const {
    taskLogs,
    workspaces,
    addTaskLog,
    updateTaskLog,
    deleteTaskLog,
    showToast
  } = useDashboard();

  // Filters state
  const [filterWorkspace, setFilterWorkspace] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Confirm delete dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Add Log Dialog state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLogWorkspace, setNewLogWorkspace] = useState('');
  const [newLogSummary, setNewLogSummary] = useState('');
  const [newLogStatus, setNewLogStatus] = useState<'in-progress' | 'done' | 'blocked'>('in-progress');

  // Filter logs
  const filteredLogs = taskLogs.filter(log => {
    const matchesWorkspace = filterWorkspace === 'all' || log.workspaceId === filterWorkspace;
    const matchesQuery = searchQuery === '' || log.summary.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesWorkspace && matchesQuery;
  });

  const handleStatusChange = (id: string, currentStatus: TaskLog['status']) => {
    // Cycle status: in-progress -> done -> blocked -> in-progress
    const statusCycle: Record<TaskLog['status'], TaskLog['status']> = {
      'in-progress': 'done',
      'done': 'blocked',
      'blocked': 'in-progress'
    };
    const nextStatus = statusCycle[currentStatus];
    updateTaskLog(id, { status: nextStatus });
    showToast(`Task status toggled to: ${nextStatus}`, 'success');
  };

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLogWorkspace) {
      showToast('Please select a workspace', 'error');
      return;
    }
    if (!newLogSummary.trim()) {
      showToast('Log description is required', 'error');
      return;
    }

    addTaskLog({
      workspaceId: newLogWorkspace,
      spaceId: null,
      summary: newLogSummary,
      status: newLogStatus
    });

    setNewLogWorkspace('');
    setNewLogSummary('');
    setNewLogStatus('in-progress');
    setShowAddModal(false);
  };

  // Helper: Format ISO String to neat time
  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + 
             date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  return (
    <div className={styles.container}>
      
      {/* Header section */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.headerTitle}>Handoff & Task Logs</h2>
          <p className={styles.headerSubtitle}>Track milestones, logs, and obstacles across agent processes.</p>
        </div>
        
        <button
          onClick={() => {
            if (workspaces.length > 0) {
              setNewLogWorkspace(workspaces[0].id);
            }
            setShowAddModal(true);
          }}
          className={styles.manualEntryBtn}
        >
          <Plus className={styles.iconSm} />
          <span>Manual Entry</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className={styles.filtersBar}>
        
        {/* Workspace Selector */}
        <div className={styles.filterWrapper}>
          <Select
            label='Filter Workspace'
            value={filterWorkspace}
            onChange={setFilterWorkspace}
            options={[
              { value: 'all', name: 'All Workspaces' },
              ...workspaces.map(w => ({ value: w.id, name: w.name })),
            ]}
          />
        </div>

        {/* Keyword Search */}
        <div className={cx(styles.filterWrapper, styles.searchCol)}>
          <label className={styles.filterLabel}>Keyword Search</label>
          <div className={styles.searchInputContainer}>
            <Search className={styles.searchIcon} />
            <Input
              type="text"
              placeholder="Search details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className={styles.clearSearchBtn}>
                <X className={styles.closeIcon} />
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Logs Table Area */}
      <div className={styles.tableWrapper}>
        <div className={styles.tableResponsive}>
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeaderRow}>
                <th className={cx(styles.th, styles.thTime)}>Timestamp</th>
                <th className={styles.th}>Workspace</th>
                <th className={styles.th}>Action Summary</th>
                <th className={cx(styles.th, styles.thStatus)}>Status (Click to toggle)</th>
                <th className={cx(styles.th, styles.thAction)}></th>
              </tr>
            </thead>
            <tbody className={styles.tbody}>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.noEntriesCell}>
                    <History className={styles.historyIcon} />
                    <p className={styles.noEntriesTitle}>No log entries found</p>
                    <p className={styles.noEntriesSubtitle}>Try resetting the workspace / agent filters or create a new entry.</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const workspaceObj = workspaces.find(w => w.id === log.workspaceId);

                  return (
                    <tr
                      key={log.id}
                      className={styles.tableRow}
                    >
                      {/* Timestamp */}
                      <td className={styles.tdTimeVal}>
                        {formatTime(log.timestamp)}
                      </td>

                      {/* Workspace Name */}
                      <td className={styles.tdWorkspace}>
                        {workspaceObj ? (
                          <span className={styles.flexCenterGap8}>
                            <span
                              className={styles.workspaceDot}
                              style={{ backgroundColor: workspaceObj.color }}
                            />
                            <span>{workspaceObj.name}</span>
                          </span>
                        ) : (
                          <span className={styles.unknownText}>Unknown Workspace</span>
                        )}
                      </td>

                      {/* Summary text */}
                      <td className={styles.tdSummary}>
                        {log.summary}
                      </td>

                      {/* Status Toggle Button */}
                      <td className={styles.tdStatusVal}>
                        <button
                          onClick={() => handleStatusChange(log.id, log.status)}
                          className={cx(
                            styles.statusBtn,
                            log.status === 'done' && styles.statusDone,
                            log.status === 'blocked' && styles.statusBlocked,
                            log.status === 'in-progress' && styles.statusInProgress
                          )}
                        >
                          {log.status === 'done' ? (
                            <CheckCircle className={styles.statusIcon} />
                          ) : log.status === 'blocked' ? (
                            <AlertTriangle className={styles.statusIcon} />
                          ) : (
                            <Clock className={styles.spinIcon} />
                          )}
                          <span>{log.status}</span>
                        </button>
                      </td>

                      {/* Delete Action */}
                      <td className={styles.tdActionVal}>
                        <button
                          onClick={() => {
                            setPendingDeleteId(log.id);
                            setConfirmOpen(true);
                          }}
                          className={cx(styles.deleteBtn, 'delete-btn')}
                          title="Delete Entry"
                        >
                          <Trash2 className={styles.deleteIcon} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DELETE CONFIRM DIALOG */}
      <ConfirmDialog
        isOpen={confirmOpen}
        message="Delete this log entry permanently?"
        onConfirm={() => {
          if (pendingDeleteId) deleteTaskLog(pendingDeleteId);
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
      />

      {/* MANUAL ENTRY MODAL */}
      {showAddModal && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalContainer}>
            <h3 className={styles.modalTitle}>Add Log Entry</h3>
            <form onSubmit={handleManualAdd} className={styles.modalForm}>
              <div>
                <Select
                  label='Select Workspace'
                  value={newLogWorkspace}
                  onChange={setNewLogWorkspace}
                  options={[
                    { value: '', name: '— Select Workspace —' },
                    ...workspaces.map(w => ({ value: w.id, name: w.name })),
                  ]}
                />
              </div>

              <div>
                <Select
                  label='Status'
                  value={newLogStatus}
                  onChange={v => setNewLogStatus(v as TaskLog['status'])}
                  options={[
                    { value: 'in-progress', name: 'In Progress' },
                    { value: 'done',        name: 'Completed'   },
                    { value: 'blocked',     name: 'Blocked'     },
                  ]}
                />
              </div>

              <div>
                <label className={styles.modalLabel}>Log Description / Summary</label>
                <textarea
                  placeholder="e.g. Added login hooks, fixed database query crash..."
                  value={newLogSummary}
                  onChange={(e) => setNewLogSummary(e.target.value)}
                  rows={3}
                  className={styles.modalTextarea}
                  required
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={styles.modalCancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.modalSubmitBtn}
                >
                  Save Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

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
  `,

  headerTitle: css`
    font-size: var(--font-size-3xl);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.025em;
    color: var(--text-primary);
  `,

  headerSubtitle: css`
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  `,

  manualEntryBtn: css`
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--gradient-brand);
    color: #ffffff;
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    border: none;
    font-size: var(--font-size-sm);
    font-weight: 600;
    transition: all 0.2s ease-in-out;
    box-shadow: 0 4px 14px rgba(123, 104, 238, 0.3);
    cursor: pointer;

    &:hover {
      filter: brightness(1.06);
      transform: scale(1.02);
    }
  `,

  iconSm: css`
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  `,

  filtersBar: css`
    display: grid;
    grid-template-columns: repeat(1, minmax(0, 1fr));
    gap: var(--spacing-md);
    padding: 20px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);

    @media (min-width: 768px) {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  `,

  filterWrapper: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,

  filterLabel: css`
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: block;
  `,


  searchCol: css`
    @media (min-width: 768px) {
      grid-column: span 2 / span 2;
    }
  `,

  searchInputContainer: css`
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 6px 12px;
    transition: border-color 0.15s ease;

    &:focus-within {
      border-color: var(--color-brand);
    }
  `,

  searchIcon: css`
    width: 16px;
    height: 16px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  `,

  searchInput: css`
    background: transparent;
    border: none;
    outline: none;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    width: 100%;

    &::placeholder {
      color: var(--text-tertiary);
    }
  `,

  clearSearchBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
    transition: color 0.15s ease;

    &:hover {
      color: var(--text-primary);
    }
  `,

  closeIcon: css`
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  `,

  tableWrapper: css`
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    overflow: hidden;
    background-color: var(--bg-secondary);
    box-shadow: var(--shadow-md);
  `,

  tableResponsive: css`
    overflow-x: auto;
  `,

  table: css`
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: var(--font-size-xs);
  `,

  tableHeaderRow: css`
    border-bottom: 1px solid var(--border-color);
    background-color: var(--bg-tertiary);
    color: var(--text-secondary);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,

  th: css`
    padding: 16px;
  `,

  thTime: css`
    width: 176px;
  `,

  thStatus: css`
    width: 128px;
    text-align: center;
  `,

  thAction: css`
    width: 64px;
  `,

  tbody: css`
    /* Row dividers handled at the row level to avoid layout quirks */
  `,

  noEntriesCell: css`
    padding: 48px;
    text-align: center;
    color: var(--text-tertiary);
  `,

  historyIcon: css`
    width: 32px;
    height: 32px;
    color: var(--text-tertiary);
    margin: 0 auto 8px auto;
    opacity: 0.5;
    display: block;
  `,

  noEntriesTitle: css`
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  `,

  noEntriesSubtitle: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin-top: 4px;
  `,

  tableRow: css`
    border-bottom: 1px solid var(--border-color);
    transition: background-color 0.15s ease;

    &:last-child {
      border-bottom: none;
    }

    &:hover {
      background-color: var(--bg-hover);
    }

    &:hover .delete-btn {
      opacity: 1;
    }
  `,

  tdTimeVal: css`
    padding: 16px;
    font-family: var(--font-family-mono);
    color: var(--text-secondary);
    white-space: nowrap;
  `,

  tdWorkspace: css`
    padding: 16px;
    font-weight: 600;
    color: var(--text-primary);
  `,

  flexCenterGap8: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,

  workspaceDot: css`
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  `,

  unknownText: css`
    color: var(--text-tertiary);
    font-style: italic;
  `,

  tdAgent: css`
    padding: 16px;
    color: var(--text-secondary);
  `,

  flexCenterGap6: css`
    display: flex;
    align-items: center;
    gap: 6px;
  `,

  agentDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  `,

  tdSummary: css`
    padding: 16px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.625;
    max-width: 384px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    tr:hover & {
      text-overflow: clip;
      white-space: normal;
    }
  `,

  tdStatusVal: css`
    padding: 16px;
    text-align: center;
  `,

  statusBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    border-radius: var(--border-radius-full);
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    transition: all 0.15s ease;
    border: 1px solid transparent;
    cursor: pointer;
    background: transparent;

    &:hover {
      transform: scale(1.05);
    }

    &:active {
      transform: scale(0.95);
    }
  `,

  statusDone: css`
    background-color: rgba(52, 211, 153, 0.1);
    color: var(--color-success);
    border-color: rgba(52, 211, 153, 0.2);
  `,

  statusBlocked: css`
    background-color: rgba(248, 113, 113, 0.1);
    color: var(--color-error);
    border-color: rgba(248, 113, 113, 0.2);
    animation: status-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;

    @keyframes status-pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: .5;
      }
    }
  `,

  statusInProgress: css`
    background-color: rgba(129, 140, 248, 0.1);
    color: var(--color-info);
    border-color: rgba(129, 140, 248, 0.2);
  `,

  statusIcon: css`
    width: 12px;
    height: 12px;
  `,

  spinIcon: css`
    width: 12px;
    height: 12px;
    animation: spin 3s linear infinite;

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
  `,

  tdActionVal: css`
    padding: 16px;
    text-align: right;
  `,

  deleteBtn: css`
    padding: 6px;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    opacity: 0;
    transition: all 0.15s ease-in-out;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;

    &:hover {
      background-color: rgba(248, 113, 113, 0.15);
      color: var(--color-error);
    }
  `,

  deleteIcon: css`
    width: 14px;
    height: 14px;
  `,

  modalBackdrop: css`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    animation: fade-in 0.2s ease-out forwards;

    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `,

  modalContainer: css`
    width: 100%;
    max-width: 448px;
    border-radius: var(--border-radius-lg);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    box-shadow: var(--shadow-lg);
    padding: 24px;
    animation: slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;

    @keyframes slide-up {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `,

  modalTitle: css`
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 16px;
  `,

  modalForm: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,

  modalLabel: css`
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 4px;
  `,


  modalTextarea: css`
    width: 100%;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 8px;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    outline: none;
    resize: vertical;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    &:focus {
      border-color: var(--color-brand);
      box-shadow: 0 0 0 1px var(--color-brand);
    }
  `,

  modalActions: css`
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 8px;
  `,

  modalCancelBtn: css`
    background: transparent;
    font-size: 12px;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      color: var(--text-primary);
      border-color: var(--border-color-hover);
      background-color: var(--bg-hover);
    }
  `,

  modalSubmitBtn: css`
    background: var(--gradient-brand);
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: filter 0.15s ease;
    box-shadow: 0 4px 12px rgba(123, 104, 238, 0.25);

    &:hover {
      filter: brightness(1.06);
    }
  `
};
