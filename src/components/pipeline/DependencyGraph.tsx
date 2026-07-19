/*
 * DependencyGraph.tsx
 *
 * Compact SVG DAG visualisation for a list of tasks.
 * Used both as a read-only preview in the Builder and a live status view in the
 * Live Run board. Node colour reflects each task's status.
 */
import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import type { OrchestratorTask } from '../../types';

interface DependencyGraphProps {
  tasks: OrchestratorTask[];
  /** Optional title element rendered above the graph. */
  title?: React.ReactNode;
  /** Compact mode reduces padding and node size. */
  compact?: boolean;
}

const STATUS_FILL: Record<OrchestratorTask['status'], string> = {
  pending:  'var(--bg-tertiary)',
  running:  'var(--color-brand)',
  done:     'var(--color-success)',
  failed:   'var(--color-error)',
};

const STATUS_STROKE: Record<OrchestratorTask['status'], string> = {
  pending:  'var(--border-color-hover)',
  running:  'var(--color-brand)',
  done:     'var(--color-success)',
  failed:   'var(--color-error)',
};

interface LaidOut {
  id: string;
  title: string;
  x: number;
  y: number;
  depth: number;
  task: OrchestratorTask;
}

/**
 * Position nodes in columns by longest dependency chain from a root, and
 * stack rows within a column. The algorithm is intentionally simple — plans
 * typically have ≤ 12 tasks.
 */
function layout(tasks: OrchestratorTask[], compact?: boolean): { nodes: LaidOut[]; width: number; height: number } {
  if (tasks.length === 0) return { nodes: [], width: 0, height: 0 };

  const COL_W = compact ? 110 : 140;
  const ROW_H = compact ? 48  : 56;
  const PAD   = 12;

  const byId = new Map(tasks.map(t => [t.id, t]));
  const depthCache = new Map<string, number>();

  const depthOf = (id: string): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    const task = byId.get(id);
    if (!task || task.dependsOn.length === 0) {
      depthCache.set(id, 0);
      return 0;
    }
    const d = 1 + Math.max(...task.dependsOn.map(d => depthOf(d)));
    depthCache.set(id, d);
    return d;
  };

  // Group by depth, preserve original order within each column.
  const columns = new Map<number, OrchestratorTask[]>();
  for (const t of tasks) {
    const d = depthOf(t.id);
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(t);
  }

  const maxDepth = Math.max(...columns.keys());
  const nodes: LaidOut[] = [];
  for (let d = 0; d <= maxDepth; d++) {
    const colTasks = columns.get(d) ?? [];
    colTasks.forEach((task, i) => {
      nodes.push({
        id: task.id,
        title: task.title,
        x: PAD + d * COL_W,
        y: PAD + i * ROW_H,
        depth: d,
        task,
      });
    });
  }

  // Centre each column vertically relative to the tallest column.
  const tallest = Math.max(...[...columns.values()].map(c => c.length));
  const colHeights = new Map<number, number>();
  for (const [d, col] of columns) colHeights.set(d, col.length);

  for (const node of nodes) {
    const colH = colHeights.get(node.depth)!;
    const offset = ((tallest - colH) * ROW_H) / 2;
    node.y = PAD + offset + (node.y - PAD);
  }

  return {
    nodes,
    width:  PAD * 2 + (maxDepth + 1) * COL_W - (COL_W - 100),
    height: PAD * 2 + tallest * ROW_H - (ROW_H - 36),
  };
}

