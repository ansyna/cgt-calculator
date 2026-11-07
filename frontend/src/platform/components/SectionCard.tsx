import type { ReactNode } from 'react';

export function RatingLegend() {
  return (
    <span className="rating-legend" aria-label="Rating legend">
      <span className="rating-great">Great</span>
      <span className="rating-good">Good</span>
      <span className="rating-weak">Weak</span>
    </span>
  );
}

export function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** A titled card for one table or chart group; its id lets the page link to it. */
export default function SectionCard({
  title,
  notes = [],
  legend = false,
  children,
}: {
  title: string;
  notes?: string[];
  legend?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="section-card" id={slug(title)} aria-labelledby={`${slug(title)}-title`}>
      <div className="section-card-header">
        <div>
          <h2 id={`${slug(title)}-title`}>{title}</h2>
          {notes.length > 0 && <p className="section-notes">{notes.join(' · ')}</p>}
        </div>
        {legend && <RatingLegend />}
      </div>
      <div className="section-card-body">{children}</div>
    </section>
  );
}
