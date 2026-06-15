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
import { ArrowLeft } from 'lucide-react';
import { TerminalContainer } from '../terminal/TerminalContainer';
import { GroupChat } from '../ui/GroupChat';
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
  /** Invoked by the "Workspaces" back button. */
  onBack: () => void;
}

export const WorkspaceConsole = memo(function WorkspaceConsole({
  project,
  space,
  active,
  panelKey,
  onBack,
}: WorkspaceConsoleProps) {
  return (
    <div className={active ? s.consoleLayer : s.consoleLayerHidden}>
      {/* Console header */}
      <div className={s.consoleHeader}>
        <div className={s.consoleHeaderLeft}>
          <span className={s.consoleDot} style={{ backgroundColor: project.color }} />
          <h2 className={s.consoleName}>{project.name}</h2>
          <span className={s.consolePath}>{project.path}</span>

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
        </div>

        <motion.button whileHover={{ x: -2 }} onClick={onBack} className={s.backBtn}>
          <ArrowLeft size={13} />
          <span>Workspaces</span>
        </motion.button>
      </div>

      <ConsoleSplit
        active={active}
        terminal={
          <TerminalContainer
            key={panelKey}
            scopeKey={panelKey}
            workspaceId={project.id}
            workspacePath={project.path}
            active={active}
          />
        }
        chat={active && <GroupChat key={panelKey} workspaceId={project.id} />}
      />
    </div>
  );
});

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const s = {
  /* Console wrapper — CSS-toggled so TerminalContainer never unmounts */
  consoleLayer: css`
    display: flex; flex-direction: column;
    flex: 1; min-height: 0; overflow: hidden;
    background: var(--bg-canvas);
    animation: consoleFadeIn 0.22s ease forwards;
    @keyframes consoleFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0);   }
    }
  `,
  consoleLayerHidden: css`
    display: none;
  `,
  consoleHeader: css`
    padding: 10px 20px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    user-select: none;
  `,
  consoleHeaderLeft: css`
    display: flex; align-items: center; gap: 8px;
    min-width: 0; overflow: hidden;
  `,
  consoleDot: css`
    width: 9px; height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 8px var(--color-brand);
  `,
  consoleName: css`
    font-size: 13px; font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
  `,
  consolePath: css`
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--font-family-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  spacePill: css`
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 8px;
    border-radius: 99px;
    border: 1px solid;
    background: rgba(255,255,255,0.04);
    flex-shrink: 0;
  `,
  spacePillDot: css`
    width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
  `,
  spacePillName: css`
    font-size: 10px; font-weight: 600; white-space: nowrap;
  `,
  backBtn: css`
    display: flex; align-items: center; gap: 5px;
    background: transparent;
    color: var(--text-tertiary);
    padding: 5px 10px;
    border-radius: 8px;
    font-size: 11px; font-weight: 600;
    border: 1px solid var(--border-color);
    cursor: pointer; flex-shrink: 0;
    transition: all 0.15s;
    &:hover { border-color: var(--border-color-hover); color: var(--text-primary); background: var(--bg-hover); }
  `,
};
