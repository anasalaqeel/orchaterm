import { useEffect } from 'react';
import { BrowserRouter } from 'react-router';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { DashboardProvider } from './context/DashboardContext';
import { AppRoutes } from './routes/AppRoutes';
import { registerShortcut } from './services/keyboardManager';

const ZOOM_STEP = 0.1;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 2.0;
const ZOOM_KEY  = 'app-zoom';

// ── Entry point ───────────────────────────────────────────────────────────────
// Thin: providers + router only. Routes live in routes/AppRoutes.tsx.

export default function App() {
  useEffect(() => {
    const win = getCurrentWebviewWindow();

    // Restore persisted zoom on launch.
    const saved = parseFloat(localStorage.getItem(ZOOM_KEY) ?? '1');
    const initial = isFinite(saved) ? Math.min(Math.max(saved, ZOOM_MIN), ZOOM_MAX) : 1;
    if (initial !== 1) win.setZoom(initial);

    let current = initial;

    const applyZoom = (factor: number) => {
      current = Math.min(Math.max(Math.round(factor * 10) / 10, ZOOM_MIN), ZOOM_MAX);
      win.setZoom(current);
      localStorage.setItem(ZOOM_KEY, String(current));
    };

    const zoomIn    = () => applyZoom(current + ZOOM_STEP);
    const zoomOut   = () => applyZoom(current - ZOOM_STEP);
    const zoomReset = () => applyZoom(1);

    const removals = [
      // Ctrl+= (same physical key as + on most keyboards, no shift needed)
      registerShortcut({ key: '=', ctrl: true, context: 'non-terminal', handler: zoomIn }),
      // Ctrl++ (Shift+=) — some keyboards / locales send this
      registerShortcut({ key: '+', ctrl: true, shift: true, context: 'non-terminal', handler: zoomIn }),
      // Ctrl+- (zoom out)
      registerShortcut({ key: '-', ctrl: true, context: 'non-terminal', handler: zoomOut }),
      // Ctrl+0 (reset)
      registerShortcut({ key: '0', ctrl: true, context: 'non-terminal', handler: zoomReset }),
    ];

    return () => removals.forEach(r => r());
  }, []);

  return (
    <DashboardProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </DashboardProvider>
  );
}
