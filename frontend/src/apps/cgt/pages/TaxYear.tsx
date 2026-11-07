import { AlertTriangle, CalendarCheck, FileText, Info } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../../platform/api';
import { useParam } from '../../../platform/components/Controls';
import { useOverview } from '../useOverview';
import FieldErrors from '../../../platform/components/FieldErrors';
import SectionCard from '../../../platform/components/SectionCard';
import StatCard from '../../../platform/components/StatCard';
import { ErrorState, LoadingState } from '../../../platform/components/States';
import { euro, longDate, shares, shortDate, wholeEuro, type Disposal, type Overview, type YearSummary } from '../cgt';

/** How a sale's shares were matched, and anything restricting its loss. */
function Matching({ disposal }: { disposal: Disposal }) {
  return (
    <details className="cgt-matching">
      <summary>How</summary>
      <ul>
        {disposal.matches.map((m) => (
          <li key={`${m.purchaseId}-${m.rule}`}>
            {shares(m.quantity)} bought {shortDate(m.purchased)}, cost {euro(m.costEur)}
            {m.rule === 'FOUR_WEEKS' ? ' (bought in the four weeks before the sale: matched first)' : ' (the earliest still held)'}
          </li>
        ))}
        {disposal.unmatchedQuantity > 0 && (
          <li className="text-danger">{shares(disposal.unmatchedQuantity)} sold without a purchase recorded: their cost is missing.</li>
        )}
        {disposal.feesEur > 0 && <li>Fees of the sale: {euro(disposal.feesEur)}</li>}
        {disposal.restrictedLossEur > 0 && (
          <li>
            {euro(disposal.restrictedLossEur)} of the loss is restricted: the same shares were bought back within four weeks, so it
            only counts against a gain on selling those shares.
          </li>
        )}
        {disposal.restrictedLossUsedEur > 0 && (
          <li>{euro(disposal.restrictedLossUsedEur)} restricted loss of an earlier sale of these shares is set against this gain.</li>
        )}
        {disposal.restrictedLossLostEur > 0 && (
          <li>{euro(disposal.restrictedLossLostEur)} restricted loss of an earlier sale couldn't be used: these shares sold at a loss.</li>
        )}
      </ul>
    </details>
  );
}

/** "€230 at 33%, €3,000 at 31%", or "€1,730 taxed at 31%" in a year of one rate. */
function taxedAt(summary: YearSummary): string {
  const lines = summary.form11.netGainsByRate;
  if (lines.length === 1) return `${euro(summary.taxableGainEur)} taxed at ${lines[0].ratePercent}%`;
  return lines.map((l) => `${euro(l.initialNetGainEur + l.laterNetGainEur)} at ${l.ratePercent}%`).join(', ');
}

function Payments({ summary }: { summary: YearSummary }) {
  const refund = summary.laterPaymentEur < 0;
  return (
    <div className="stat-grid">
      <StatCard
        label={`Pay by ${longDate(summary.initialDue)}`}
        value={euro(summary.initialPaymentEur)}
        hint="CGT on sales from January to November"
        emphasis
      />
      <StatCard
        label={refund ? 'Refund due' : `Pay by ${longDate(summary.laterDue)}`}
        value={euro(Math.abs(summary.laterPaymentEur))}
        hint={refund ? "December's losses lower the year's CGT: claim it on the return" : "CGT on December's sales"}
        tone={refund ? 'positive' : 'neutral'}
      />
      <StatCard
        label={`CGT for ${summary.year}`}
        value={euro(summary.taxEur)}
        hint={taxedAt(summary)}
      />
      <StatCard
        label={`Losses carried to ${summary.year + 1}`}
        value={euro(summary.lossesCarriedForwardEur)}
        hint="Set against later years' gains"
      />
    </div>
  );
}

function FormLink({ summary }: { summary: YearSummary }) {
  return (
    <SectionCard title="Form CG1 or Form 11" notes={[`the ${summary.year} return`, `file by ${longDate(summary.returnDue)}`]}>
      <p className="mb-2">
        {summary.disposalCount} {summary.disposalCount === 1 ? 'sale' : 'sales'} for {wholeEuro(summary.considerationEur)}; net chargeable gain{' '}
        {wholeEuro(summary.taxableGainEur)}.
      </p>
      <p className="mb-2 text-muted">Form CG1 when capital gains are all you have to declare; Form 11 if you file one anyway.</p>
      <div className="cgt-form-links">
        <Link to={`/cgt/cg1?year=${summary.year}`} className="btn btn-primary">
          <FileText size={16} aria-hidden /> Fill in Form CG1, item by item
        </Link>
        <Link to={`/cgt/form11?year=${summary.year}`} className="btn btn-outline-primary">
          <FileText size={16} aria-hidden /> Fill in Form 11, line by line
        </Link>
      </div>
    </SectionCard>
  );
}

