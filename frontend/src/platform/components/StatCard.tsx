import type { ReactNode } from 'react';

export type Tone = 'positive' | 'negative' | 'neutral';

export default function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  emphasis = false,
  unit,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  emphasis?: boolean;
  /** Currency of the value, e.g. "USD". */
  unit?: string | null;
}) {
  return (
    <div className={`stat-card tone-${tone} ${emphasis ? 'stat-emphasis' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && value !== '—' && <span className="unit"> {unit}</span>}
      </div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2.91T"-style amounts; non-numbers are shown as given ("—" when empty). */
export function formatCompact(value: unknown): string {
  return typeof value === 'number' ? compact.format(value) : value === '' || value == null ? '—' : String(value);
}

export function formatPrice(value: unknown): string {
  return typeof value === 'number' ? money.format(value) : value === '' || value == null ? '—' : String(value);
}
