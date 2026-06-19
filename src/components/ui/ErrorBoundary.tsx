import React from 'react';
import { css } from '@emotion/css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Rendered instead of children once an error is caught. Receives the error
   *  and a reset() that clears the boundary so children remount. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  /** Side-effect hook for logging / telemetry. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** When any value here changes, the boundary auto-resets. Pass a key that
   *  identifies the wrapped content (e.g. a session id) so a fresh mount is
   *  given a clean slate. */
  resetKeys?: unknown[];
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Isolates a subtree so a render/lifecycle throw degrades to a local fallback
 * instead of tearing down the whole React root (which renders a blank window).
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    // Auto-reset when the identifying keys change (e.g. switched session).
    if (this.state.error && !shallowEqual(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      return this.props.fallback
        ? this.props.fallback(error, this.reset)
        : (
          <div className={styles.fallback}>
            <span>Something went wrong rendering this view.</span>
            <button className={styles.retry} onClick={this.reset}>Retry</button>
          </div>
        );
    }
    return this.props.children;
  }
}

function shallowEqual(a?: unknown[], b?: unknown[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

const styles = {
  fallback: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-secondary);
    font-size: 13px;
  `,
  retry: css`
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
    background: var(--bg-tertiary);
    color: var(--text-primary);
    cursor: pointer;
    &:hover { background: var(--bg-secondary); }
  `,
};
