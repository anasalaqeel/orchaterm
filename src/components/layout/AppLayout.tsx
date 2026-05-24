import { Outlet, useMatch } from 'react-router';
import { css } from '@emotion/css';
import { useDashboard } from '../../context/DashboardContext';
import { Sidebar } from './Sidebar';
import { DashboardView } from '../../pages/Overview';
import { QuickSwitcher } from '../ui/QuickSwitcher';
import { Toast } from '../ui/Toast';

// ── Loader ────────────────────────────────────────────────────────────────────

function Loader() {
  return (
    <div className={s.loaderWrapper}>
      <div className={s.loaderContent}>
        <div className={s.spinner} />
        <span className={s.loaderText}>Loading AgentDeck...</span>
      </div>
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
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    transition: background-color 200ms ease, color 200ms ease;
  `,
  main: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  `,
  visible: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: hidden;
  `,
  hidden: css`
    display: none;
  `,
  loaderWrapper: css`
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-primary);
    color: var(--text-primary);
  `,
  loaderContent: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  `,
  spinner: css`
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-brand);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
  loaderText: css`
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  `,
};
