/*
 * ConsoleSplit.tsx
 *
 * Owns the resizable / collapsible split between the terminal (left) and the
 * chat panel (right): width + collapse state, the drag handler, and persistence.
 *
 * The terminal and chat are passed in as element props rather than rendered
 * here, so a resize drag (which re-renders THIS component on every mousemove)
 * never re-renders them — their element identity is owned by the parent, which
 * does not re-render during the drag. This is the "JSX as props" pattern and
 * replaces the need to React.memo the heavy children.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { css } from '@emotion/css';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const CHAT_MIN = 260;
const CHAT_MAX = 700;
const CHAT_DEFAULT = 360;

interface ConsoleSplitProps {
  /** Left pane — the terminal. */
  terminal: React.ReactNode;
  /** Right pane — the chat + pipeline panel. */
  right: React.ReactNode;
  /** Whether the console is the visible view; gates the drag handle. */
  active: boolean;
}

export function ConsoleSplit({ terminal, right, active }: ConsoleSplitProps) {
  const [chatWidth, setChatWidth] = useState<number>(() => {
    const stored = localStorage.getItem('orchaterm:chatWidth');
    if (!stored) return CHAT_DEFAULT;
    const n = parseInt(stored, 10);
    return isNaN(n) ? CHAT_DEFAULT : n;
  });
  const [chatCollapsed, setChatCollapsed] = useState<boolean>(
    // Collapsed by default for the workspace; only expanded if the user explicitly did so.
    () => localStorage.getItem('orchaterm:chatCollapsed') !== 'false',
  );
  /** True only while the user is actively dragging the resize handle. */
  const [isResizing, setIsResizing] = useState(false);

  /** Holds the active drag's listeners; aborted on drag-end or unmount. */
  const dragAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight drag (and restore body styles) if unmounted mid-drag.
  useEffect(() => () => {
    dragAbortRef.current?.abort();
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  }, []);

  const toggleChatCollapsed = useCallback(() => {
    setChatCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('orchaterm:chatCollapsed', String(next));
      return next;
    });
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (chatCollapsed) return;

    const startX     = e.clientX;
    const startWidth = chatWidth;
    let latestWidth  = chatWidth;

    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    setIsResizing(true);

    dragAbortRef.current?.abort();          // drop any orphaned prior drag
    const controller = new AbortController();
    dragAbortRef.current = controller;

    window.addEventListener('mousemove', (ev: MouseEvent) => {
      const delta = startX - ev.clientX;                        // drag left = wider chat
      latestWidth = Math.max(CHAT_MIN, Math.min(CHAT_MAX, startWidth + delta));
      setChatWidth(latestWidth);
    }, { signal: controller.signal });

    window.addEventListener('mouseup', () => {
      controller.abort();
      dragAbortRef.current = null;
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      setIsResizing(false);
      localStorage.setItem('orchaterm:chatWidth', String(latestWidth));
    }, { signal: controller.signal });
  }, [chatCollapsed, chatWidth]);

  return (
    <div className={s.consoleSplit}>
      <div className={s.consoleSplitLeft}>{terminal}</div>

      {/* Drag overlay — absolute, zero flex space; inert when collapsed */}
      {active && !chatCollapsed && (
        <div
          className={s.dragZone}
          style={{ right: chatWidth - 4 }}
          onMouseDown={handleResizeStart}
        />
      )}

      {/*
        Chat panel — width transitions via CSS, but the transition is disabled
        while dragging so resize tracks the cursor instantly (no easing lag).
      */}
      <div
        className={s.consoleSplitRight}
        style={{
          width:      chatCollapsed ? 0 : chatWidth,
          minWidth:   0,
          transition: isResizing ? 'none' : 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Inner wrapper fixed at chatWidth so content doesn't squish during the collapse animation */}
        <div className={s.chatInner} style={{ width: chatWidth, minWidth: chatWidth }}>
          {right}
        </div>
      </div>

      {/* Collapse pill — absolutely positioned, never clips */}
      <button
        className={s.collapseBtn}
        style={{
          right: chatCollapsed ? 0 : chatWidth,
          // Track the handle 1:1 during drag; keep the eased move only for collapse toggle.
          transition: isResizing ? 'none' : undefined,
        }}
        onClick={toggleChatCollapsed}
        title={chatCollapsed ? 'Expand chat' : 'Collapse chat'}
      >
        {chatCollapsed ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}
      </button>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const s = {
  consoleSplit: css`
    flex: 1; display: flex; min-height: 0;
    position: relative; /* anchor for the floating collapse button */
  `,
  consoleSplitLeft: css`
    flex: 1; height: 100%; min-width: 0;
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--bg-canvas);
  `,
  consoleSplitRight: css`
    flex-shrink: 0; height: 100%;
    display: flex; flex-direction: column; overflow: hidden;
    border-left: 1px solid var(--border-color);
    background: var(--bg-primary);
  `,
  /* Inner wrapper — fixed at chatWidth (set inline) so content doesn't squish during collapse */
  chatInner: css`
    height: 100%;
    display: flex; flex-direction: column;
  `,

  /* Drag overlay — absolute, straddles the border, contributes zero flex space */
  dragZone: css`
    position: absolute;
    top: 0; bottom: 0;
    width: 8px;
    cursor: col-resize;
    z-index: 5;
    background: transparent;
    transition: background 0.12s;
    &:hover { background: rgba(var(--color-brand-rgb), 0.15); }
  `,

  /* Floating pill — straddles the terminal/chat border, always visible */
  collapseBtn: css`
    position: absolute;
    top: 50%; transform: translateY(-50%);
    z-index: 10;
    width: 14px; height: 48px;
    border-radius: 4px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition: right 0.22s cubic-bezier(0.4,0,0.2,1), color 0.15s, background 0.15s, border-color 0.15s, box-shadow 0.15s;
    &:hover {
      color: var(--color-brand);
      background: rgba(var(--color-brand-rgb), 0.08);
      border-color: rgba(var(--color-brand-rgb), 0.4);
      box-shadow: var(--shadow-brand);
    }
  `,
};
