// src/components/ui/ContinuationModal.tsx
import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { Save, X } from 'lucide-react';
import { writePtyChunked } from '../../utils/ptyUtils';
import { Select, type SelectOption } from './Select';
import { useDashboard, DEFAULT_TERMINAL_WORKSPACE } from '../../context/DashboardContext';
import { loadTerminalTabs, type TerminalTabsState, type PersistedTab } from '../../services/storage';
import type { CheckpointSnapshot } from '../../types';
import type { TerminalSession } from '../../types';
import type { Workspace } from '../../types';

interface ContinuationModalProps {
  snapshot: CheckpointSnapshot;
  sessions: TerminalSession[];
  workspaces: Workspace[];
  targetSessionId: string | null;
  onDismiss: () => void;
}

/** A tab we know about from disk but that has no live PTY yet (workspace never opened this session). */
interface LazyTab {
  workspaceId: string;
  /** The session ID this tab will be restored with — TerminalContainer reuses the persisted ID verbatim. */
  sessionId: string;
}

const LAZY_PREFIX = '__lazy__:';
const LAZY_TIMEOUT_MS = 8000;
const WRITE_RETRY_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Both segments are crypto.randomUUID() values (hyphens only, never colons),
// so splitting on the first colon after the prefix is unambiguous.
function encodeLazyValue(workspaceId: string, sessionId: string): string {
  return `${LAZY_PREFIX}${workspaceId}:${sessionId}`;
}

function decodeLazyValue(value: string): LazyTab | null {
  if (!value.startsWith(LAZY_PREFIX)) return null;
  const rest = value.slice(LAZY_PREFIX.length);
  const sepIdx = rest.indexOf(':');
  if (sepIdx === -1) return null;
  return {
    workspaceId: rest.slice(0, sepIdx),
    sessionId: rest.slice(sepIdx + 1),
  };
}

const RESUME_PREFIX =
  'Continue working on the following task. A previous agent session stopped mid-way. ' +
  'Here is the full context of what happened and what needs to happen next:\n\n';

