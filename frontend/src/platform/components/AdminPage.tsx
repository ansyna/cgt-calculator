import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export default function AdminPage({ title, back, actions, children }: { title: string; back?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="d-flex align-items-center gap-2">
          {back && (
            <Link to={back} className="btn btn-icon" aria-label="Back">
              <ArrowLeft size={18} />
            </Link>
          )}
          <h1>{title}</h1>
        </div>
        {actions}
      </header>
      <div className="section-card">
        <div className="section-card-body">{children}</div>
      </div>
    </div>
  );
}
