import { AlertTriangle, Check, Copy, FileText, Info, Printer } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../../platform/api';
import { useParam } from '../../../platform/components/Controls';
import SectionCard from '../../../platform/components/SectionCard';
import { ErrorState, LoadingState } from '../../../platform/components/States';
import { saveSetting, useSetting } from '../../../platform/settings';
import { euro, longDate, wholeEuro, type Transaction, type YearSummary } from '../cgt';
import { ComparedWorkings, RatesComparison, RatesControl, useComparedOverviews } from '../components/RatesComparison';

/** The form whose line numbers these are (checked against Revenue's Form 11 2025); other years' may differ. */
const FORM_YEAR = 2025;

/** A line's entry: an amount in euro, a count, or what to do (leave it blank, tick it). */
type Entry = { amount: number } | { count: number } | { text: ReactNode };

interface Line {
  line: string;
  /** The question as the form puts it. */
  label: string;
  entry: Entry;
  /** Why, or what to check. */
  note?: ReactNode;
}

const BLANK: Entry = { text: 'Leave blank' };

/** An amount to enter, or blank when there's none (the form asks for blank lines, not zeros). */
function amount(value: number): Entry {
  return Math.round(value) === 0 ? BLANK : { amount: value };
}

/** Copies the figure as the form takes it: whole euro, no symbol or commas. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  if (typeof navigator === 'undefined' || !navigator.clipboard) return null;
  return (
    <button
      type="button"
      className="btn btn-icon btn-sm cgt-copy no-print"
      aria-label={`Copy ${label}`}
      title="Copy"
      onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true), () => undefined)}
    >
      {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
    </button>
  );
}

function EntryCell({ entry, label }: { entry: Entry; label: string }) {
  if ('amount' in entry) {
    const whole = Math.round(entry.amount);
    return (
      <span className="cgt-entry">
        <strong>{wholeEuro(whole)}</strong>
        <CopyButton value={String(whole)} label={label} />
      </span>
    );
  }
  if ('count' in entry) {
    return (
      <span className="cgt-entry">
        <strong>{entry.count}</strong>
        <CopyButton value={String(entry.count)} label={label} />
      </span>
    );
  }
  return <span className={entry === BLANK ? 'cgt-entry-blank' : 'cgt-entry-text'}>{entry.text}</span>;
}

function Lines({ lines, numbered }: { lines: Line[]; numbered: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table cgt-form-lines">
        <thead>
          <tr>
            {numbered && <th scope="col">Line</th>}
            <th scope="col">On the form</th>
            <th scope="col">Enter</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.line}-${i}`} className={l.entry === BLANK ? 'cgt-blank-line' : ''}>
              {numbered && <th scope="row">{l.line}</th>}
              <td>
                <span className="cgt-line-label">{l.label}</span>
                {l.note && <span className="cgt-line-note">{l.note}</span>}
              </td>
              <td>
                <EntryCell entry={l.entry} label={`line ${l.line}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Panel L: the year's disposals, gains and losses, and the net chargeable gain of each payment period. */
