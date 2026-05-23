import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { css } from '@emotion/css';

interface ConfirmDialogProps {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * App-native confirmation dialog — replaces the synchronous browser confirm().
 * Supports keyboard (Enter = confirm, Escape = cancel via overlay click).
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
}) => {
  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <div
        className={styles.box}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-msg"
      >
        <div className={styles.iconRow}>
          <AlertTriangle className={styles.icon} />
        </div>
        <p id="confirm-msg" className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button onClick={onCancel} className={styles.cancelBtn}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className={styles.confirmBtn} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: css`
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    animation: fadeIn 0.15s ease;
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  `,
  box: css`
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    padding: var(--spacing-lg);
    max-width: 360px;
    width: 100%;
    box-shadow: var(--shadow-lg), 0 0 20px rgba(248, 113, 113, 0.1);
    animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    @keyframes slideUp {
      from { transform: translateY(8px); opacity: 0; }
      to   { transform: translateY(0);   opacity: 1; }
    }
  `,
  iconRow: css`
    display: flex;
    justify-content: center;
    margin-bottom: var(--spacing-md);
  `,
  icon: css`
    width: 32px;
    height: 32px;
    color: var(--color-error);
  `,
  message: css`
    text-align: center;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    margin-bottom: var(--spacing-lg);
    line-height: 1.6;
  `,
  actions: css`
    display: flex;
    justify-content: center;
    gap: var(--spacing-sm);
  `,
  cancelBtn: css`
    padding: 8px 20px;
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
      border-color: var(--border-color-hover);
      color: var(--text-primary);
    }
  `,
  confirmBtn: css`
    padding: 8px 20px;
    border-radius: var(--border-radius-sm);
    border: none;
    background: var(--color-error);
    color: #fff;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-bold);
    cursor: pointer;
    transition: filter 0.15s ease;
    &:hover { filter: brightness(1.1); }
  `,
};