function Sales({ summary }: { summary: YearSummary }) {
  if (summary.disposals.length === 0) return null;
  const twoRates = new Set(summary.disposals.map((d) => d.ratePercent)).size > 1;
  return (
    <SectionCard title={`Sales in ${summary.year}`} notes={['In euro at each day’s ECB rate', 'the gain or loss that counts for the year']}>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Shares</th>
              <th scope="col">Sale price</th>
              <th scope="col">Cost</th>
              <th scope="col">Gain or loss</th>
              <th scope="col">Matched with</th>
            </tr>
          </thead>
          <tbody>
            {summary.disposals.map((d) => (
              <tr key={d.saleId}>
                <th scope="row">
                  {shortDate(d.date)}
                  {twoRates && <span className="cgt-row-note"> at {d.ratePercent}%</span>}
                </th>
                <td>
                  {shares(d.quantity)} {d.symbol}
                </td>
                <td>{euro(d.proceedsEur)}</td>
                <td>{euro(d.costEur)}</td>
                <td className={d.allowableEur < 0 ? 'cgt-loss' : d.allowableEur > 0 ? 'cgt-gain' : ''}>{euro(d.allowableEur)}</td>
                <td>
                  <Matching disposal={d} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function Holdings({ overview }: { overview: Overview }) {
  if (overview.holdings.length === 0) return null;
  return (
    <SectionCard title="Shares held now" notes={['What they cost in euro, fees included']}>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Shares</th>
              <th scope="col">Cost</th>
              <th scope="col">Cost a share</th>
            </tr>
          </thead>
          <tbody>
            {overview.holdings.map((h) => (
              <tr key={h.symbol}>
                <th scope="row">{h.symbol}</th>
                <td>{shares(h.quantity)}</td>
                <td>{euro(h.costEur)}</td>
                <td>{euro(h.costEur / h.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function EarlierLosses({ amount, onSaved }: { amount: number; onSaved: () => void }) {
  const [value, setValue] = useState(String(amount));
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api('/cgt/settings', { method: 'PUT', body: { lossesBefore: Number(value.replace(',', '.')) || 0 } });
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Losses from earlier years" notes={['Unused losses from before the first sale recorded here']}>
      <FieldErrors error={error} />
      <form className="cgt-inline-form" onSubmit={save}>
        <label htmlFor="losses-before" className="form-label">
          Unused losses (€)
        </label>
        <input
          id="losses-before"
          className="form-control form-control-sm"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="btn btn-sm btn-outline-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
      <p className="cgt-note">From your earlier returns: losses not yet set against gains. They're used before the exemption.</p>
    </SectionCard>
  );
}

function About() {
  return (
    <SectionCard title="About these figures">
      <ul className="cgt-about">
        <li>
          Irish CGT for one person: 33%, or 31% for sales from 7 October 2026 (Budget 2027), after the year's €1,270 exemption;
          the year's losses, then earlier losses, come off the gains first. In 2026, with gains at both rates, the losses and the
          exemption come off the 33% gains first, which leaves the least tax.
        </li>
        <li>
          Each sale is matched with shares bought in the four weeks before it, then with the earliest still held. A loss is
          restricted when the same shares are bought back within four weeks.
        </li>
        <li>Foreign trades are in euro at the ECB's rate of their own day, so currency moves are part of the gain.</li>
        <li>
          Shares from an RSU vest or an ESPP purchase cost their market value on the day: what was taxed through payroll, not what
          you paid.
        </li>
        <li>
          Not covered: ETFs and other funds (exit tax, not CGT), a spouse's or civil partner's gains and losses, shares held
          since before 2003, and assets other than shares.
        </li>
        <li>A helper, not tax advice: check anything unusual with Revenue or an adviser.</li>
      </ul>
    </SectionCard>
  );
}

/** The CGT calculator's tax year: what to pay and when, and the figures for Form CG1 or Form 11. */
export default function TaxYear() {
  const [year, setYear] = useParam('year');
  const { overview: current, error, loading, reload } = useOverview(year);
  const summary = current?.summary;

  return (
    <div className="tool-page">
      <header className="page-header">
        <div className="page-icon" aria-hidden>
          <CalendarCheck size={22} />
        </div>
        <div className="page-heading">
          <div className="page-eyebrow">CGT calculator</div>
          <h1>Tax year{summary ? ` ${summary.year}` : ''}</h1>
          <p className="page-description">Irish capital gains tax on your share sales: what to pay by when, and the figures for Form CG1 or Form 11.</p>
        </div>
      </header>
      {current && (
        <div className="page-controls">
          <div className="control">
            <label className="control-label" htmlFor="cgt-year">
              Tax year
            </label>
            <select
              id="cgt-year"
              className="form-select form-select-sm"
              value={String(current.summary.year)}
              onChange={(e) => setYear(e.target.value)}
            >
              {current.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : current && summary ? (
        <>
          {summary.problems.length > 0 && (
            <div className="alert alert-warning cgt-problems" role="alert">
              <AlertTriangle size={18} aria-hidden />
              <div>
                <strong>These figures aren't right yet:</strong>
                <ul>
                  {summary.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {summary.disposalCount === 0 && (
            <div className="state-card">
              <Info size={28} aria-hidden />
              <div>
                <div className="state-title">No sales in {summary.year}</div>
                <div className="state-text">
                  Record your share purchases and sales (RSUs and ESPP shares included) under{' '}
                  <Link to="/cgt/transactions">Purchases &amp; sales</Link>; the CGT follows from them.
                </div>
              </div>
            </div>
          )}
          {summary.disposalCount > 0 && <Payments summary={summary} />}
          {summary.disposalCount > 0 && <FormLink summary={summary} />}
          <Sales summary={summary} />
          <Holdings overview={current} />
          <EarlierLosses key={current.lossesBefore} amount={current.lossesBefore} onSaved={reload} />
          <About />
        </>
      ) : (
        <LoadingState />
      )}
    </div>
  );
}
