import { AlertTriangle } from 'lucide-react';

export function LoadingState() {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="visually-hidden">Loading…</span>
      <div className="skeleton-row">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton skeleton-stat" />
        ))}
      </div>
      <div className="skeleton skeleton-table" />
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state-card state-error" role="alert">
      <AlertTriangle size={28} aria-hidden />
      <div>
        <div className="state-title">Couldn't load this page</div>
        <div className="state-text">{message}</div>
      </div>
    </div>
  );
}
