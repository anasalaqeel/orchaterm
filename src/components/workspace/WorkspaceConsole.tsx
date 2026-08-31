/*
 * WorkspaceConsole.tsx
 *
 * The console view for a single workspace: header + a resizable split of
 * terminal (left) and GroupChat (right). Extracted out of the Overview/
 * DashboardView page so the page no longer owns terminal + chat + resize.
 *
 * Kept always-mounted by the parent (visibility toggled via the `active` prop →
 * CSS `display`) so PTY terminal sessions survive grid ↔ console switches.
 *
 * Resize state lives in <ConsoleSplit>, not here — so a drag re-renders only
 * that child, and the terminal/chat elements created here keep stable identity
 * and are skipped by React (no memo needed on them).
 */
import { memo } from 'react';
import { css } from '@emotion/css';
import { motion, AnimatePresence } from 'motion/react';
import { TerminalContainer } from '../terminal/TerminalContainer';
import { WindowControls } from '../layout/WindowControls';
import { RightPanel } from './RightPanel';
import { ConsoleSplit } from './ConsoleSplit';
import type { Workspace, Space } from '../../types/workspace.types';

interface WorkspaceConsoleProps {
  /** The workspace whose console this is. */
  project: Workspace;
  /** Active space within the workspace (for the header pill), or null. */
  space: Space | null;
  /** Whether the console is the visible view. When false it stays mounted but hidden. */
  active: boolean;
  /** Stable key tying the terminal + chat to the active workspace/space. */
  panelKey: string;
}

export const WorkspaceConsole = memo(function WorkspaceConsole({
  project,
  space,
  active,
  panelKey,
}: WorkspaceConsoleProps) {
  const headerRight = (
    <div className={s.consoleHeaderRight}>
      <span className={s.consoleDot} style={{ backgroundColor: project.color }} />
      <h2 className={s.consoleName}>{project.name}</h2>

      <AnimatePresence>
        {space && (
          <motion.div
            className={s.spacePill}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            style={{ borderColor: space.color + '40' }}
          >
            <span className={s.spacePillDot} style={{ backgroundColor: space.color }} />
            <span className={s.spacePillName} style={{ color: space.color }}>
              {space.name}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Window caption buttons — the native frame is disabled; these replace
          the old "← Workspaces" back button in this spot. The sidebar's
          Workspaces section covers grid navigation. */}
      <WindowControls flush />
    </div>
  );

  return (
    <div className={active ? s.consoleLayer : s.consoleLayerHidden}>
      <ConsoleSplit
        active={active}
        terminal={
          <TerminalContainer
            key={panelKey}
            scopeKey={panelKey}
            workspaceId={project.id}
            workspacePath={project.path}
            active={active}
            headerRight={headerRight}
          />
        }
        right={active && <RightPanel key={panelKey} workspaceId={project.id} />}
      />
    </div>
  );
});

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const s = {
  /* Console wrapper — CSS-toggled so TerminalContainer never unmounts */
  consoleLayer: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-canvas);
    animation: consoleFadeIn 0.22s ease forwards;
    @keyframes consoleFadeIn {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,
  consoleLayerHidden: css`
    display: none;
  `,
  consoleHeaderRight: css`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    user-select: none;
    /* Stretch the cluster to the tab strip's full height so the caption
       buttons sit flush against the window's top edge. */
    align-self: stretch;
  `,
  consoleDot: css`
    width: 9px;
    height: 9px;
    border-radius: 2px;
    flex-shrink: 0;
    box-shadow: 0 0 8px var(--color-brand);
  `,
  consoleName: css`
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  `,
  spacePill: css`
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 99px;
    border: 1px solid;
    background: rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
  `,
  spacePillDot: css`
    width: 5px;
    height: 5px;
    border-radius: 1px;
    flex-shrink: 0;
  `,
  spacePillName: css`
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
  `,
};