export const DependencyGraph: React.FC<DependencyGraphProps> = ({ tasks, title, compact }) => {
  const { nodes, width, height } = useMemo(() => layout(tasks, compact), [tasks, compact]);
  // Node number must reflect the task's true position in the plan (matching the
  // task list below), NOT its position in the depth-sorted layout — those only
  // coincide for a strictly linear chain. A plan with real parallel branches
  // would otherwise show mismatched numbers between the graph and the list.
  const taskIndexById = useMemo(
    () => new Map(tasks.map((t, i) => [t.id, i + 1])),
    [tasks],
  );

  if (tasks.length === 0) {
    return (
      <div className={s.empty}>
        {title}
        <span className={s.emptyText}>No tasks to graph.</span>
      </div>
    );
  }

  // Build edges: for each task, an edge from each of its deps → task.
  const edges: { from: LaidOut; to: LaidOut; key: string }[] = [];
  for (const node of nodes) {
    for (const depId of node.task.dependsOn) {
      const from = nodes.find(n => n.id === depId);
      if (from) edges.push({ from, to: node, key: `${from.id}-${node.id}` });
    }
  }

  const NODE_W = compact ? 92 : 120;
  const NODE_H = 32;

  return (
    <div className={s.wrap}>
      {title && <div className={s.titleRow}>{title}</div>}
      <div className={s.scroll}>
        <svg
          width={Math.max(width, NODE_W + 24)}
          height={height + NODE_H}
          className={s.svg}
        >
          <defs>
            <marker
              id="dep-arrow"
              viewBox="0 0 10 10"
              refX="9" refY="5"
              markerWidth="6" markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="var(--border-color-hover)" />
            </marker>
          </defs>

          {edges.map(e => (
            <path
              key={e.key}
              d={bezierPath(
                e.from.x + NODE_W,
                e.from.y + NODE_H / 2,
                e.to.x,
                e.to.y + NODE_H / 2,
              )}
              fill="none"
              stroke="var(--border-color-hover)"
              strokeWidth={1.2}
              markerEnd="url(#dep-arrow)"
            />
          ))}

          {nodes.map(node => {
            const fill = STATUS_FILL[node.task.status];
            const stroke = STATUS_STROKE[node.task.status];
            const label = truncate(node.title, compact ? 12 : 16);
            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={1.2}
                  className={node.task.status === 'running' ? s.nodePulse : undefined}
                />
                <text
                  x={8}
                  y={13}
                  fontSize={9}
                  fontWeight={700}
                  fill={node.task.status === 'pending' ? 'var(--text-tertiary)' : '#fff'}
                >
                  #{taskIndexById.get(node.id)}
                </text>
                <text
                  x={8}
                  y={NODE_H - 10}
                  fontSize={10}
                  fill={node.task.status === 'pending' ? 'var(--text-secondary)' : '#fff'}
                  className={s.nodeLabel}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Cubic-bezier path from (x1,y1) → (x2,y2) curving horizontally. */
function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(20, Math.abs(x2 - x1) * 0.5);
  return `M ${x1},${y1} C ${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

const s = {
  wrap: css`
    display: flex; flex-direction: column; gap: 6px;
  `,
  titleRow: css`
    font-size: 10px; font-weight: 700; color: var(--text-tertiary);
    text-transform: uppercase; letter-spacing: 0.06em;
  `,
  scroll: css`
    overflow: auto; max-height: 240px;
    background: var(--bg-tertiary);
    border-radius: 6px;
    border: 1px solid var(--border-color);
    padding: 6px;
    &::-webkit-scrollbar { height: 6px; width: 6px; }
    &::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }
  `,
  svg: css`
    display: block;
    min-width: 100%;
  `,
  nodeLabel: css`
    font-family: var(--font-family);
    pointer-events: none;
    user-select: none;
  `,
  nodePulse: css`
    animation: nodepulse 1.4s ease-in-out infinite;
    @keyframes nodepulse {
      0%, 100% { filter: brightness(1); }
      50%      { filter: brightness(1.18); }
    }
  `,
  empty: css`
    display: flex; flex-direction: column; gap: 6px;
    padding: 12px;
    background: var(--bg-tertiary); border-radius: 6px;
    border: 1px solid var(--border-color);
  `,
  emptyText: css`
    font-size: 11px; color: var(--text-tertiary);
  `,
};
