/**
 * Formats a timestamp (number of milliseconds or ISO string) to a human-readable relative time string.
 */
export function formatRelative(time: number | string | null | undefined): string {
  if (!time) return '';
  try {
    const ms = typeof time === 'string' ? new Date(time).getTime() : time;
    if (isNaN(ms)) return '';
    const diff = Date.now() - ms;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return new Date(ms).toLocaleDateString();
  } catch {
    return '';
  }
}
