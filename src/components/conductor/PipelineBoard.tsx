import React, { useRef, useEffect, useState, useCallback } from 'react';
import { css, cx } from '@emotion/css';
import { OrchestratorTask, OrchestratorTaskStatus, TerminalSession } from '../../types';
import { TaskCard } from './TaskCard';

interface PipelineBoardProps {
  tasks: OrchestratorTask[];
  sessions: TerminalSession[];
}

// ─── Wave computation ─────────────────────────────────────────────────────────
// Groups tasks into "waves" — each wave is the set of tasks whose deps are
// all satisfied by earlier waves, giving us natural pipeline columns.

function computeWaves(tasks: OrchestratorTask[]): OrchestratorTask[][] {
  if (tasks.length === 0) return [];

  const remaining = new Set(tasks.map(t => t.id));
  const resolved  = new Set<string>();
  const waves: OrchestratorTask[][] = [];

  let safety = 0;
  while (remaining.size > 0 && safety < tasks.length + 2) {
    safety++;
    const wave = tasks.filter(
      t => remaining.has(t.id) && t.dependsOn.every(d => resolved.has(d))
    );
    if (wave.length === 0) break;
    wave.forEach(t => { remaining.delete(t.id); resolved.add(t.id); });
    waves.push(wave);
  }
  if (remaining.size > 0) waves.push(tasks.filter(t => remaining.has(t.id)));
  return waves;
}

// ─── Status colours ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<OrchestratorTaskStatus, string> = {
  pending: '#475569',
  running: '#FF9D00',
  done:    '#10b981',
  failed:  '#ef4444',
};

function waveStatus(wave: OrchestratorTask[]): OrchestratorTaskStatus {
  if (wave.some(t => t.status === 'failed'))  return 'failed';
  if (wave.some(t => t.status === 'running')) return 'running';
  if (wave.every(t => t.status === 'done'))   return 'done';
  return 'pending';
}

// ─── Arrow types ──────────────────────────────────────────────────────────────

interface ArrowPath {
  d: string;         // SVG path data
  color: string;     // hex / css colour
  faded: boolean;    // true when source task is not yet done
}

// ─── PipelineBoard ────────────────────────────────────────────────────────────

