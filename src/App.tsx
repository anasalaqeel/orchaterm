import { DashboardProvider, useDashboard } from './context/DashboardContext';
import { Sidebar } from './components/Sidebar';
import { Toast } from './components/Toast';
import { QuickSwitcher } from './components/QuickSwitcher';
import { DashboardView } from './components/DashboardView';
import { AgentsView } from './components/AgentsView';
import { TaskLogView } from './components/TaskLogView';
import { PromptVaultView } from './components/PromptVaultView';
import { SettingsView } from './components/SettingsView';
import { css } from '@emotion/css';

function AppContent() {
  const { activeView, isLoaded } = useDashboard();

  if (!isLoaded) {
    return (
      <div className={styles.loaderWrapper}>
        <div className={styles.loaderContent}>
          <div className={styles.spinner}></div>
          <span className={styles.loaderText}>Loading AgentDeck...</span>
        </div>
      </div>
    );
  }

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <DashboardView />;
      case 'agents':
        return <AgentsView />;
      case 'logs':
        return <TaskLogView />;
      case 'prompts':
        return <PromptVaultView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className={styles.appLayout}>
      {/* Left Navigation Sidebar */}
      <Sidebar />
      
      {/* Primary Workspace View Panel */}
      <main className={styles.mainContent}>
        {renderView()}
      </main>

      {/* Global Modals & Notifications */}
      <QuickSwitcher />
      <Toast />
    </div>
  );
}

function App() {
  return (
    <DashboardProvider>
      <AppContent />
    </DashboardProvider>
  );
}

export default App;

const styles = {
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
    border-radius: var(--border-radius-full);
    animation: spin 1s linear infinite;
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `,
  loaderText: css`
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  `,
  appLayout: css`
    display: flex;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    transition: background-color 200ms ease, color 200ms ease;
  `,
  mainContent: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    position: relative;
    overflow: hidden;
  `
};