function panelL(s: YearSummary, fromEmployer: boolean): Line[] {
  const f = s.form11;
  const next = s.year + 1;
  const overallLoss = s.taxableGainEur <= 0;
  const employerNote = 'Shares from an RSU vest or ESPP were sold: confirm this with Revenue or a tax adviser.';
  return [
    { line: '801(a)', label: 'Shares / Securities - Quoted: No. of Disposals', entry: { count: s.disposalCount }, note: 'Each sale counts once.' },
    {
      line: '801(a)',
      label: 'Shares / Securities - Quoted: Aggregate Consideration',
      entry: amount(s.considerationEur),
      note: 'What the shares sold for, in euro at each sale day’s ECB rate, before the sale’s fees.',
    },
    { line: '801(l)', label: 'Total Consideration', entry: amount(s.considerationEur) },
    {
      line: '802',
      label: "If any disposal was between connected parties or otherwise not at arm's length",
      entry: BLANK,
      note: 'Sales on a stock exchange are at arm’s length.',
    },
    { line: '803', label: 'Deferred tax now due under S. 599(4A)(d)(i)', entry: BLANK },
    {
      line: '804',
      label: "If any of the original acquisitions were between connected parties or otherwise not at arm's length",
      entry: fromEmployer ? { text: 'Probably T (Self)' } : BLANK,
      note: fromEmployer ? `Shares you got from your employer weren't bought at arm's length. ${employerNote}` : undefined,
    },
    {
      line: '805',
      label: 'If the market value has been substituted for the cost of acquisition of any assets disposed of',
      entry: fromEmployer ? { text: 'Probably T (Self)' } : BLANK,
      note: fromEmployer ? `An RSU vest's cost is the shares' market value that day, not a price you paid. ${employerNote}` : undefined,
    },
    { line: '806 – 809', label: 'Claims to reliefs, claims to defer payment', entry: BLANK, note: 'None apply to shares sold on a stock exchange.' },
    { line: '810', label: 'Chargeable gains in the year before S. 604A relief', entry: amount(s.gainsEur), note: 'The sales with a gain, added up.' },
    { line: '811', label: 'Losses in the year before S. 604A relief', entry: amount(s.lossesEur), note: 'The sales with a loss, added up.' },
    { line: '812 – 813', label: 'Losses to a connected person; gain relieved under S. 604A', entry: BLANK },
    {
      line: '814',
      label: 'Chargeable Gain(s) net of allowable current year losses and S. 604A relief (excluding Foreign Life Policies)',
      entry: amount(f.gainsNetOfLossesEur),
      note: 'Line 810 less line 811.',
    },
    { line: '815 – 816', label: 'Previous gains rolled over (now chargeable)', entry: BLANK },
    {
      line: '817',
      label: 'Amount of unused Loss(es) from prior year(s) available for, and offset against chargeable gains above',
      entry: amount(s.lossesUsedEur),
      note: s.lossesBroughtForwardEur > 0 ? `Of ${wholeEuro(s.lossesBroughtForwardEur)} from earlier years: as much as the gains take.` : undefined,
    },
    {
      line: '818',
      label: 'Personal Exemption (max €1,270 per spouse or civil partner & not transferable)',
      entry: amount(s.exemptionEur),
      note: 'After the losses, as the form says.',
    },
    { line: '819', label: 'Net Chargeable Gain (excluding Foreign Life Policies)', entry: amount(s.taxableGainEur), note: 'Line 814 less lines 817 and 818.' },
    { line: '820', label: 'Chargeable Gain on Foreign Life Policies', entry: BLANK },
    { line: '821', label: `Current Year Loss(es) for carry forward to ${next}`, entry: amount(f.currentLossesCarriedForwardEur) },
    { line: '822', label: `Unused Loss(es) from prior year(s) for carry forward to ${next}`, entry: amount(f.earlierLossesCarriedForwardEur) },
    { line: '823', label: `Total Unused Loss(es) for carry forward to ${next}`, entry: amount(s.lossesCarriedForwardEur) },
    ...f.netGainsByRate.flatMap((r) => {
      const at33 = r.ratePercent === 33;
      const two = f.netGainsByRate.length > 1;
      return [
        {
          line: at33 ? '824(a)' : '—',
          label: `Net gain that arose 1 January – 30 November ${s.year}, to be charged at ${r.ratePercent}%`,
          entry: overallLoss ? { text: 'Not needed: no net gain' } : amount(r.initialNetGainEur),
          note: overallLoss
            ? undefined
            : `January to November’s gains${two ? ` from sales ${at33 ? 'up to 6 October' : 'from 7 October'}` : ''}, after the losses and the exemption.${at33 ? '' : ' The 2025 form has no 31% line: use the 2026 form’s.'}`,
        },
        {
          line: at33 ? '825(a)' : '—',
          label: `Net gain that arose 1 December – 31 December ${s.year}, to be charged at ${r.ratePercent}%`,
          entry: overallLoss ? { text: 'Not needed: no net gain' } : amount(r.laterNetGainEur),
          note: overallLoss || two ? undefined : 'Lines 824(a) and 825(a) add up to line 819.',
        },
      ];
    }),
    { line: '824 – 825 (b) – (f)', label: 'Net gains at 40%, 10%, 15%, CPO disposals', entry: BLANK },
    {
      line: '826',
      label: 'Relief for foreign tax on a disposal',
      entry: BLANK,
      note: 'Unless another country taxed one of these sales.',
    },
  ];
}

/** Panel M: the shares acquired in the year. */
function panelM(s: YearSummary): Line[] {
  const acquired = s.form11.sharesAcquired;
  return [
    {
      line: '827(a)',
      label: 'Shares (quoted and unquoted): Number of Assets',
      entry: acquired === 0 ? BLANK : { count: acquired },
      note: acquired === 0 ? undefined : 'Each purchase, RSU vest or ESPP purchase counts once.',
    },
    {
      line: '827(a)',
      label: 'Shares (quoted and unquoted): Consideration',
      entry: amount(s.form11.sharesAcquiredEur),
      note: acquired === 0 ? undefined : 'What they cost in euro, fees included; an RSU vest at its market value that day.',
    },
  ];
}

