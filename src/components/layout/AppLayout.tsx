import { Outlet, useMatch } from 'react-router';
import { useEffect } from 'react';
import { css } from '@emotion/css';
import { motion } from 'motion/react';
import { useDashboard } from '../../context/DashboardContext';
import { Sidebar } from './Sidebar';
import { DashboardView } from '../../pages/Overview';
import { QuickSwitcher } from '../ui/QuickSwitcher';
import { Toast } from '../ui/Toast';
import { ContinuationModal } from '../ui/ContinuationModal';
import { HelpModal } from '../ui/HelpModal';
import { registerShortcut } from '../../services/keyboardManager';
import logoDark from '../../assets/logos/icon-large-dark.svg';
import logoLight from '../../assets/logos/icon-large-light.svg';

// ── Loader ────────────────────────────────────────────────────────────────────

function Loader() {
  const { theme } = useDashboard();
  return (
    <div className={s.loaderWrapper}>
      <motion.div
        className={s.loaderContent}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className={s.loaderLogo}>
          <img src={theme === 'dark' ? logoDark : logoLight} className={s.loaderLogoImg} alt="Orchaterm" />
        </div>
        <div className={s.loaderDots}>
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className={s.loaderDot}
              animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1, 0.8] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ── AppLayout ─────────────────────────────────────────────────────────────────
// Layout route — renders for every path.
//
// DashboardView is kept permanently mounted (never unmounted) so that PTY
// terminal sessions survive navigation. It is shown on "/" and hidden on all
// other routes via CSS. Every other page renders through <Outlet />.

export function AppLayout() {
  const {
    isLoaded,
    pendingInjectionSnapshot,
    setPendingInjectionSnapshot,
    terminalSessions,
    settings,
    helpModalOpen,
    setHelpModalOpen,
  } = useDashboard();
  const onDashboard  = useMatch('/');

  // Ctrl+H / Cmd+H — open help (skipped when terminal has focus)
  useEffect(() => {
    return registerShortcut({
      key: 'h', ctrl: true,
      context: 'non-terminal',
      handler: () => {
        setHelpModalOpen(true);
      },
    });
  }, [setHelpModalOpen]);

  // Escape to close help modal when open
  useEffect(() => {
    if (!helpModalOpen) return;
    const removeEsc = registerShortcut({
      key: 'Escape',
      context: 'global',
      handler: () => {
        setHelpModalOpen(false);
      },
    });
    return () => removeEsc();
  }, [helpModalOpen, setHelpModalOpen]);

  if (!isLoaded) return <Loader />;

  return (
    <div className={s.app}>
      <Sidebar />

      <main className={s.main}>
        {/* Always mounted — CSS toggles visibility */}
        <div className={onDashboard ? s.visible : s.hidden}>
          <DashboardView />
        </div>

        {/* All other routes */}
        <Outlet />
      </main>

      <QuickSwitcher />
      <Toast />
      <HelpModal isOpen={helpModalOpen} onClose={() => setHelpModalOpen(false)} />
      {pendingInjectionSnapshot && (
        <ContinuationModal
          snapshot={pendingInjectionSnapshot}
          sessions={terminalSessions}
          targetSessionId={settings.continuation?.targetSessionId ?? null}
          onDismiss={() => setPendingInjectionSnapshot(null)}
        />
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  app: css`
    display: flex;
    height: 100vh; width: 100vw;
    overflow: hidden;
    background: var(--bg-canvas);
    color: var(--text-primary);
    position: relative;
  `,
  main: css`
    flex: 1;
    display: flex; flex-direction: column;
    min-width: 0; overflow: hidden;
  `,
  visible: css`
    display: flex; flex-direction: column;
    flex: 1; min-width: 0; height: 100%; overflow: hidden;
  `,
  hidden: css`display: none;`,
  loaderWrapper: css`
    width: 100vw; height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg-canvas);
  `,
  loaderContent: css`
    display: flex; flex-direction: column; align-items: center; gap: 18px;
  `,
  loaderLogo: css`
    display: flex; align-items: center; justify-content: center;
  `,
  loaderLogoImg: css`width: 52px; height: 52px; object-fit: contain;`,
  loaderDots: css`
    display: flex; align-items: center; gap: 7px;
  `,
  loaderDot: css`
    width: 7px; height: 7px;
    border-radius: 50%;
    background: var(--color-brand);
    display: inline-block;
  `,
};
