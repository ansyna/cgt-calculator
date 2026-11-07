import { ArrowLeftRight, CalendarCheck, FileText, FileUp } from 'lucide-react';
import { NavLink } from 'react-router';

/** The CGT calculator's sidebar. */
export function CgtMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="nav-group">
      <div className="nav-group-title">CGT calculator</div>
      <NavLink to="/cgt" end className="nav-item-link" onClick={onNavigate}>
        <CalendarCheck size={17} aria-hidden />
        <span>Tax year</span>
      </NavLink>
      <NavLink to="/cgt/cg1" className="nav-item-link" onClick={onNavigate}>
        <FileText size={17} aria-hidden />
        <span>Form CG1 worksheet</span>
      </NavLink>
      <NavLink to="/cgt/form11" className="nav-item-link" onClick={onNavigate}>
        <FileText size={17} aria-hidden />
        <span>Form 11 worksheet</span>
      </NavLink>
      <NavLink to="/cgt/transactions" className="nav-item-link" onClick={onNavigate}>
        <ArrowLeftRight size={17} aria-hidden />
        <span>Purchases &amp; sales</span>
      </NavLink>
      <NavLink to="/cgt/import" className="nav-item-link" onClick={onNavigate}>
        <FileUp size={17} aria-hidden />
        <span>Import a statement</span>
      </NavLink>
    </div>
  );
}
