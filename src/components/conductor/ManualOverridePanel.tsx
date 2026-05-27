import React, { useState } from 'react';
import { css } from '@emotion/css';
import { OrchestratorTask, TerminalSession } from '../../types';
import { Send, CheckCheck, XCircle, RotateCcw } from 'lucide-react';
import { orchestratorEngine } from '../../services/orchestratorEngine';
import { Select } from '../ui/Select';

interface ManualOverridePanelProps {
  tasks: OrchestratorTask[];
  sessions: TerminalSession[];
  isRunning: boolean;
}

export const ManualOverridePanel: React.FC<ManualOverridePanelProps> = ({
  tasks,
  sessions,
  isRunning,
}) => {
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [message, setMessage] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [injecting, setInjecting] = useState(false);

  const activeTasks = tasks.filter(t => t.status === 'running' || t.status === 'pending');

  const handleInject = async () => {
    if (!selectedSessionId || !message.trim()) return;
    setInjecting(true);
    try {
      await orchestratorEngine.injectMessage(selectedSessionId, message.trim());
      setMessage('');
    } catch (err) {
      console.error('[ManualOverride] inject error', err);
    } finally {
      setInjecting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleInject();
    }
  };

  const handleForceComplete = () => {
    if (!selectedTaskId) return;
    orchestratorEngine.forceCompleteTask(selectedTaskId);
  };

  const handleFail = () => {
    if (!selectedTaskId) return;
    orchestratorEngine.failTask(selectedTaskId);
  };

  const handleRetry = () => {
    if (!selectedTaskId) return;
    orchestratorEngine.retryTask(selectedTaskId);
  };

  return (
    <div className={styles.root}>
      {/* Inject message */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Inject Message into Session</div>

        <Select
          value={selectedSessionId}
          onChange={setSelectedSessionId}
          disabled={!isRunning}
          options={[
            { value: '', name: '— Choose session —' },
            ...sessions.map(s => ({ value: s.id, name: s.title })),
          ]}
        />

        <textarea
          className={styles.textarea}
          placeholder='Type a message to inject… (Ctrl+Enter to send)'
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isRunning || !selectedSessionId}
          rows={3}
        />

        <button
          className={styles.primaryBtn}
          onClick={handleInject}
          disabled={!isRunning || !selectedSessionId || !message.trim() || injecting}
        >
          <Send className={styles.btnIcon} />
          {injecting ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className={styles.divider} />

      {/* Task override controls */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Task Override</div>

        <Select
          value={selectedTaskId}
          onChange={setSelectedTaskId}
          disabled={!isRunning}
          options={[
            { value: '', name: '— Choose task —' },
            ...activeTasks.map(t => ({ value: t.id, name: `[${t.status.toUpperCase()}] ${t.title}` })),
          ]}
        />

        <div className={styles.actionRow}>
          <button
            className={styles.successBtn}
            onClick={handleForceComplete}
            disabled={!isRunning || !selectedTaskId}
            title='Mark task as done and continue pipeline'
          >
            <CheckCheck className={styles.btnIcon} />
            Force Done
          </button>
          <button
            className={styles.dangerBtn}
            onClick={handleFail}
            disabled={!isRunning || !selectedTaskId}
            title='Mark task as failed and halt dependents'
          >
            <XCircle className={styles.btnIcon} />
            Fail
          </button>
          <button
            className={styles.neutralBtn}
            onClick={handleRetry}
            disabled={!isRunning || !selectedTaskId}
            title='Reset task to pending and re-dispatch'
          >
            <RotateCcw className={styles.btnIcon} />
            Retry
          </button>
        </div>
      </div>

      {!isRunning && (
        <div className={styles.pausedOverlay}>
          Controls available while a plan is running
        </div>
      )}
    </div>
  );
};

const styles = {
  root: css`
    position: relative;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    background-color: var(--bg-secondary);
    overflow: hidden;
  `,
  section: css`
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  sectionLabel: css`
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-tertiary);
  `,
  divider: css`
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 0;
  `,
  textarea: css`
    width: 100%;
    box-sizing: border-box;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm);
    padding: 8px 10px;
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    font-family: inherit;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
    line-height: 1.5;

    &::placeholder {
      color: var(--text-tertiary);
    }

    &:focus {
      border-color: var(--color-brand);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `,
  actionRow: css`
    display: flex;
    gap: 6px;
  `,
  // Shared base CSS as a plain string (not wrapped in css``) so it can be
  // safely interpolated into other css`` calls without generating a class name.
  primaryBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s, background-color 0.15s;
    background-color: var(--color-brand);
    color: #fff;

    &:disabled { opacity: 0.35; cursor: not-allowed; }
    &:not(:disabled):hover { opacity: 0.85; }
  `,
  successBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s;
    background-color: var(--color-success);
    color: #fff;

    &:disabled { opacity: 0.35; cursor: not-allowed; }
    &:not(:disabled):hover { opacity: 0.85; }
  `,
  dangerBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s;
    background-color: var(--color-danger);
    color: #fff;

    &:disabled { opacity: 0.35; cursor: not-allowed; }
    &:not(:disabled):hover { opacity: 0.85; }
  `,
  neutralBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    border-radius: var(--border-radius-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--border-color);
    transition: background-color 0.15s, color 0.15s;
    background-color: var(--bg-primary);
    color: var(--text-secondary);

    &:disabled { opacity: 0.35; cursor: not-allowed; }
    &:not(:disabled):hover { color: var(--text-primary); background-color: var(--bg-hover); }
  `,
  btnIcon: css`
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  `,
  pausedOverlay: css`
    position: absolute;
    inset: 0;
    background-color: rgba(0,0,0,0.45);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    pointer-events: none;
    border-radius: var(--border-radius-md);
  `,
};