/** Line 937: the CGT self-assessment, with what was paid as the user enters it (kept on the account). */
function SelfAssessment({ summary }: { summary: YearSummary }) {
  const key = `cgt.paid.${summary.year}`;
  const paid = useSetting<string>(key, '');
  const paidAmount = Number(paid.replace(',', '.'));
  const known = paid.trim() !== '' && Number.isFinite(paidAmount);
  const balance = Math.round(summary.taxEur) - (known ? Math.round(paidAmount) : 0);
  const noTax = Math.round(summary.taxEur) === 0;
  const lines: Line[] = [
    {
      line: '937(a)',
      label: 'Amount of chargeable gains arising for this period',
      entry: amount(summary.chargeableGainEur),
      note: 'The gains after the losses (line 814 less line 817); the exemption is allowed for in the tax at (b).',
    },
    {
      line: '937(b)',
      label: 'Amount of tax chargeable for this period',
      entry: amount(summary.taxEur),
      note: `Line 819 at ${summary.form11.netGainsByRate.map((r) => `${r.ratePercent}%`).join(' and ')}.`,
    },
    { line: '937(c) – (d)', label: 'Tax deferred, or deferred tax now due, under S. 599(4A)', entry: BLANK },
    { line: '937(e)', label: 'Amount of tax payable for this period', entry: amount(summary.taxEur), note: 'All of it, even what you already paid.' },
    { line: '937(f) – (g)', label: 'Surcharges for filing late, or for LPT', entry: BLANK, note: 'Only when filing after the deadline.' },
    {
      line: '937(h)',
      label: 'Amount of tax paid directly to the Collector-General for this period',
      entry: known ? amount(paidAmount) : noTax ? BLANK : { text: 'What you paid (below)' },
      note: 'What you paid with CGT payslips A and B for the year; on ROS it is filled in for you.',
    },
    {
      line: balance >= 0 ? '937(i)(i)' : '937(i)(ii)',
      label: balance >= 0 ? 'Balance of tax payable for this period' : 'Balance of tax overpaid for this period',
      entry: known ? amount(Math.abs(balance)) : noTax ? BLANK : { text: 'Line (e) less line (h)' },
    },
  ];
  return (
    <SectionCard
      title={`Line 937: Self-Assessment – Capital Gains Tax`}
      notes={[`panel P`, `not needed if you file by 31 August ${summary.year + 1}`]}
    >
      <Lines lines={lines} numbered />
      <div className="control cgt-paid no-print">
        <label className="control-label" htmlFor="cgt-paid">
          CGT you paid for {summary.year} (€)
        </label>
        <input
          id="cgt-paid"
          className="form-control form-control-sm"
          inputMode="decimal"
          value={paid}
          onChange={(e) => saveSetting(key, e.target.value)}
        />
      </div>
    </SectionCard>
  );
}

function Payments({ summary }: { summary: YearSummary }) {
  const today = new Date().toISOString().slice(0, 10);
  const due = (date: string) => (date < today ? 'was due' : 'is due');
  if (summary.taxEur === 0) {
    return (
      <SectionCard title="Paying the CGT">
        <p className="mb-0">
          No CGT to pay for {summary.year}:{' '}
          {summary.lossesUsedEur > 0 ? 'losses from earlier years and the €1,270 exemption cover' : 'the €1,270 exemption covers'} the gains. The sales still go on the return.
        </p>
      </SectionCard>
    );
  }
  return (
    <SectionCard title="Paying the CGT" notes={['before the return: the tax is paid during the year']}>
      <ul className="cgt-list">
        <li>
          <strong>{euro(summary.initialPaymentEur)}</strong> for the sales of January to November {due(summary.initialDue)} by{' '}
          {longDate(summary.initialDue)} (CGT payslip A).
        </li>
        <li>
          {summary.laterPaymentEur < 0 ? (
            <>
              December&apos;s losses lower the year&apos;s CGT by <strong>{euro(-summary.laterPaymentEur)}</strong>: the return claims it
              back.
            </>
          ) : (
            <>
              <strong>{euro(summary.laterPaymentEur)}</strong> for December&apos;s sales {due(summary.laterDue)} by {longDate(summary.laterDue)}{' '}
              (CGT payslip B).
            </>
          )}
        </li>
        <li>
          Not paid yet? Pay through ROS, or myAccount&apos;s Payments if you don&apos;t use ROS. Interest is charged from the due date.
        </li>
      </ul>
    </SectionCard>
  );
}

