import { AlertTriangle, RotateCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError, scrub } from '../monitoring';

/** A part of the app that couldn't be downloaded: usually a new version was deployed since the page was opened. */
export function isLoadError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|Failed to fetch/i.test(
    error.message,
  );
}

/**
 * Shows a way out instead of a blank page when a page crashes, and reports the crash. A new {@code resetKey} (e.g.
 * another ticker in the address) tries the page again.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const error = this.state.error;
    const update = isLoadError(error);
    return (
      <div className="state-card state-error" role="alert">
        <AlertTriangle size={28} aria-hidden />
        <div>
          <div className="state-title">{update ? 'The app was updated' : 'Something went wrong on this page'}</div>
          <div className="state-text">
            {update ? 'Reload to get the new version.' : 'Reload the page, or pick another page from the menu.'}
          </div>
          {!update && (
            <details className="state-details">
              <summary>What went wrong</summary>
              <code>{scrub(error.message || String(error)).slice(0, 300)}</code>
            </details>
          )}
          <button type="button" className="btn btn-sm btn-outline-primary mt-2" onClick={() => window.location.reload()}>
            <RotateCw size={14} aria-hidden /> Reload
          </button>
        </div>
      </div>
    );
  }
}