export const ContinuationModal: React.FC<ContinuationModalProps> = ({
  snapshot,
  sessions,
  workspaces,
  targetSessionId,
  onDismiss,
}) => {
  const { setActiveWorkspaceId, setViewMode } = useDashboard();

  const [selectedId, setSelectedId] = useState<string>(
    targetSessionId ?? sessions[0]?.id ?? ''
  );
  const [injecting, setInjecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  // A workspace's terminals only exist as live PTYs once its console has been
  // opened this session (lazy-mounted for perf). Tab metadata (title/shell/order)
  // is persisted to disk regardless, so we can still list — and open on demand —
  // terminals belonging to workspaces that haven't been visited yet.
  const [persistedTabs, setPersistedTabs] = useState<TerminalTabsState>({});
  useEffect(() => {
    loadTerminalTabs().then(setPersistedTabs).catch(() => {});
  }, []);

  // Latest `sessions` value, readable from inside the async handleInject closure.
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const allWorkspaces = [...workspaces, DEFAULT_TERMINAL_WORKSPACE];
  const sessionOptions: SelectOption[] = allWorkspaces.flatMap(ws => {
    const wsSessions = sessions.filter(s => s.workspaceId === ws.id);
    if (wsSessions.length > 0) {
      return wsSessions.map(s => ({
        value: s.id,
        name: s.title,
        group: ws.name,
      }));
    }

    const saved = persistedTabs[`${ws.id}::workspace`];
    const savedTabs = (Array.isArray(saved) ? saved : saved?.tabs ?? [])
      // Only tabs with a persisted ID can be targeted deterministically after
      // restore (TerminalContainer falls back to a fresh random ID otherwise).
      .filter((tab): tab is PersistedTab & { id: string } => !!tab.id);
    if (savedTabs.length === 0) {
      return [{
        value: `__empty__:${ws.id}`,
        name: 'No open terminals',
        description: 'This workspace has never had a terminal open',
        group: ws.name,
        disabled: true,
      }];
    }

    return savedTabs
      .sort((a, b) => a.order - b.order)
      .map(tab => ({
        value: encodeLazyValue(ws.id, tab.id),
        name: tab.title,
        description: 'Opens this workspace, then injects',
        group: ws.name,
      }));
  });

  // Waits for the given session ID to appear (registered by TerminalContainer
  // once it restores the persisted tab) after we've asked the app to open
  // that workspace's console.
  async function waitForRestoredSession(sessionId: string, label: string): Promise<void> {
    const deadline = Date.now() + LAZY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (sessionsRef.current.some(s => s.id === sessionId)) return;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Timed out waiting for "${label}" to open — try opening the workspace manually.`);
  }

  // The PTY may still be spawning for a moment after the session shows up in
  // React state, so retry the write instead of failing on the first attempt.
  async function writeWithRetry(id: string, data: string): Promise<void> {
    const deadline = Date.now() + WRITE_RETRY_TIMEOUT_MS;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        await writePtyChunked(id, data);
        return;
      } catch (err) {
        lastErr = err;
        await sleep(300);
      }
    }
    throw lastErr;
  }

  const handleInject = async () => {
    if (!selectedId) return;
    setInjecting(true);
    setError(null);
    setStatusText(null);
    try {
      const message =
        `${RESUME_PREFIX}Checkpoint file: ${snapshot.filePath}\n\n` +
        `Please read the checkpoint file and continue from where the previous session stopped.`;

      const lazy = decodeLazyValue(selectedId);
      if (lazy) {
        const option = sessionOptions.find(o => o.value === selectedId);
        const workspaceName = allWorkspaces.find(w => w.id === lazy.workspaceId)?.name ?? 'workspace';
        setStatusText(`Opening "${option?.name ?? 'terminal'}" in ${workspaceName}…`);
        setActiveWorkspaceId(lazy.workspaceId);
        setViewMode('console');
        await waitForRestoredSession(lazy.sessionId, option?.name ?? 'terminal');
        setStatusText('Injecting…');
        await writeWithRetry(lazy.sessionId, message + '\r');
      } else {
        await writePtyChunked(selectedId, message + '\r');
      }
      onDismiss();
    } catch (err) {
      setError(String(err));
    } finally {
      setInjecting(false);
      setStatusText(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={css`
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000;
        `}
        onClick={onDismiss}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className={css`
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px;
            width: 420px;
            max-width: 90vw;
          `}
          onClick={e => e.stopPropagation()}
        >
          <div className={css`display: flex; align-items: center; gap: 10px; margin-bottom: 16px;`}>
            <Save size={18} color="var(--color-success)" />
            <span className={css`font-size: 15px; font-weight: 600; color: var(--text-primary);`}>
              Agent stopped — checkpoint saved
            </span>
            <button
              onClick={onDismiss}
              className={css`
                margin-left: auto;
                background: none; border: none; cursor: pointer;
                color: var(--text-tertiary);
                &:hover { color: var(--text-primary); }
              `}
            >
              <X size={16} />
            </button>
          </div>

          <div className={css`font-size: 12px; color: var(--text-tertiary); margin-bottom: 16px; word-break: break-all;`}>
            {snapshot.sessionTitle} · {snapshot.label} · {snapshot.filePath.split('/').slice(-1)[0]}
          </div>

          <div className={css`margin-bottom: 16px;`}>
            <Select
              label="Inject resume prompt into:"
              options={sessionOptions}
              value={selectedId}
              onChange={setSelectedId}
            />
          </div>

          {statusText && (
            <div className={css`font-size: 12px; color: var(--text-tertiary); margin-bottom: 12px;`}>
              {statusText}
            </div>
          )}

          {error && (
            <div className={css`font-size: 12px; color: var(--color-danger); margin-bottom: 12px;`}>
              {error}
            </div>
          )}

          <div className={css`display: flex; gap: 8px; justify-content: flex-end;`}>
            <button
              onClick={onDismiss}
              className={css`
                padding: 8px 14px; border-radius: 6px; font-size: 13px;
                background: var(--bg-primary); border: 1px solid var(--border-color);
                color: var(--text-secondary); cursor: pointer;
                &:hover { color: var(--text-primary); }
              `}
            >
              Save File Only
            </button>
            <button
              onClick={handleInject}
              disabled={!selectedId || injecting}
              className={css`
                padding: 8px 14px; border-radius: 6px; font-size: 13px;
                background: var(--color-brand); border: none;
                color: white; cursor: pointer; font-weight: 500;
                &:disabled { opacity: 0.5; cursor: not-allowed; }
                &:hover:not(:disabled) { opacity: 0.9; }
              `}
            >
              {injecting ? 'Injecting…' : 'Inject & Resume'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
