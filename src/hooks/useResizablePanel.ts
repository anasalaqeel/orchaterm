import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Options {
  /** localStorage key for the committed width (collapse state stored at `${storageKey}:collapsed`). */
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  /** When true, dragging the handle left widens the panel (panel sits on the right edge). */
  invert?: boolean;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Writes the panel size onto the container as CSS custom properties so the
 * width can change every frame without a React re-render.
 *   --panel-w        outer width  (0 while collapsed → drives the clip + transition)
 *   --panel-content-w  inner width  (always the expanded width → content never reflows)
 */
function applyVars(el: HTMLElement | null, outer: number, content: number) {
  if (!el) return;
  el.style.setProperty('--panel-w', `${outer}px`);
  el.style.setProperty('--panel-content-w', `${content}px`);
}

/**
 * Resizable / collapsible side panel.
 *
 * The hot path (pointer drag) never touches React state: each move writes the
 * live width to a CSS variable inside a single rAF-batched callback. State and
 * localStorage are committed once, on pointer release. This keeps the heavy
 * sibling subtree (terminal, chat) from re-rendering on every mouse move.
 */
export function useResizablePanel({ storageKey, defaultWidth, min, max, invert = true }: Options) {
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem(storageKey);
    const n = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(n) ? clamp(n, min, max) : defaultWidth;
  });
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(`${storageKey}:collapsed`) === 'true',
  );
  const [dragging, setDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const liveWidthRef = useRef(width);
  const frameRef = useRef(0);

  // Sync CSS vars to committed state (before paint, so no flash of zero width).
  // Skipped while dragging — the rAF loop owns the vars then.
  useLayoutEffect(() => {
    if (dragging) return;
    liveWidthRef.current = width;
    applyVars(containerRef.current, collapsed ? 0 : width, width);
  }, [width, collapsed, dragging]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(`${storageKey}:collapsed`, String(next));
      return next;
    });
  }, [storageKey]);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      if (collapsed) return;
      e.preventDefault();

      const startX = e.clientX;
      const startWidth = liveWidthRef.current;
      const handle = e.currentTarget as HTMLElement;
      handle.setPointerCapture(e.pointerId);

      setDragging(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: PointerEvent) => {
        const delta = invert ? startX - ev.clientX : ev.clientX - startX;
        liveWidthRef.current = clamp(startWidth + delta, min, max);
        if (frameRef.current) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0;
          const w = liveWidthRef.current;
          applyVars(containerRef.current, w, w);
        });
      };

      const onEnd = () => {
        handle.releasePointerCapture?.(e.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
        if (frameRef.current) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = 0;
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setDragging(false);

        const final = liveWidthRef.current;
        setWidth(final);
        localStorage.setItem(storageKey, String(final));
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
    },
    [collapsed, invert, min, max, storageKey],
  );

  // Safety net: drop body styles / pending frame if unmounted mid-drag.
  useEffect(
    () => () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return { width, collapsed, dragging, toggleCollapsed, onResizeStart, containerRef };
}
