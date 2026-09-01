/*
 * TaskOutputReplay.tsx
 *
 * Modal "replay" of a completed task's captured terminal output: the ANSI-
 * stripped transcript is revealed progressively at an adjustable speed, like
 * watching the agent work at 1–8×. Falls back to a plain scrollable transcript
 * view at any time.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { Play, Pause, X } from 'lucide-react';
import { stripAnsiCodes } from '../../services/sentinelParser';
import type { OrchestratorTask } from '../../types';

const BASE_MS_PER_LINE = 120;

export const TaskOutputReplay: React.FC<{
  task: OrchestratorTask;
  onClose: () => void;
}> = ({ task, onClose }) => {
  const lines = useMemo(() => {
    const clean = stripAnsiCodes(task.output?.raw ?? '').replace(/\r/g, '');
    const all = clean.split('\n');
    // Skip long leading blank runs (echo suppression leftovers) but keep order.
    let start = 0;
    while (start < all.length && all[start].trim() === '') start++;
    return all.slice(start);
  }, [task.output?.raw]);

  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reveal one line per interval tick; stop at the end automatically.
  useEffect(() => {
    if (!playing) return;
    if (revealed >= lines.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(
      () => setRevealed((r) => Math.min(r + 1, lines.length)),
      BASE_MS_PER_LINE / speed
    );
    return () => clearTimeout(t);
  }, [playing, revealed, speed, lines.length]);

  // Keep the newest revealed line in view while playing.
  useEffect(() => {
    if (playing && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [revealed, playing]);

  return (
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <span className={s.title}>▶ {task.title}</span>
          <span className={s.agent}>{task.assignedSessionTitle}</span>
          <div className={s.controls}>
            <button
              className={s.btn}
              onClick={() => {
                if (revealed >= lines.length) setRevealed(0);
                setPlaying((p) => !p);
              }}
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={12} /> : <Play size={12} />}
            </button>
            {[1, 2, 4, 8].map((sp) => (
              <button
                key={sp}
                className={cx(s.btn, speed === sp && s.btnActive)}
                onClick={() => setSpeed(sp)}
                title={`${sp}× speed`}
              >
                {sp}×
              </button>
            ))}
            <span className={s.counter}>
              {Math.min(revealed, lines.length)}/{lines.length}
            </span>
            <button className={s.btn} onClick={onClose} title="Close">
              <X size={12} />
            </button>
          </div>
        </div>
        <div className={s.body} ref={scrollRef}>
          {lines.length === 0 ? (
            <div className={s.empty}>No terminal output was captured for this task.</div>
          ) : (
            <>
              {lines.slice(0, revealed).map((line, i) => (
                <div key={i} className={s.line}>
                  {line || '\u00A0'}
                </div>
              ))}
              {revealed < lines.length && playing && <div className={s.cursor} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const s = {
  backdrop: css`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  `,
  modal: css`
    width: min(720px, 90vw);
    height: min(520px, 80vh);
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-canvas);
  `,
  title: css`
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  agent: css`
    font-size: 10px;
    color: var(--color-brand);
    font-weight: 600;
    flex-shrink: 0;
  `,
  controls: css`
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  `,
  btn: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 22px;
    padding: 0 5px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    &:hover {
      color: var(--text-primary);
      border-color: var(--text-secondary);
    }
  `,
  btnActive: css`
    color: var(--color-brand);
    border-color: var(--color-brand);
    background: rgba(var(--color-brand-rgb), 0.1);
  `,
  counter: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    margin: 0 4px;
  `,
  body: css`
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    font-family: var(--font-family-mono);
    font-size: 11px;
    line-height: 1.55;
    background: var(--bg-canvas);
  `,
  line: css`
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
  `,
  cursor: css`
    display: inline-block;
    width: 7px;
    height: 12px;
    background: var(--color-brand);
    animation: replayblink 0.8s step-end infinite;
    @keyframes replayblink {
      50% {
        opacity: 0;
      }
    }
  `,
  empty: css`
    color: var(--text-tertiary);
    font-size: 11px;
    text-align: center;
    margin-top: 40px;
  `,
};
