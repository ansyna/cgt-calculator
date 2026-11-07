import SectionCard from './SectionCard';

/** The ticker of each company a statement names (it has no ticker column): given once, remembered on your account. */
export default function StatementTickers({
  companies,
  tickers,
  onChange,
}: {
  companies: string[];
  tickers: Record<string, string>;
  onChange: (company: string, ticker: string) => void;
}) {
  return (
    <SectionCard title="Tickers" notes={['the statement names companies, not tickers', 'remembered on your account']}>
      <div className="statement-columns">
        {companies.map((company, i) => (
          <div className="control" key={company}>
            <label className="control-label" htmlFor={`import-ticker-${i}`}>
              Ticker for {company}
            </label>
            <input
              id={`import-ticker-${i}`}
              className={`form-control form-control-sm statement-upper ${tickers[company] ? '' : 'is-invalid'}`}
              maxLength={12}
              autoCapitalize="characters"
              value={tickers[company] ?? ''}
              onChange={(e) => onChange(company, e.target.value)}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
