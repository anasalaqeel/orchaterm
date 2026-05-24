import { BrowserRouter } from 'react-router';
import { DashboardProvider } from './context/DashboardContext';
import { AppRoutes } from './routes/AppRoutes';

// ── Entry point ───────────────────────────────────────────────────────────────
// Thin: providers + router only. Routes live in routes/AppRoutes.tsx.

export default function App() {
  return (
    <DashboardProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </DashboardProvider>
  );
}
