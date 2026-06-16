import { useEffect, useRef, useState } from 'react';
import { BrowserRouter } from 'react-router';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { DashboardProvider } from './context/DashboardContext';
import { AppRoutes } from './routes/AppRoutes';
import { registerShortcut } from './services/keyboardManager';

const ZOOM_STEP = 0.1;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 2.0;
const ZOOM_KEY  = 'app-zoom';
const TOAST_MS  = 1500;

// ── Entry point ───────────────────────────────────────────────────────────────
// Thin: providers + router only. Routes live in routes/AppRoutes.tsx.

export default function App() {
  const [zoomPct, setZoomPct]   = useState<number | null>(null);
  const [visible, setVisible]   = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const win = getCurrentWebviewWindow();

    // Restore persisted zoom on launch.
    const saved = parseFloat(localStorage.getItem(ZOOM_KEY) ?? '1');
    const initial = isFinite(saved) ? Math.min(Math.max(saved, ZOOM_MIN), ZOOM_MAX) : 1;
    if (initial !== 1) win.setZoom(initial).catch(console.error);

    let current = initial;

    const applyZoom = (factor: number) => {
      current = Math.min(Math.max(Math.round(factor * 10) / 10, ZOOM_MIN), ZOOM_MAX);
      win.setZoom(current).catch(console.error);
      localStorage.setItem(ZOOM_KEY, String(current));

      const pct = Math.round(current * 100);
      setZoomPct(pct);
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), TOAST_MS);
    };

    const zoomIn    = () => applyZoom(current + ZOOM_STEP);
    const zoomOut   = () => applyZoom(current - ZOOM_STEP);
    const zoomReset = () => applyZoom(1);

    // context: 'non-terminal' — zoom keys are reserved everywhere EXCEPT when a
    // terminal is focused. Inside a terminal these combos pass through to the
    // shell (full-passthrough policy), so they no longer double-fire.
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

    return () => {
      removals.forEach(r => r());
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const isDefault = zoomPct === 100;

  return (
    <DashboardProvider>
      <BrowserRouter>
        <AppRoutes />
        <div
          style={{
            position:        'fixed',
            bottom:          '28px',
            left:            '50%',
            transform:       `translateX(-50%) scale(${visible ? 1 : 0.88})`,
            opacity:         visible ? 1 : 0,
            pointerEvents:   'none',
            transition:      'opacity 0.15s ease, transform 0.15s ease',
            zIndex:          9999,
            display:         'flex',
            alignItems:      'center',
            gap:             '6px',
            padding:         '5px 14px',
            borderRadius:    'var(--radius-full)',
            background:      'var(--bg-tertiary)',
            border:          '1px solid var(--border-color)',
            backdropFilter:  'blur(8px)',
            fontFamily:      'var(--font-family-mono)',
            fontSize:        'var(--font-size-sm)',
            fontWeight:      'var(--font-weight-medium)',
            color:           isDefault ? 'var(--color-success)' : 'var(--text-primary)',
            boxShadow:       '0 4px 16px rgba(0,0,0,0.3)',
            whiteSpace:      'nowrap',
          }}
        >
          {zoomPct !== null && `${zoomPct}%`}
          {isDefault && (
            <span style={{ color: 'var(--color-success)', fontSize: 'var(--font-size-xs)', opacity: 0.8 }}>
              default
            </span>
          )}
        </div>
      </BrowserRouter>
    </DashboardProvider>
  );
}