export const PipelineBoard: React.FC<PipelineBoardProps> = ({ tasks, sessions }) => {
  const waves   = computeWaves(tasks);
  const boardRef = useRef<HTMLDivElement>(null);

  const [arrows,  setArrows]  = useState<ArrowPath[]>([]);
  const [svgDims, setSvgDims] = useState({ w: 0, h: 0 });

  // ── Arrow computation ───────────────────────────────────────────────────────
  const recomputeArrows = useCallback(() => {
    const board = boardRef.current;
    if (!board || waves.length < 2) { setArrows([]); return; }

    const boardRect = board.getBoundingClientRect();
    const newArrows: ArrowPath[] = [];

    tasks.forEach(task => {
      if (task.dependsOn.length === 0) return;

      const targetEl = board.querySelector(`[data-task-id="${task.id}"]`) as HTMLElement | null;
      if (!targetEl) return;

      const tr = targetEl.getBoundingClientRect();
      const x2 = tr.left - boardRect.left + board.scrollLeft;
      const y2 = tr.top  + tr.height / 2  - boardRect.top  + board.scrollTop;

      task.dependsOn.forEach(depId => {
        const sourceEl = board.querySelector(`[data-task-id="${depId}"]`) as HTMLElement | null;
        if (!sourceEl) return;

        const sr = sourceEl.getBoundingClientRect();
        const x1 = sr.right - boardRect.left + board.scrollLeft;
        const y1 = sr.top   + sr.height / 2  - boardRect.top  + board.scrollTop;

        // Cubic bezier — control points pulled horizontally to the midpoint
        const cx = (x1 + x2) / 2;
        const d  = `M ${x1},${y1} C ${cx},${y1} ${cx},${y2} ${x2},${y2}`;

        const sourceTask  = tasks.find(t => t.id === depId);
        const sess        = sessions.find(s => s.id === sourceTask?.assignedSessionId);
        const color       = sess?.color ?? '#475569';
        const faded       = sourceTask?.status !== 'done';

        newArrows.push({ d, color, faded });
      });
    });

    setSvgDims({ w: board.scrollWidth, h: Math.max(board.scrollHeight, 1) });
    setArrows(newArrows);
  }, [tasks, sessions, waves.length]);

  // Recompute after DOM has painted (50ms lets React flush)
  useEffect(() => {
    const t = setTimeout(recomputeArrows, 60);
    return () => clearTimeout(t);
  }, [recomputeArrows]);

  // Also recompute when the board resizes (task cards expand/collapse)
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const ro = new ResizeObserver(recomputeArrows);
    ro.observe(board);
    return () => ro.disconnect();
  }, [recomputeArrows]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (waves.length === 0) {
    return <div className={styles.empty}>No tasks yet. Build a plan first.</div>;
  }

  return (
    <div ref={boardRef} className={styles.board}>

      {/* SVG dependency arrows — absolutely positioned inside the scroll area */}
      {arrows.length > 0 && (
        <svg
          className={styles.arrowSvg}
          style={{ width: svgDims.w, height: svgDims.h }}
          xmlns='http://www.w3.org/2000/svg'
        >
          <defs>
            {/* One arrowhead marker per unique colour */}
            {[...new Set(arrows.map(a => a.color))].map(color => {
              const id = `ah-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
              return (
                <marker
                  key={id}
                  id={id}
                  viewBox='0 0 10 10'
                  refX='9'
                  refY='5'
                  markerWidth='5'
                  markerHeight='5'
                  orient='auto-start-reverse'
                >
                  <path d='M 0 0 L 10 5 L 0 10 z' fill={color} />
                </marker>
              );
            })}
          </defs>

          {arrows.map((arrow, i) => {
            const markerId = `ah-${arrow.color.replace(/[^a-zA-Z0-9]/g, '')}`;
            return (
              <path
                key={i}
                d={arrow.d}
                stroke={arrow.color}
                strokeWidth={1.5}
                strokeDasharray={arrow.faded ? '5 3' : 'none'}
                fill='none'
                opacity={arrow.faded ? 0.3 : 0.7}
                markerEnd={`url(#${markerId})`}
              />
            );
          })}
        </svg>
      )}

      {/* Wave columns */}
      {waves.map((wave, wi) => {
        const ws    = waveStatus(wave);
        const color = STATUS_COLOR[ws];
        return (
          <div key={wi} className={styles.wave}>
            {/* Wave header */}
            <div className={styles.waveHeader}>
              <span className={styles.waveLabel} style={{ color }}>Wave {wi + 1}</span>
              <span className={styles.waveBadge} style={{ borderColor: color, color }}>
                {ws.toUpperCase()}
              </span>
            </div>

            {/* Task cards — each wrapped in a div carrying data-task-id so the
                SVG code can find them via querySelector */}
            <div className={styles.waveCards}>
              {wave.map(task => (
                <div key={task.id} data-task-id={task.id}>
                  <TaskCard
                    task={task}
                    allTasks={tasks}
                    sessions={sessions}
                    editable={false}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── PipelineSummary ──────────────────────────────────────────────────────────

interface PipelineSummaryProps { tasks: OrchestratorTask[]; }

export const PipelineSummary: React.FC<PipelineSummaryProps> = ({ tasks }) => {
  const counts: Record<OrchestratorTaskStatus, number> = { pending: 0, running: 0, done: 0, failed: 0 };
  tasks.forEach(t => counts[t.status]++);
  const total = tasks.length;
  const doneRatio = total > 0 ? counts.done / total : 0;

  return (
    <div className={styles.summary}>
      <div className={styles.summaryBar}>
        <div
          className={cx(styles.summaryFill, counts.failed > 0 && styles.summaryFillFailed)}
          style={{ width: `${doneRatio * 100}%` }}
        />
      </div>
      <div className={styles.summaryCounts}>
        {(Object.entries(counts) as [OrchestratorTaskStatus, number][]).map(([s, n]) => (
          <span key={s} className={styles.countChip} style={{ color: STATUS_COLOR[s] }}>
            {n} {s}
          </span>
        ))}
        <span className={styles.totalChip}>{total} total</span>
      </div>
    </div>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  board: css`
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 24px;
    overflow-x: auto;
    padding-bottom: 12px;
    min-height: 120px;
    position: relative;        /* anchor for the SVG overlay */

    scrollbar-width: thin;
    scrollbar-color: var(--border-color) transparent;
    &::-webkit-scrollbar { height: 6px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }
    &::-webkit-scrollbar-track { background: transparent; }
  `,
  arrowSvg: css`
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 0;
    overflow: visible;
  `,
  wave: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 260px;
    max-width: 320px;
    flex-shrink: 0;
    position: relative;
    z-index: 1;   /* above the SVG overlay */
  `,
  waveHeader: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 2px;
  `,
  waveLabel: css`
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
  `,
  waveBadge: css`
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.07em;
    border: 1px solid;
    border-radius: 3px;
    padding: 1px 5px;
  `,
  waveCards: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  empty: css`
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    padding: 16px 0;
    text-align: center;
  `,
  summary: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  summaryBar: css`
    height: 4px;
    background-color: var(--border-color);
    border-radius: 2px;
    overflow: hidden;
  `,
  summaryFill: css`
    height: 100%;
    background-color: #10b981;
    border-radius: 2px;
    transition: width 0.5s ease;
  `,
  summaryFillFailed: css`
    background-color: #ef4444;
  `,
  summaryCounts: css`
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  `,
  countChip: css`
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  `,
  totalChip: css`
    font-size: 10px;
    color: var(--text-tertiary);
    margin-left: auto;
  `,
};
