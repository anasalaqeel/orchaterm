import React, { useState, useRef, useEffect } from 'react';
import { css, cx } from '@emotion/css';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  width?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, width = 260 }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    
    // 1. Vertical Boundary Check (Flip to bottom if there's no space on top)
    const margin = 12; // Safety margin from screen boundaries
    const tooltipHeight = tooltipRect.height || 140; // Fallback estimate if not fully measured yet
    const fitsTop = triggerRect.top - tooltipHeight - margin > 0;
    const nextPosition = fitsTop ? 'top' : 'bottom';
    
    setPosition(nextPosition);

    // 2. Horizontal Boundary Check (Shift left/right if overflowing side edges)
    const leftOffset = (triggerRect.width - width) / 2;
    const viewportLeft = triggerRect.left + triggerRect.width / 2 - width / 2;
    const viewportRight = viewportLeft + width;
    
    let shift = 0;

    if (viewportLeft < margin) {
      // Shift right to stay on screen
      shift = margin - viewportLeft;
    } else if (viewportRight > window.innerWidth - margin) {
      // Shift left to stay on screen
      shift = (window.innerWidth - margin) - viewportRight;
    }

    // Set styles and pass the offset to the arrow via a CSS variable
    setStyle({
      left: `${leftOffset + shift}px`,
      width: `${width}px`,
      ['--arrow-shift' as any]: `${-shift}px`,
    });
  };

  useEffect(() => {
    if (visible) {
      updatePosition();
      // Measure again immediately in case height changed after rendering
      const handle = requestAnimationFrame(updatePosition);
      
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, { capture: true });
      return () => {
        cancelAnimationFrame(handle);
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, { capture: true });
      };
    }
  }, [visible]);

  return (
    <div
      ref={triggerRef}
      className={styles.container}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          className={cx(styles.tooltip, position === 'top' ? styles.tooltipTop : styles.tooltipBottom)}
          style={style}
        >
          {content}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: css`
    position: relative;
    display: inline-flex;
    align-items: center;
  `,
  tooltip: css`
    position: absolute;
    background-color: var(--bg-secondary, #0e1726);
    border: 1px solid var(--border-color, #1e293b);
    border-radius: var(--border-radius-md, 8px);
    padding: var(--spacing-md, 12px);
    box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.5));
    color: var(--text-secondary, #94a3b8);
    font-size: var(--font-size-xs, 11px);
    font-weight: var(--font-weight-normal, 400);
    line-height: 1.5;
    z-index: 60;
    pointer-events: none;
    text-transform: none;
    letter-spacing: normal;

    /* Base Tooltip Arrow Structure */
    &::after {
      content: '';
      position: absolute;
      left: calc(50% + var(--arrow-shift, 0px));
      transform: translateX(-50%);
      border-width: 6px;
      border-style: solid;
    }
    &::before {
      content: '';
      position: absolute;
      left: calc(50% + var(--arrow-shift, 0px));
      transform: translateX(-50%);
      border-width: 7px;
      border-style: solid;
      z-index: -1;
    }
  `,
  tooltipTop: css`
    bottom: calc(100% + 8px);
    animation: tooltipFadeInTop 0.15s ease-out;

    &::after {
      top: 100%;
      border-color: var(--bg-secondary, #0e1726) transparent transparent transparent;
    }
    &::before {
      top: 100%;
      border-color: var(--border-color, #1e293b) transparent transparent transparent;
    }

    @keyframes tooltipFadeInTop {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,
  tooltipBottom: css`
    top: calc(100% + 8px);
    animation: tooltipFadeInBottom 0.15s ease-out;

    &::after {
      bottom: 100%;
      border-color: transparent transparent var(--bg-secondary, #0e1726) transparent;
    }
    &::before {
      bottom: 100%;
      border-color: transparent transparent var(--border-color, #1e293b) transparent;
    }

    @keyframes tooltipFadeInBottom {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,
};
