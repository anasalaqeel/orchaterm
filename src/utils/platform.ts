// The webview's UA string reflects the host OS even though Tauri itself is
// cross-platform — standard trick for OS-specific layout/chrome decisions.
export const isMacOS =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
