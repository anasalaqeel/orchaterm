import { useState } from 'react';

/**
 * A generic hook for managing drag-and-drop reordering of list items.
 */
export function useDragReorder<T>(items: T[], setItems: (next: T[]) => void) {
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<{ index: number; pos: 'top' | 'bottom' } | null>(null);

  const handleDrop = (targetIdx: number, pos: 'top' | 'bottom') => {
    if (draggedIdx === null) return;
    const insertAt = pos === 'top' ? targetIdx : targetIdx + 1;
    const finalIdx = draggedIdx < insertAt ? insertAt - 1 : insertAt;
    if (finalIdx === draggedIdx) {
      setDraggedIdx(null);
      setDragOver(null);
      return;
    }
    const nextItems = [...items];
    const [moved] = nextItems.splice(draggedIdx, 1);
    nextItems.splice(finalIdx, 0, moved);
    setItems(nextItems);
    setDraggedIdx(null);
    setDragOver(null);
  };

  return {
    draggedIdx,
    setDraggedIdx,
    dragOver,
    setDragOver,
    handleDrop,
  };
}
