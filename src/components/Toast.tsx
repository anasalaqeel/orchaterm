import React from 'react';
import { useDashboard } from '../context/DashboardContext';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { css, cx } from '@emotion/css';

export const Toast: React.FC = () => {
  const { toast, setToast } = useDashboard();

  if (!toast) return null;

  const typeStyle = {
    success: styles.success,
    error: styles.error,
    info: styles.info,
  }[toast.type];

  const Icon = {
    success: CheckCircle2,
    error: AlertTriangle,
    info: Info,
  }[toast.type];

  return (
    <div className={styles.wrapper}>
      <div className={cx(styles.toastBox, typeStyle)}>
        <Icon className={styles.icon} />
        <span className={styles.message}>{toast.message}</span>
        <button
          onClick={() => setToast(null)}
          className={styles.closeBtn}
        >
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
    background-color: rgba(6, 78, 59, 0.9);
    border-color: rgba(52, 211, 153, 0.3);
    color: #a7f3d0;
    box-shadow: 0 0 15px -3px rgba(34, 197, 94, 0.2);
    
    body.light & {
      background-color: #ecfdf5;
      border-color: #a7f3d0;
      color: #065f46;
    }
  `,
  error: css`
    background-color: rgba(159, 18, 57, 0.9);
    border-color: rgba(248, 113, 113, 0.3);
    color: #fecdd3;
    box-shadow: 0 0 15px -3px rgba(239, 68, 68, 0.2);

    body.light & {
      background-color: #fff1f2;
      border-color: #fecdd3;
      color: #9f1239;
    }
  `,
  info: css`
    background-color: rgba(30, 58, 138, 0.9);
    border-color: rgba(96, 165, 250, 0.3);
    color: #dbeafe;
    box-shadow: 0 0 15px -3px rgba(59, 130, 246, 0.2);

    body.light & {
      background-color: #eff6ff;
      border-color: #bfdbfe;
      color: #1e40af;
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
    transition: opacity 150ms ease, background-color 150ms ease;

    &:hover {
      opacity: 1;
      background-color: rgba(255, 255, 255, 0.1);
    }
  `,
  closeIcon: css`
    width: 16px;
    height: 16px;
  `
};
