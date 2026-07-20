import React from 'react';
import { css, cx } from '@emotion/css';
import { Trash2 } from 'lucide-react';

export interface DraggableTaskRowProps {
  index: number;
  dragState: {
    draggedIdx: number | null;
    setDraggedIdx: (idx: number | null) => void;
    dragOver: { index: number; pos: 'top' | 'bottom' } | null;
    setDragOver: (over: { index: number; pos: 'top' | 'bottom' } | null) => void;
    handleDrop: (targetIdx: number, pos: 'top' | 'bottom') => void;
  };
  onRemove: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const DraggableTaskRow: React.FC<DraggableTaskRowProps> = ({
  index,
  dragState,
  onRemove,
  disabled = false,
  className,
  children,
}) => {
  const { draggedIdx, setDraggedIdx, dragOver, setDragOver, handleDrop } = dragState;
  const isDragging = draggedIdx === index;
  const isOverTop = dragOver?.index === index && dragOver.pos === 'top';
  const isOverBottom = dragOver?.index === index && dragOver.pos === 'bottom';

  return (
    <div
      className={cx(
        styles.row,
        isDragging && styles.rowDragging,
        isOverTop && styles.rowDragTop,
        isOverBottom && styles.rowDragBottom,
        className,
      )}
      draggable={!disabled}
      onDragStart={(e) => {
        if (disabled) return;
        setDraggedIdx(index);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        setDraggedIdx(null);
        setDragOver(null);
      }}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedIdx === null) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
        if (dragOver?.index !== index || dragOver?.pos !== pos) {
          setDragOver({ index, pos });
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node) && dragOver?.index === index) {
          setDragOver(null);
        }
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        const pos = dragOver?.index === index ? dragOver.pos : 'top';
        handleDrop(index, pos);
      }}
    >
      <span className={styles.taskGrip} title="Drag to reorder">⋮⋮</span>
      <span className={styles.taskNum}>{index + 1}.</span>
      <div className={styles.content}>{children}</div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className={styles.removeBtn}
        title="Remove task"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
};

const styles = {
  row: css`
    position: relative;
    display: flex; align-items: center; gap: 6px;
    padding: 6px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--border-radius-sm);
    border: 1px solid var(--border-color);
  `,
  rowDragging: css`
    opacity: 0.45; border-style: dashed;
  `,
  rowDragTop: css`
    &::before {
      content: ''; position: absolute;
      top: -3px; left: 0; right: 0;
      height: 3px; background: var(--color-brand);
      border-radius: 3px;
      box-shadow: 0 0 6px rgba(var(--color-brand-rgb), 0.6);
      pointer-events: none; z-index: 10;
    }
  `,
  rowDragBottom: css`
    &::after {
      content: ''; position: absolute;
      bottom: -3px; left: 0; right: 0;
      height: 3px; background: var(--color-brand);
      border-radius: 3px;
      box-shadow: 0 0 6px rgba(var(--color-brand-rgb), 0.6);
      pointer-events: none; z-index: 10;
    }
  `,
  taskGrip: css`
    font-size: 10px; line-height: 1; letter-spacing: -1px;
    color: var(--text-tertiary); cursor: grab; flex-shrink: 0;
    user-select: none;
    &:hover { color: var(--text-secondary); }
  `,
  taskNum: css`
    font-size: 11px; font-weight: 700; color: var(--text-tertiary);
    width: 20px; text-align: right; flex-shrink: 0;
  `,
  content: css`
    display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
  `,
  removeBtn: css`
    background: transparent; border: 1px solid var(--border-color);
    color: var(--text-tertiary); cursor: pointer;
    width: 24px; height: 24px; border-radius: 4px; flex-shrink: 0;
    display: inline-flex; align-items: center; justify-content: center;
    &:hover:not(:disabled) { color: var(--color-error); border-color: var(--color-error); }
    &:disabled { opacity: 0.35; cursor: default; }
  `,
};