function Elsewhere() {
  return (
    <SectionCard title="Elsewhere on Form 11" notes={['not worked out here']}>
      <ul className="cgt-list">
        <li>
          <strong>RSU vests</strong> were taxed through your payroll: they are part of your PAYE employment income, which ROS fills in.
          Don&apos;t enter them again.
        </li>
        <li>
          <strong>Dividends</strong>, e.g. from a money market fund in your Fidelity account, are foreign income. How a US fund is taxed
          in Ireland isn&apos;t simple: check with Revenue or a tax adviser where it goes.
        </li>
        <li>
          Not otherwise a chargeable person? The same capital gains figures can go on Form CG1 instead of Form 11.
        </li>
      </ul>
    </SectionCard>
  );
}

/** The capital gains parts of Form 11 for a tax year, line by line, ready to copy (or print and keep). */
export default function Form11() {
  const [year, setYear] = useParam('year');
  const { chosen, entered, ecb, atEcb } = useComparedOverviews(year);
  const { overview, error, loading } = chosen;
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const summary = overview?.summary;

  useEffect(() => {
    let cancelled = false;
    api<Transaction[]>('/cgt/transactions')
      .then((list) => !cancelled && setTransactions(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // shares sold this year that came from an RSU vest or ESPP purchase (lines 804, 805)
  const employerIds = new Set(transactions.filter((t) => t.source === 'RSU' || t.source === 'ESPP').map((t) => t.id));
  const fromEmployer = !!summary?.disposals.some((d) => d.matches.some((m) => employerIds.has(m.purchaseId)));
  const numbered = summary?.year === FORM_YEAR;

  return (
    <div className="tool-page cgt-form11">
      <header className="page-header">
        <div className="page-icon" aria-hidden>
          <FileText size={22} />
        </div>
        <div className="page-heading">
          <div className="page-eyebrow">CGT calculator</div>
          <h1>Form 11{summary ? ` for ${summary.year}` : ''}</h1>
          <p className="page-description">
            The capital gains parts of the return, line by line: what to enter, and what to leave blank.
          </p>
        </div>
      </header>
      {overview && (
        <div className="page-controls no-print">
          <div className="control">
            <label className="control-label" htmlFor="form11-year">
              Tax year
            </label>
            <select id="form11-year" className="form-select form-select-sm" value={String(overview.summary.year)} onChange={(e) => setYear(e.target.value)}>
              {overview.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <RatesControl />
          <button type="button" className="btn btn-outline-primary btn-sm align-self-end" onClick={() => window.print()}>
            <Printer size={16} aria-hidden /> Print or save as PDF
          </button>
        </div>
      )}
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : summary ? (
        <>
          {summary.problems.length > 0 && (
            <div className="alert alert-warning cgt-problems" role="alert">
              <AlertTriangle size={18} aria-hidden />
              <div>
                <strong>These figures aren&apos;t right yet:</strong>
                <ul>
                  {summary.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="alert alert-info cgt-form-intro" role="note">
            <Info size={18} aria-hidden />
            <div>
              File by <strong>{longDate(summary.returnDue)}</strong> (later if you pay and file on ROS: Revenue announces the date each
              year). The form takes whole euro.{' '}
              {numbered
                ? `Line numbers are those of Form 11 ${FORM_YEAR}.`
                : `Line numbers are left out: they are those of Form 11 ${FORM_YEAR}, and the ${summary.year} form may number them differently.`}{' '}
              Blank lines stay blank.
            </div>
          </div>
          {summary.disposalCount === 0 && summary.form11.sharesAcquired === 0 ? (
            <div className="state-card">
              <Info size={28} aria-hidden />
              <div>
                <div className="state-title">Nothing for panels L and M in {summary.year}</div>
                <div className="state-text">
                  No sales or purchases are recorded for {summary.year}. Add them under{' '}
                  <Link to="/cgt/transactions">Purchases &amp; sales</Link>, or <Link to="/cgt/import">import a statement</Link>.
                </div>
              </div>
            </div>
          ) : (
            <>
              {summary.disposalCount > 0 && (
                <SectionCard title="Panel L: Capital Gains" notes={[`1 January – 31 December ${summary.year}`, 'the Self column']}>
                  <Lines lines={panelL(summary, fromEmployer)} numbered={numbered} />
                </SectionCard>
              )}
              <SectionCard title={`Panel M: Chargeable assets acquired in ${summary.year}`} notes={['the Self column']}>
                <Lines lines={panelM(summary)} numbered={numbered} />
              </SectionCard>
              {summary.disposalCount > 0 && <SelfAssessment key={summary.year} summary={summary} />}
              {summary.disposalCount > 0 && <Payments summary={summary} />}
              <RatesComparison entered={entered} ecb={ecb} atEcb={atEcb} />
              <ComparedWorkings summary={summary} entered={entered} ecb={ecb} atEcb={atEcb} />
              <Elsewhere />
            </>
          )}
        </>
      ) : (
        <LoadingState />
      )}
    </div>
  );
}
