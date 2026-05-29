// src/components/ui/ContinuationModal.tsx
import React, { useState } from 'react';
import { css } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { Save, X } from 'lucide-react';
import { writePtyChunked } from '../../utils/ptyUtils';
import type { CheckpointSnapshot } from '../../types';
import type { TerminalSession } from '../../types';

interface ContinuationModalProps {
  snapshot: CheckpointSnapshot;
  sessions: TerminalSession[];
  targetSessionId: string | null;
  onDismiss: () => void;
}

const RESUME_PREFIX =
  'Continue working on the following task. A previous agent session stopped mid-way. ' +
  'Here is the full context of what happened and what needs to happen next:\n\n';

export const ContinuationModal: React.FC<ContinuationModalProps> = ({
  snapshot,
  sessions,
  targetSessionId,
  onDismiss,
}) => {
  const [selectedId, setSelectedId] = useState<string>(
    targetSessionId ?? sessions[0]?.id ?? ''
  );
  const [injecting, setInjecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInject = async () => {
    if (!selectedId) return;
    setInjecting(true);
    setError(null);
    try {
      const message =
        `${RESUME_PREFIX}Checkpoint file: ${snapshot.filePath}\n\n` +
        `Please read the checkpoint file and continue from where the previous session stopped.`;
      await writePtyChunked(selectedId, message + '\r');
      onDismiss();
    } catch (err) {
      setError(String(err));
    } finally {
      setInjecting(false);
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

          <label className={css`font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 8px;`}>
            Inject resume prompt into:
          </label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className={css`
              width: 100%;
              background: var(--bg-primary);
              border: 1px solid var(--border-color);
              border-radius: 6px;
              padding: 8px 10px;
              color: var(--text-primary);
              font-size: 13px;
              margin-bottom: 16px;
              outline: none;
              &:focus { border-color: var(--color-brand); }
            `}
          >
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>

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
