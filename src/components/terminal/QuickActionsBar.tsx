import React from 'react';
import { css, cx } from '@emotion/css';
import { Settings2 } from 'lucide-react';
import { useDashboard } from '../../context/DashboardContext';
import { DEFAULT_QUICK_ACTIONS } from '../../utils/terminalThemes';
import type { QuickAction } from '../../types';
import * as LucideIcons from 'lucide-react';

import { useNavigate } from 'react-router';

interface QuickActionsBarProps {
  onRunAction: (action: QuickAction) => void;
}

export const QuickActionsBar: React.FC<QuickActionsBarProps> = ({ onRunAction }) => {
  const { settings } = useDashboard();
  const navigate = useNavigate();
  const actions =
    settings.quickActions && settings.quickActions.length > 0
      ? settings.quickActions
      : DEFAULT_QUICK_ACTIONS;

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [showScrollIndicator, setShowScrollIndicator] = React.useState(false);
  const [thumbWidthPercent, setThumbWidthPercent] = React.useState(0);
  const [thumbOffsetPx, setThumbOffsetPx] = React.useState(0);

  const updateScrollIndicator = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const { scrollWidth, clientWidth, scrollLeft } = el;
    // Use a 2px threshold to account for subpixel scaling/DPI zoom rounding errors
    const canScroll = scrollWidth > clientWidth + 2;
    setShowScrollIndicator(canScroll);

    if (canScroll) {
      const trackWidth = 60; // Total track width in px
      const ratio = clientWidth / scrollWidth;
      const thumbWidth = Math.max(12, trackWidth * ratio); // Min 12px thumb
      const maxScrollLeft = scrollWidth - clientWidth;
      const maxThumbOffset = trackWidth - thumbWidth;
      const scrollRatio = maxScrollLeft > 0 ? scrollLeft / maxScrollLeft : 0;
      const thumbOffset = scrollRatio * maxThumbOffset;

      setThumbWidthPercent((thumbWidth / trackWidth) * 100);
      setThumbOffsetPx(thumbOffset);
    }
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;

      const canScroll = el.scrollWidth > el.clientWidth + 2;
      if (canScroll) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });

    const resizeObserver = new ResizeObserver(() => {
      updateScrollIndicator();
    });
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener('wheel', onWheel);
      resizeObserver.disconnect();
    };
  }, [updateScrollIndicator]);

  React.useEffect(() => {
    const timer = setTimeout(updateScrollIndicator, 100);
    return () => clearTimeout(timer);
  }, [actions, updateScrollIndicator]);

  return (
    <div className={styles.container}>
      <div className={styles.bar}>
        <div className={styles.actionsGroup} ref={scrollRef} onScroll={updateScrollIndicator}>
          {actions.map((action) => {
            const IconComponent =
              (action.iconName && (LucideIcons as any)[action.iconName]) || LucideIcons.Terminal;
            const titleTooltip = action.autoExecute
              ? `Run: ${action.command}`
              : `Paste: ${action.command}`;

            return (
              <button
                key={action.id}
                className={styles.actionBtn}
                onClick={() => onRunAction(action)}
                title={titleTooltip}
                style={
                  action.color
                    ? ({ '--action-color': action.color } as React.CSSProperties)
                    : undefined
                }
              >
                <IconComponent size={14} />
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.divider} />

        <button
          className={cx(styles.actionBtn, styles.iconOnlyBtn)}
          title="Configure Quick Actions"
          onClick={() => navigate('/settings#terminal')}
        >
          <Settings2 size={14} />
        </button>
      </div>

      {showScrollIndicator && (
        <div className={styles.scrollTrack}>
          <div
            className={styles.scrollThumb}
            style={{
              width: `${thumbWidthPercent}%`,
              transform: `translateX(${thumbOffsetPx}px)`,
            }}
          />
        </div>
      )}
    </div>
  );
};

const styles = {
  container: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 16px 12px;
    box-sizing: border-box;
    z-index: 20;
    flex-shrink: 0;

    /* Animation for initial mount */
    animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(16px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,
  bar: css`
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(20, 23, 26, 0.85);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(86, 93, 97, 0.22);
    padding: 6px;
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    max-width: 100%;
    min-width: 0; /* Let it shrink when constrained by container */
  `,
  actionsGroup: css`
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    min-width: 0; /* Let the container collapse below content size */
    flex: 1 1 auto;

    /* Hide scrollbars cleanly */
    &::-webkit-scrollbar {
      display: none;
    }
    -ms-overflow-style: none; /* IE/Edge */
    scrollbar-width: none; /* Firefox */
  `,
  actionBtn: css`
    display: flex;
    flex-shrink: 0; /* Prevent buttons from squishing when scrolling */
    align-items: center;
    gap: 6px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid transparent;
    padding: 6px 12px;
    border-radius: var(--radius-md);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    outline: none;

    /* If a custom color is provided, use it for hover states */
    --hover-bg: rgba(86, 93, 97, 0.12);
    --hover-color: var(--action-color, var(--text-primary));

    &:hover {
      background: var(--hover-bg);
      color: var(--hover-color);
      border-color: rgba(86, 93, 97, 0.16);
    }

    &:active {
      transform: scale(0.96);
      background: rgba(86, 93, 97, 0.08);
    }

    svg {
      color: inherit;
    }
  `,
  iconOnlyBtn: css`
    padding: 6px;
    color: var(--text-tertiary);
    &:hover {
      color: var(--text-primary);
      background: rgba(86, 93, 97, 0.14);
    }
  `,
  divider: css`
    flex-shrink: 0;
    width: 1px;
    height: 18px;
    background: rgba(86, 93, 97, 0.2);
    margin: 0 4px;
  `,
  scrollTrack: css`
    pointer-events: none;
    width: 60px;
    height: 2px;
    background: rgba(86, 93, 97, 0.16);
    border-radius: 1px;
    position: relative;
    overflow: hidden;
  `,
  scrollThumb: css`
    height: 100%;
    background: var(--material-brass);
    border-radius: 1px;
    transition: transform 0.05s ease-out;
  `,
};
