import React, { useEffect, useRef } from 'react';
import { css, cx } from '@emotion/css';
import { ConductorLogEntry } from '../../types';
import { Terminal, Send, CheckCircle, GitMerge, Clock, AlertTriangle, Info, User } from 'lucide-react';

interface ConductorLogProps {
  entries: ConductorLogEntry[];
  maxHeight?: number;
}

const TYPE_META: Record<
  ConductorLogEntry['type'],
  { icon: React.ElementType; label: string; colorVar: string }
> = {
  dispatch:      { icon: Send,         label: 'DISPATCH',  colorVar: 'var(--color-brand)' },
  sentinel:      { icon: CheckCircle,  label: 'SENTINEL',  colorVar: 'var(--color-success)' },
  relay:         { icon: GitMerge,     label: 'RELAY',     colorVar: '#a78bfa' },
  timeout:       { icon: Clock,        label: 'TIMEOUT',   colorVar: 'var(--color-warning)' },
  error:         { icon: AlertTriangle,label: 'ERROR',     colorVar: 'var(--color-danger)' },
  info:          { icon: Info,         label: 'INFO',      colorVar: 'var(--text-tertiary)' },
  'user-override': { icon: User,       label: 'OVERRIDE',  colorVar: '#f472b6' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export const ConductorLog: React.FC<ConductorLogProps> = ({ entries, maxHeight = 320 }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolledToBottomRef = useRef(true);

  // Track scroll position — only auto-scroll if user was already at bottom
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isScrolledToBottomRef.current = atBottom;
  };

  useEffect(() => {
    if (isScrolledToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className={styles.empty}>
        <Terminal className={styles.emptyIcon} />
        <span>Orchestrator log is empty — start a plan to see activity.</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={styles.root}
      style={{ maxHeight }}
      onScroll={handleScroll}
    >
      {entries.map((entry) => {
        const meta = TYPE_META[entry.type] ?? TYPE_META.info;
        const Icon = meta.icon;
        return (
          <div key={entry.id} className={styles.row}>
            {/* Timestamp */}
            <span className={styles.ts}>{formatTime(entry.timestamp)}</span>

            {/* Badge */}
            <span
              className={styles.badge}
              style={{ color: meta.colorVar, borderColor: meta.colorVar }}
            >
              <Icon className={styles.badgeIcon} />
              {meta.label}
            </span>

            {/* Message */}
            <span className={styles.msg}>{entry.message}</span>

            {/* Optional task/session pills */}
            {entry.taskId && (
              <span className={styles.pill} title={`Task: ${entry.taskId}`}>
                T:{entry.taskId.slice(0, 8)}
              </span>
            )}
            {entry.sessionId && (
              <span className={cx(styles.pill, styles.pillSession)} title={`Session: ${entry.sessionId}`}>
                S:{entry.sessionId.slice(0, 8)}
              </span>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};

const styles = {
  root: css`
    overflow-y: auto;
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
    display: flex;
    flex-direction: column;

    /* thin scrollbar */
    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;

    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 3px;
    }
  `,
  row: css`
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--border-color);
    flex-wrap: wrap;
    line-height: 1.6;

    &:last-child {
      border-bottom: none;
    }

    &:hover {
      background-color: var(--bg-secondary);
    }
  `,
  ts: css`
    color: var(--text-tertiary);
    white-space: nowrap;
    flex-shrink: 0;
    font-size: 10px;
    letter-spacing: 0.02em;
  `,
  badge: css`
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.07em;
    border: 1px solid;
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
    flex-shrink: 0;
    opacity: 0.9;
  `,
  badgeIcon: css`
    width: 9px;
    height: 9px;
  `,
  msg: css`
    color: var(--text-primary);
    flex: 1;
    word-break: break-word;
  `,
  pill: css`
    font-size: 9px;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    padding: 1px 5px;
    color: var(--text-tertiary);
    white-space: nowrap;
    flex-shrink: 0;
    font-family: inherit;
  `,
  pillSession: css`
    color: var(--color-brand);
    border-color: var(--color-brand);
    opacity: 0.7;
  `,
  empty: css`
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md);
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    background-color: var(--bg-secondary);
  `,
  emptyIcon: css`
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    opacity: 0.4;
  `,
};
