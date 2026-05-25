import { Outlet, useMatch } from 'react-router';
import { css } from '@emotion/css';
import { motion } from 'motion/react';
import { useDashboard } from '../../context/DashboardContext';
import { Sidebar } from './Sidebar';
import { DashboardView } from '../../pages/Overview';
import { QuickSwitcher } from '../ui/QuickSwitcher';
import { Toast } from '../ui/Toast';
import { Blocks } from 'lucide-react';

// ── Loader ────────────────────────────────────────────────────────────────────

function Loader() {
  return (
    <div className={s.loaderWrapper}>
      <motion.div
        className={s.loaderContent}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className={s.loaderLogo}>
          <Blocks size={22} style={{ color: '#fff' }} />
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
  const { isLoaded } = useDashboard();
  const onDashboard  = useMatch('/');

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
    width: 52px; height: 52px;
    border-radius: 16px;
    background: var(--gradient-brand);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 32px rgba(123, 104, 238, 0.35);
  `,
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
