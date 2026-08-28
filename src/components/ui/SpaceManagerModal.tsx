/**
 * SpaceManagerModal.tsx
 *
 * Modal for creating or editing a Space within a workspace.
 * Fields: name, color swatch, terminal session membership.
 */

import React, { useState } from 'react';
import { css, cx } from '@emotion/css';
import { X, Terminal } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { Space } from '../../types';
import { Input } from './Input';

const COLOR_PRESETS = [
  '#2f8f7a',
  '#565d61',
  '#4a7ca3',
  '#6b8f3f',
  '#0e8a80',
  '#9c5fa3',
  '#c98a1f',
  '#5a6570',
];

interface SpaceManagerModalProps {
  workspaceId: string;
  /** undefined = create mode, Space = edit mode */
  space?: Space;
  onClose: () => void;
}

export const SpaceManagerModal: React.FC<SpaceManagerModalProps> = ({
  workspaceId,
  space,
  onClose,
}) => {
  const { addSpace, updateSpace, terminalSessions, showToast } = useDashboard();

  const workspaceSessions = terminalSessions.filter((s) => s.workspaceId === workspaceId);

  const [name, setName] = useState(space?.name ?? '');
  const [color, setColor] = useState(space?.color ?? '#2f8f7a');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(space?.sessionIds ?? []));

  const toggleSession = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Space name is required', 'error');
      return;
    }

    if (space) {
      await updateSpace(space.id, { name: name.trim(), color, sessionIds: [...selectedIds] });
      showToast(`Space "${name.trim()}" updated`, 'success');
    } else {
      await addSpace({ name: name.trim(), color, workspaceId, sessionIds: [...selectedIds] });
    }
    onClose();
  };

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <div className={s.headerLeft}>
            <span className={s.headerDot} style={{ backgroundColor: color }} />
            <h3 className={s.title}>{space ? 'Edit Space' : 'New Space'}</h3>
          </div>
          <button className={s.closeBtn} onClick={onClose} type="button">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={s.form}>
          <div className={s.field}>
            <label className={s.label}>Space Name</label>
            <Input
              className={s.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Backend, Frontend, Infra…"
              autoFocus
            />
          </div>

          <div className={s.field}>
            <label className={s.label}>Color</label>
            <div className={s.swatches}>
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cx(s.swatch, color === c && s.swatchActive)}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className={s.field}>
            <label className={s.label}>
              Terminal Sessions
              <span className={s.labelHint}>&nbsp;— select which tabs belong to this space</span>
            </label>
            {workspaceSessions.length === 0 ? (
              <div className={s.emptySessionsBox}>
                <Terminal size={14} className={s.emptyIcon} />
                <span>
                  No active sessions. Open the workspace console first, then come back to assign
                  tabs.
                </span>
              </div>
            ) : (
              <div className={s.sessionList}>
                {workspaceSessions.map((sess) => {
                  const checked = selectedIds.has(sess.id);
                  return (
                    <label
                      key={sess.id}
                      className={cx(s.sessionItem, checked && s.sessionItemChecked)}
                      style={checked ? { borderColor: color } : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSession(sess.id)}
                        className={s.checkbox}
                      />
                      <span
                        className={s.sessionDot}
                        style={{ backgroundColor: sess.color ?? 'var(--text-tertiary)' }}
                      />
                      <span className={s.sessionName}>{sess.title}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {/* Stale sessions: stored in space but no longer active */}
            {space &&
              (() => {
                const staleIds = space.sessionIds.filter(
                  (id) => !workspaceSessions.some((s) => s.id === id)
                );
                if (staleIds.length === 0) return null;
                return (
                  <div className={s.staleSection}>
                    <span className={s.staleLabel}>
                      ⚠ {staleIds.length} session{staleIds.length !== 1 ? 's' : ''} from a previous
                      launch (no longer active)
                    </span>
                    {staleIds.map((id) => (
                      <div key={id} className={s.staleItem}>
                        <span className={s.staleDot} />
                        <span className={s.staleId}>{id.slice(0, 12)}…</span>
                        <button
                          type="button"
                          className={s.staleRemoveBtn}
                          onClick={() =>
                            setSelectedIds((prev) => {
                              const n = new Set(prev);
                              n.delete(id);
                              return n;
                            })
                          }
                          title="Remove stale session"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
          </div>

          <div className={s.actions}>
            <button type="button" className={s.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={s.submitBtn} style={{ backgroundColor: color }}>
              {space ? 'Save Changes' : 'Create Space'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const s = {
  backdrop: css`
    position: fixed;
    inset: 0;
    z-index: 500;
    background: var(--overlay-scrim);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 120ms ease-out;
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  `,
  modal: css`
    width: 440px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    animation: slideUp 150ms ease-out;
    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.97);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--border-color);
  `,
  headerLeft: css`
    display: flex;
    align-items: center;
    gap: 10px;
  `,
  headerDot: css`
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
    transition: background-color 200ms ease;
  `,
  title: css`
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  `,
  closeBtn: css`
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 150ms ease;
    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  form: css`
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  label: css`
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  `,
  labelHint: css`
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-tertiary);
  `,
  input: css`
    background: var(--bg-input);
    border: 1px solid var(--border-color-hover);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
    transition: border-color 150ms ease;
    &:focus {
      border-color: var(--border-color-focus);
    }
    &::placeholder {
      color: var(--text-tertiary);
    }
  `,
  swatches: css`
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  `,
  swatch: css`
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
    transition:
      transform 120ms ease,
      border-color 120ms ease;
    &:hover {
      transform: scale(1.2);
    }
  `,
  swatchActive: css`
    border-color: var(--material-paper);
    transform: scale(1.15);
  `,
  emptySessionsBox: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: var(--bg-canvas);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.4;
  `,
  emptyIcon: css`
    color: var(--text-tertiary);
    flex-shrink: 0;
  `,
  sessionList: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 180px;
    overflow-y: auto;
    &::-webkit-scrollbar {
      width: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background: var(--border-color-hover);
      border-radius: 2px;
    }
  `,
  sessionItem: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    background: var(--bg-canvas);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      border-color 150ms ease,
      background 150ms ease;
    &:hover {
      background: var(--bg-hover);
      border-color: var(--border-color-hover);
    }
  `,
  sessionItemChecked: css`
    background: rgba(var(--color-brand-rgb), 0.08);
  `,
  checkbox: css`
    width: 14px;
    height: 14px;
    accent-color: var(--color-brand);
    cursor: pointer;
    flex-shrink: 0;
  `,
  sessionDot: css`
    width: 8px;
    height: 8px;
    border-radius: 1px;
    flex-shrink: 0;
  `,
  sessionName: css`
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  `,
  staleSection: css`
    margin-top: 8px;
    padding: 10px 12px;
    background: rgba(var(--color-warning-rgb), 0.07);
    border: 1px solid rgba(var(--color-warning-rgb), 0.22);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  staleLabel: css`
    font-size: 10px;
    font-weight: 700;
    color: var(--color-warning);
  `,
  staleItem: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  staleDot: css`
    width: 6px;
    height: 6px;
    border-radius: 1px;
    background: var(--text-tertiary);
    flex-shrink: 0;
  `,
  staleId: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: 'Fira Code', monospace;
    flex: 1;
  `,
  staleRemoveBtn: css`
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    font-size: 9px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    transition: color 120ms ease;
    &:hover {
      color: var(--color-error);
    }
  `,
  actions: css`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  `,
  cancelBtn: css`
    padding: 9px 18px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color-hover);
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 150ms ease;
    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  `,
  submitBtn: css`
    padding: 9px 20px;
    border-radius: var(--radius-md);
    border: none;
    color: var(--text-inverse);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: filter 150ms ease;
    &:hover {
      filter: brightness(1.15);
    }
  `,
};
