// The webview's UA string reflects the host OS even though Tauri itself is
// cross-platform — standard trick for OS-specific layout/chrome decisions.
export const isMacOS =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

// Linux UA strings contain "Linux" (incl. Android, which we don't target).
export const isLinux =
  typeof navigator !== 'undefined' &&
  /Linux/.test(navigator.userAgent) &&
  !/Android/.test(navigator.userAgent);
