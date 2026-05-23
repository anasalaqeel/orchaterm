import React, { useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { TaskLog } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
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
    agents, 
    addTaskLog, 
    updateTaskLog, 
    deleteTaskLog,
    showToast 
  } = useDashboard();

  // Filters state
  const [filterWorkspace, setFilterWorkspace] = useState<string>('all');
  const [filterAgent, setFilterAgent] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Confirm delete dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Add Log Dialog state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLogWorkspace, setNewLogWorkspace] = useState('');
  const [newLogAgent, setNewLogAgent] = useState('');
  const [newLogSummary, setNewLogSummary] = useState('');
  const [newLogStatus, setNewLogStatus] = useState<'in-progress' | 'done' | 'blocked'>('in-progress');

  // Filter logs
  const filteredLogs = taskLogs.filter(log => {
    const matchesWorkspace = filterWorkspace === 'all' || log.workspaceId === filterWorkspace;
    const matchesAgent = filterAgent === 'all' || log.agentId === filterAgent;
    const matchesQuery = searchQuery === '' || log.summary.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesWorkspace && matchesAgent && matchesQuery;
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
      agentId: newLogAgent || '',
      summary: newLogSummary,
      status: newLogStatus
    });

    setNewLogWorkspace('');
    setNewLogAgent('');
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
              if (workspaces[0].agentId) setNewLogAgent(workspaces[0].agentId);
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
          <label className={styles.filterLabel}>Filter Workspace</label>
          <select
            value={filterWorkspace}
            onChange={(e) => setFilterWorkspace(e.target.value)}
            className={styles.selectInput}
          >
            <option value="all">All Workspaces</option>
            {workspaces.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        {/* Agent Selector */}
        <div className={styles.filterWrapper}>
          <label className={styles.filterLabel}>Filter Agent</label>
          <select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            className={styles.selectInput}
          >
            <option value="all">All Agents</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* Keyword Search */}
        <div className={cx(styles.filterWrapper, styles.searchCol)}>
          <label className={styles.filterLabel}>Keyword Search</label>
          <div className={styles.searchInputContainer}>
            <Search className={styles.searchIcon} />
            <input
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
                <th className={styles.th}>Agent Source</th>
                <th className={styles.th}>Action Summary</th>
                <th className={cx(styles.th, styles.thStatus)}>Status (Click to toggle)</th>
                <th className={cx(styles.th, styles.thAction)}></th>
              </tr>
            </thead>
            <tbody className={styles.tbody}>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.noEntriesCell}>
                    <History className={styles.historyIcon} />
                    <p className={styles.noEntriesTitle}>No log entries found</p>
                    <p className={styles.noEntriesSubtitle}>Try resetting the workspace / agent filters or create a new entry.</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const workspaceObj = workspaces.find(w => w.id === log.workspaceId);
                  const agentObj = agents.find(a => a.id === log.agentId);

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

                      {/* Agent Name */}
                      <td className={styles.tdAgent}>
                        {agentObj ? (
                          <span className={styles.flexCenterGap6}>
                            <span className={styles.agentDot} style={{ backgroundColor: agentObj.color }} />
                            <span>{agentObj.name}</span>
                          </span>
                        ) : (
                          <span className={styles.unknownText}>Manual User Entry</span>
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
                <label className={styles.modalLabel}>Select Workspace</label>
                <select
                  value={newLogWorkspace}
                  onChange={(e) => {
                    setNewLogWorkspace(e.target.value);
                    const selected = workspaces.find(w => w.id === e.target.value);
                    if (selected && selected.agentId) {
                      setNewLogAgent(selected.agentId);
                    } else {
                      setNewLogAgent('');
                    }
                  }}
                  className={styles.modalSelect}
                  required
                >
                  <option value="" disabled>-- Select Workspace --</option>
                  {workspaces.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={styles.modalLabel}>Select Agent Source</label>
                <select
                  value={newLogAgent}
                  onChange={(e) => setNewLogAgent(e.target.value)}
                  className={styles.modalSelect}
                >
                  <option value="">Manual Entry (No Agent)</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={styles.modalLabel}>Status</label>
                <select
                  value={newLogStatus}
                  onChange={(e) => setNewLogStatus(e.target.value as TaskLog['status'])}
                  className={styles.modalSelect}
                >
                  <option value="in-progress">In Progress</option>
                  <option value="done">Completed</option>
                  <option value="blocked">Blocked</option>
                </select>
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
    background-color: rgba(2, 6, 23, 0.2);

    body.light & {
      background-color: rgba(248, 250, 252, 0.5);
    }
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
    font-size: 14px;
    color: #94a3b8;

    body.light & {
      color: #64748b;
    }
  `,

  manualEntryBtn: css`
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: #2563eb;
    color: #ffffff;
    padding: 8px 16px;
    border-radius: var(--border-radius-sm);
    border: none;
    font-size: 14px;
    font-weight: 600;
    transition: all 0.2s ease-in-out;
    box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.2);
    cursor: pointer;

    &:hover {
      background-color: #3b82f6;
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
    background-color: rgba(15, 23, 42, 0.4);
    border: 1px solid rgba(30, 41, 59, 0.4);
    border-radius: 12px;

    body.light & {
      background-color: #ffffff;
      border-color: #e2e8f0;
    }

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
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: block;
  `,

  selectInput: css`
    width: 100%;
    background-color: #020617;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 8px;
    font-size: 12px;
    color: #cbd5e1;
    outline: none;
    transition: border-color 0.15s ease;

    &:focus {
      border-color: var(--color-primary);
    }

    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #1e293b;
    }
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
    background-color: #020617;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 6px 12px;
    transition: border-color 0.15s ease;

    &:focus-within {
      border-color: var(--color-primary);
    }

    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
    }
  `,

  searchIcon: css`
    width: 16px;
    height: 16px;
    color: #64748b;
    flex-shrink: 0;
  `,

  searchInput: css`
    background: transparent;
    border: none;
    outline: none;
    font-size: 12px;
    color: #e2e8f0;
    width: 100%;

    &::placeholder {
      color: #64748b;
    }

    body.light & {
      color: #0f172a;
    }
  `,

  clearSearchBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    color: #64748b;
    transition: color 0.15s ease;

    &:hover {
      color: #cbd5e1;
    }

    body.light & {
      &:hover {
        color: #1e293b;
      }
    }
  `,

  closeIcon: css`
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  `,

  tableWrapper: css`
    border: 1px solid rgba(30, 41, 59, 0.6);
    border-radius: 12px;
    overflow: hidden;
    background-color: rgba(15, 23, 42, 0.2);
    backdrop-filter: blur(12px);
    box-shadow: var(--shadow-lg);

    body.light & {
      border-color: #e2e8f0;
      background-color: #ffffff;
    }
  `,

  tableResponsive: css`
    overflow-x: auto;
  `,

  table: css`
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 12px;
  `,

  tableHeaderRow: css`
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background-color: rgba(2, 6, 23, 0.5);
    color: #94a3b8;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;

    body.light & {
      background-color: #f8fafc;
      border-bottom-color: #e2e8f0;
      color: #475569;
    }
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
    color: #64748b;
  `,

  historyIcon: css`
    width: 32px;
    height: 32px;
    color: #475569;
    margin: 0 auto 8px auto;
    opacity: 0.5;
    display: block;
  `,

  noEntriesTitle: css`
    font-weight: 600;
    color: #94a3b8;
    margin: 0;
  `,

  noEntriesSubtitle: css`
    font-size: 11px;
    color: #64748b;
    margin-top: 4px;
  `,

  tableRow: css`
    border-bottom: 1px solid rgba(30, 41, 59, 0.3);
    transition: background-color 0.15s ease;

    body.light & {
      border-bottom-color: #f1f5f9;
    }

    &:last-child {
      border-bottom: none;
    }

    &:hover {
      background-color: rgba(15, 23, 42, 0.2);
    }

    body.light & {
      &:hover {
        background-color: rgba(241, 245, 249, 0.5);
      }
    }

    &:hover .delete-btn {
      opacity: 1;
    }
  `,

  tdTimeVal: css`
    padding: 16px;
    font-family: var(--font-family-mono);
    color: #64748b;
    white-space: nowrap;
  `,

  tdWorkspace: css`
    padding: 16px;
    font-weight: 600;
    color: #cbd5e1;

    body.light & {
      color: #1e293b;
    }
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
    color: #64748b;
    font-style: italic;
  `,

  tdAgent: css`
    padding: 16px;
    color: #94a3b8;

    body.light & {
      color: #475569;
    }
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
    color: #cbd5e1;
    line-height: 1.625;
    max-width: 384px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    body.light & {
      color: #334155;
    }

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
    background-color: rgba(16, 185, 129, 0.1);
    color: #34d399;
    border-color: rgba(16, 185, 129, 0.2);

    body.light & {
      background-color: rgba(16, 185, 129, 0.15);
      color: #059669;
      border-color: rgba(16, 185, 129, 0.25);
    }
  `,

  statusBlocked: css`
    background-color: rgba(244, 63, 94, 0.1);
    color: #f43f5e;
    border-color: rgba(244, 63, 94, 0.2);
    animation: status-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;

    @keyframes status-pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: .5;
      }
    }

    body.light & {
      background-color: rgba(225, 29, 72, 0.15);
      color: #e11d48;
      border-color: rgba(225, 29, 72, 0.25);
    }
  `,

  statusInProgress: css`
    background-color: rgba(59, 130, 246, 0.1);
    color: #60a5fa;
    border-color: rgba(59, 130, 246, 0.2);

    body.light & {
      background-color: rgba(37, 99, 235, 0.15);
      color: #2563eb;
      border-color: rgba(37, 99, 235, 0.25);
    }
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
    color: #64748b;
    opacity: 0;
    transition: all 0.15s ease-in-out;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background-color: rgba(136, 19, 55, 0.2);
      color: #f43f5e;
    }

    body.light & {
      &:hover {
        background-color: #fff1f2;
      }
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
    background-color: rgba(2, 6, 23, 0.8);
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
    border-radius: 12px;
    background-color: #0f172a;
    border: 1px solid #1e293b;
    box-shadow: 0 0 25px rgba(59, 130, 246, 0.15), var(--shadow-lg);
    padding: 24px;
    animation: slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;

    @keyframes slide-up {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    body.light & {
      background-color: #ffffff;
      border-color: #e2e8f0;
    }
  `,

  modalTitle: css`
    font-size: 18px;
    font-weight: 700;
    color: #f8fafc;
    margin-bottom: 16px;

    body.light & {
      color: #0f172a;
    }
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
    color: #94a3b8;
    margin-bottom: 4px;
  `,

  modalSelect: css`
    width: 100%;
    background-color: #020617;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 8px;
    font-size: 14px;
    color: #cbd5e1;
    outline: none;
    transition: border-color 0.15s ease;

    &:focus {
      border-color: var(--color-primary);
    }

    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #0f172a;
    }
  `,

  modalTextarea: css`
    width: 100%;
    background-color: #020617;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 8px;
    font-size: 14px;
    color: #e2e8f0;
    outline: none;
    resize: vertical;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    &:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 1px #3b82f6;
    }

    body.light & {
      background-color: #f8fafc;
      border-color: #cbd5e1;
      color: #0f172a;
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
    color: #94a3b8;
    border: 1px solid #1e293b;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      color: #e2e8f0;
      border-color: #334155;
    }

    body.light & {
      border-color: #cbd5e1;
      color: #475569;

      &:hover {
        border-color: #94a3b8;
        color: #0f172a;
      }
    }
  `,

  modalSubmitBtn: css`
    background-color: #2563eb;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 16px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: background-color 0.15s ease;

    &:hover {
      background-color: #3b82f6;
    }
  `
};
