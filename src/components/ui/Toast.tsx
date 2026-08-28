import React from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { CheckCircle2, AlertTriangle, Info, X, Loader2 } from 'lucide-react';
import { css, cx } from '@emotion/css';

export const Toast: React.FC = () => {
  const { toast, setToast } = useDashboard();

  if (!toast) return null;

  const typeStyle = {
    success: styles.success,
    error: styles.error,
    info: styles.info,
    loading: styles.loading,
  }[toast.type];

  const Icon = {
    success: CheckCircle2,
    error: AlertTriangle,
    info: Info,
    loading: Loader2,
  }[toast.type];

  return (
    <div className={styles.wrapper}>
      <div className={cx(styles.toastBox, typeStyle)}>
        <Icon className={cx(styles.icon, toast.type === 'loading' && styles.loaderIcon)} />
        <span className={styles.message}>{toast.message}</span>
        <button onClick={() => setToast(null)} className={styles.closeBtn}>
          <X className={styles.closeIcon} />
        </button>
      </div>
    </div>
  );
};

const styles = {
  wrapper: css`
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 1050;
    animation: toast-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;

    @keyframes toast-in {
      from {
        transform: translateY(1rem) scale(0.95);
        opacity: 0;
      }
      to {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }
  `,
  toastBox: css`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: var(--border-radius-md);
    border: 1px solid var(--border-color);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-lg);
  `,
  success: css`
    background-color: var(--bg-secondary);
    border-color: rgba(var(--color-success-rgb), 0.35);
    color: var(--color-success);
    box-shadow: 0 0 15px -3px rgba(var(--color-success-rgb), 0.25);
  `,
  error: css`
    background-color: var(--bg-secondary);
    border-color: rgba(var(--color-error-rgb), 0.35);
    color: var(--color-error);
    box-shadow: 0 0 15px -3px rgba(var(--color-error-rgb), 0.25);
  `,
  info: css`
    background-color: var(--bg-secondary);
    border-color: rgba(var(--color-info-rgb), 0.35);
    color: var(--color-info);
    box-shadow: 0 0 15px -3px rgba(var(--color-info-rgb), 0.25);
  `,
  loading: css`
    background-color: var(--bg-secondary);
    border-color: var(--border-color-hover);
    color: var(--text-primary);
    box-shadow: 0 0 15px -3px rgba(var(--material-brass-rgb), 0.2);
  `,
  loaderIcon: css`
    animation: spin 1s linear infinite;
    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
  `,
  icon: css`
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  `,
  message: css`
    font-size: 14px;
    font-weight: 500;
  `,
  closeBtn: css`
    color: inherit;
    opacity: 0.6;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    border-radius: var(--border-radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      opacity 150ms ease,
      background-color 150ms ease;

    &:hover {
      opacity: 1;
      background-color: rgba(var(--material-brass-rgb), 0.16);
    }
  `,
  closeIcon: css`
    width: 16px;
    height: 16px;
  `,
};
