import { Routes, Route } from 'react-router';
import { AppLayout }    from '../components/layout/AppLayout';
import { TaskLogView }   from '../pages/TaskLog';
import { PromptVaultView } from '../pages/PromptVault';
import { SettingsView }  from '../pages/Settings';

// ── All application routes live here ─────────────────────────────────────────
// App.tsx stays thin (provider + router only).
// Add a new route: add one <Route> here — nothing else needs changing.

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* Dashboard / Overview — always-mounted via CSS in AppLayout */}
        <Route index element={null} />

        <Route path="/logs"      element={<TaskLogView />} />
        <Route path="/prompts"   element={<PromptVaultView />} />
        <Route path="/settings"  element={<SettingsView />} />
      </Route>
    </Routes>
  );
}
