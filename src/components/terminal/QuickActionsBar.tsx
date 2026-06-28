import React from 'react';
import { css, cx } from '@emotion/css';
import { Settings2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

import { useDashboard } from '../../context/DashboardContext';
import { DEFAULT_QUICK_ACTIONS } from '../../utils/terminalThemes';
import type { QuickAction } from '../../types';
import * as LucideIcons from 'lucide-react';

import { useNavigate } from 'react-router';

export const QuickActionsBar: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { settings } = useDashboard();
  const navigate = useNavigate();
  const actions = settings.quickActions && settings.quickActions.length > 0 
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

  const handleAction = (action: QuickAction) => {
    // Send the command to the PTY
    const data = action.autoExecute ? `${action.command}\r` : action.command;
    invoke('write_pty', { sessionId, data }).catch((err) =>
      console.error('[QuickActionsBar] write_pty failed:', err)
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.bar}>
        <div 
          className={styles.actionsGroup} 
          ref={scrollRef}
          onScroll={updateScrollIndicator}
        >
          {actions.map((action) => {
            const IconComponent = (action.iconName && (LucideIcons as any)[action.iconName]) || LucideIcons.Terminal;
            return (
            <button
              key={action.id}
              className={styles.actionBtn}
              onClick={() => handleAction(action)}
              title={action.autoExecute ? `Run: ${action.command}` : `Paste: ${action.command}`}
              style={action.color ? { '--action-color': action.color } as React.CSSProperties : undefined}
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
              transform: `translateX(${thumbOffsetPx}px)`
            }}
          />
        </div>
      )}
    </div>
  );
};

const styles = {
  container: css`
    position: absolute;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    pointer-events: none; /* Let clicks pass through empty space */
    width: max-content;
    max-width: calc(100% - 32px); /* Prevent touching terminal window edges */
    
    /* Animation for initial mount */
    animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    
    @keyframes slideUp {
      from { opacity: 0; transform: translate(-50%, 16px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
  `,
  bar: css`
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(13, 23, 35, 0.7);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 6px;
    border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05);
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    opacity: 0.6; /* Semi-transparent when not focused */
    max-width: 100%;
    min-width: 0; /* Let it shrink when constrained by container */

    &:hover {
      opacity: 1;
      background: rgba(15, 25, 38, 0.85);
      border-color: rgba(255, 255, 255, 0.15);
      transform: translateY(-2px);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }
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
    color: #94a3b8;
    border: 1px solid transparent;
    padding: 6px 12px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    outline: none;

    /* If a custom color is provided, use it for hover states */
    --hover-bg: rgba(255, 255, 255, 0.06);
    --hover-color: var(--action-color, #e2e8f0);

    &:hover {
      background: var(--hover-bg);
      color: var(--hover-color);
      border-color: rgba(255, 255, 255, 0.04);
    }

    &:active {
      transform: scale(0.96);
      background: rgba(255, 255, 255, 0.03);
    }

    svg {
      color: inherit;
      transition: transform 0.2s ease;
    }
    
    &:hover svg {
      transform: scale(1.1);
    }
  `,
  iconOnlyBtn: css`
    padding: 6px;
    color: #64748b;
    &:hover {
      color: #e2e8f0;
      background: rgba(255, 255, 255, 0.08);
      transform: rotate(15deg);
    }
  `,
  divider: css`
    flex-shrink: 0;
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.1);
    margin: 0 4px;
    border-radius: 1px;
  `,
  scrollTrack: css`
    pointer-events: none;
    width: 60px;
    height: 2px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 1px;
    position: relative;
    overflow: hidden;
    animation: fadeIn 0.25s ease-out;

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-3px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `,
  scrollThumb: css`
    height: 100%;
    background: rgba(255, 255, 255, 0.45);
    border-radius: 1px;
    transition: transform 0.05s ease-out;
  `,
};
