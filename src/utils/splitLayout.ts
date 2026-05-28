import type { SplitNode } from '../hooks/useSplitTree';

export const DIVIDER_PX = 4;
export const PANE_HEADER_PX = 26;

export interface PaneRect {
  leafId: string;
  sessionId: string;
  // Full pane bounds (including header)
  top: number;
  left: number;
  width: number;
  height: number;
  // Terminal area (below pane header)
  termTop: number;
  termHeight: number;
}

export interface DividerRect {
  containerId: string;
  childIndex: number; // left/top child index; divider sits between [i] and [i+1]
  direction: 'h' | 'v';
  top: number;
  left: number;
  width: number;
  height: number;
  containerAvailableSize: number; // px available to children (excluding dividers)
}

export interface SplitLayout {
  panes: PaneRect[];
  dividers: DividerRect[];
}

export function computeSplitLayout(
  node: SplitNode,
  top: number,
  left: number,
  width: number,
  height: number,
  headerHeight = PANE_HEADER_PX,
): SplitLayout {
  if (node.type === 'leaf') {
    return {
      panes: [{
        leafId: node.id,
        sessionId: node.sessionId,
        top, left, width, height,
        termTop: top + headerHeight,
        termHeight: Math.max(0, height - headerHeight),
      }],
      dividers: [],
    };
  }

  const panes: PaneRect[] = [];
  const dividers: DividerRect[] = [];
  const isH = node.direction === 'h';
  const totalSize = isH ? width : height;
  const numDividers = node.children.length - 1;
  const available = Math.max(0, totalSize - numDividers * DIVIDER_PX);

  let offset = isH ? left : top;

  for (let i = 0; i < node.children.length; i++) {
    const childSize = node.ratios[i] * available;
    const childTop    = isH ? top    : offset;
    const childLeft   = isH ? offset : left;
    const childWidth  = isH ? childSize : width;
    const childHeight = isH ? height    : childSize;

    const sub = computeSplitLayout(
      node.children[i], childTop, childLeft, childWidth, childHeight, headerHeight,
    );
    panes.push(...sub.panes);
    dividers.push(...sub.dividers);

    offset += childSize;

    if (i < node.children.length - 1) {
      dividers.push({
        containerId: node.id,
        childIndex: i,
        direction: node.direction,
        top:    isH ? top    : offset,
        left:   isH ? offset : left,
        width:  isH ? DIVIDER_PX : width,
        height: isH ? height     : DIVIDER_PX,
        containerAvailableSize: available,
      });
      offset += DIVIDER_PX;
    }
  }

  return { panes, dividers };
}
