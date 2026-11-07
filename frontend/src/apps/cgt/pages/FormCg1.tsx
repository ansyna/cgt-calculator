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

/** The form whose item numbers these are (checked against Revenue's Form CG1 2025); other years' may differ. */
const FORM_YEAR = 2025;

/** An item's entry: an amount in euro, a count, or what to do (leave it blank, tick it). */
type Entry = { amount: number } | { count: number } | { text: ReactNode };

interface Item {
  item: string;
  /** The question as the form puts it. */
  label: string;
  entry: Entry;
  /** Why, or what to check. */
  note?: ReactNode;
}

const BLANK: Entry = { text: 'Leave blank' };
const TICK: Entry = { text: 'Tick ☒ Self' };

/** An amount to enter, or blank when there's none (blank boxes, not zeros). */
function amount(value: number): Entry {
  return Math.round(value) === 0 ? BLANK : { amount: value };
}

/** An amount to enter, €0 included: a figure the form needs even when there's nothing. */
const figure = (value: number): Entry => ({ amount: value });

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
      onClick={() =>
        navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        )
      }
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

function Items({ items, numbered }: { items: Item[]; numbered: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table cgt-form-lines">
        <thead>
          <tr>
            {numbered && <th scope="col">Item</th>}
            <th scope="col">On the form</th>
            <th scope="col">Enter</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l, i) => (
            <tr key={`${l.item}-${i}`} className={l.entry === BLANK ? 'cgt-blank-line' : ''}>
              {numbered && <th scope="row">{l.item}</th>}
              <td>
                <span className="cgt-line-label">{l.label}</span>
                {l.note && <span className="cgt-line-note">{l.note}</span>}
              </td>
              <td>
                <EntryCell entry={l.entry} label={`item ${l.item}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Items 1 to 9: the disposals, what to tick, the reliefs and deferrals (none for shares sold on a stock exchange). */
function disposals(s: YearSummary, fromEmployer: boolean): Item[] {
  const employerNote = 'got through your job, so the law takes them as acquired at their market value (s.547). Ask Revenue if you’re unsure.';
  return [
    {
      item: '1(a)',
      label: 'Shares / Securities - Quoted: Aggregate Consideration',
      entry: amount(s.considerationEur),
      note: `What the ${s.disposalCount} ${s.disposalCount === 1 ? 'sale' : 'sales'} came to, in euro at each sale day’s ECB rate, before the sales’ fees. The form asks no number of disposals for quoted shares.`,
    },
    {
      item: '1(b) – (k)',
      label: 'Unquoted shares, land, buildings, foreign life policies, offshore funds, other assets',
      entry: BLANK,
      note: 'Only shares quoted on a stock exchange are worked out here.',
    },
    { item: '1(l)', label: 'Total Consideration', entry: amount(s.considerationEur) },
    {
      item: '2',
      label: "If any disposal was between connected parties or otherwise not at arm's length",
      entry: BLANK,
      note: 'Sales on a stock exchange are at arm’s length.',
    },
    { item: '3(a) – (b)', label: 'Deferred capital gains tax now due under S. 599(4A)(d)(i)', entry: BLANK },
    {
      item: '4',
      label: "If any of the original acquisitions were between connected parties or otherwise not at arm's length",
      entry: fromEmployer ? TICK : BLANK,
      note: fromEmployer ? `Shares you sold came from an RSU vest or ESPP: ${employerNote}` : undefined,
    },
    {
      item: '5',
      label: 'If the market value has been substituted for the cost of acquisition of any assets disposed of',
      entry: fromEmployer ? TICK : BLANK,
      note: fromEmployer ? 'An RSU vest’s cost is the shares’ market value that day (taxed through your payroll), not a price you paid.' : undefined,
    },
    {
      item: '6(a) – (f)',
      label: 'Claim to Reliefs - Self: principal private residence, retirement relief, a site to a child, farm restructuring, other',
      entry: BLANK,
      note: 'None apply to shares sold on a stock exchange.',
    },
    {
      item: '7(a) – (f)',
      label: 'Claim to Reliefs - Spouse or Civil Partner',
      entry: BLANK,
      note: 'Your spouse’s or civil partner’s own: not worked out here.',
    },
    { item: '8 – 9', label: 'Claim to defer payment under S. 599(4A)(c)', entry: BLANK },
  ];
}

/** Items 10 to 27: the gains and losses, the exemption, the net chargeable gain of each payment period. */
function gains(s: YearSummary): Item[] {
  const f = s.form11;
  const next = s.year + 1;
  // the year's losses as big as its gains or bigger: the form needs no items 24 and 25
  const overallLoss = f.gainsNetOfLossesEur <= 0;
  return [
    { item: '10', label: 'Chargeable gains in the year before S. 604A relief', entry: amount(s.gainsEur), note: 'The sales with a gain, added up.' },
    { item: '11', label: 'Losses in the year before S. 604A relief', entry: amount(s.lossesEur), note: 'The sales with a loss, added up.' },
    { item: '12', label: 'If any of the losses at item 11 refer to a loss to a connected person', entry: BLANK },
    { item: '13', label: 'Amount of gain relieved under S. 604A', entry: BLANK },
    {
      item: '14',
      label: 'Chargeable Gain(s) net of allowable current year losses and S. 604A relief (excluding Foreign Life Policies)',
      entry: amount(f.gainsNetOfLossesEur),
      note: 'Item 10 less item 11.',
    },
    { item: '15', label: 'Previous Gain(s) Rolled-over (now chargeable)', entry: BLANK },
    { item: '16', label: `Current year losses arising in ${s.year} available for offset against previous gains rolled over`, entry: BLANK },
    {
      item: '17',
      label: 'Amount of unused Loss(es) from prior year(s) available for, and offset against chargeable gains above',
      entry: amount(s.lossesUsedEur),
      note:
        s.lossesBroughtForwardEur > 0
          ? `Of ${wholeEuro(s.lossesBroughtForwardEur)} from earlier years: as much as the gains take.`
          : 'Losses carried from an earlier year’s return go here: enter that year’s sales too, and they’re counted.',
    },
    {
      item: '18',
      label: 'Personal Exemption (max €1,270 per spouse or civil partner and not transferable)',
      entry: amount(s.exemptionEur),
      note: 'As much as is left of the gains after the losses: losses, including losses forward, are used first.',
    },
    {
      item: '19',
      label: 'Net Chargeable Gain (excluding Foreign Life Policies)',
      entry: figure(s.taxableGainEur),
      note: 'Item 14 less items 17 and 18.',
    },
    { item: '20', label: 'Chargeable Gain on Foreign Life Policies', entry: BLANK },
    { item: '21', label: `Current Year Loss(es) for carry forward to ${next}`, entry: amount(f.currentLossesCarriedForwardEur) },
    { item: '22', label: `Unused Loss(es) from prior year(s) for carry forward to ${next}`, entry: amount(f.earlierLossesCarriedForwardEur) },
    { item: '23', label: `Total Unused Loss(es) for carry forward to ${next}`, entry: amount(s.lossesCarriedForwardEur) },
    ...f.netGainsByRate.flatMap((r) => {
      const at33 = r.ratePercent === 33;
      const two = f.netGainsByRate.length > 1;
      const notNeeded = { text: 'Not needed: an overall loss' };
      return [
        {
          item: at33 ? '24(a)' : '—',
          label: `Net gain that arose 1 January – 30 November ${s.year}, to be charged at ${r.ratePercent}%`,
          entry: overallLoss ? notNeeded : figure(r.initialNetGainEur),
          note: overallLoss
            ? undefined
            : `January to November’s gains${two ? ` from sales ${at33 ? 'up to 6 October' : 'from 7 October'}` : ''}, after the losses and the exemption.${at33 ? '' : ` The ${FORM_YEAR} form has no 31% item: use the ${s.year} form’s.`}`,
        },
        {
          item: at33 ? '25(a)' : '—',
          label: `Net gain that arose 1 December – 31 December ${s.year}, to be charged at ${r.ratePercent}%`,
          entry: overallLoss ? notNeeded : figure(r.laterNetGainEur),
          note: overallLoss || two ? undefined : 'Items 24(a) and 25(a) add up to item 19.',
        },
      ];
    }),
    {
      item: '24 – 25 (b) – (f)',
      label: 'Net gains at 40%, on foreign life policies, at 10% (Entrepreneur Relief), at 15% (Venture Fund Capital), CPO disposals',
      entry: BLANK,
    },
    { item: '26', label: 'Double Taxation Relief', entry: BLANK, note: 'Unless another country taxed one of these sales.' },
    { item: '27', label: 'Expression of Doubt', entry: BLANK, note: 'Only for a genuine doubt about how the law applies to an item.' },
  ];
}

/** The last day Revenue works out the self-assessment for a return sent in by then. */
const assessedByRevenueUntil = (year: number) => `${year + 1}-08-31`;

/** Item 28: the CGT self-assessment, with what was paid as the user enters it (kept on the account, as on the Form 11 page). */
function SelfAssessment({ summary }: { summary: YearSummary }) {
  const key = `cgt.paid.${summary.year}`;
  const paid = useSetting<string>(key, '');
  const paidAmount = Number(paid.replace(',', '.'));
  const known = paid.trim() !== '' && Number.isFinite(paidAmount);
  const balance = Math.round(summary.taxEur) - (known ? Math.round(paidAmount) : 0);
  const noTax = Math.round(summary.taxEur) === 0;
  const until = assessedByRevenueUntil(summary.year);
  const needed = new Date().toISOString().slice(0, 10) > until;
  const items: Item[] = [
    {
      item: '28(a)',
      label: 'Amount of chargeable gains arising for this period',
      entry: figure(summary.taxableGainEur),
      note: 'The net chargeable gain (item 19): the gains after the losses and the personal exemption. Some enter the gains before the exemption here (item 14 less item 17); the tax is the same either way.',
    },
    {
      item: '28(b)',
      label: 'Amount of tax chargeable for this period',
      entry: figure(summary.taxEur),
      note: `Item 19 at ${summary.form11.netGainsByRate.map((r) => `${r.ratePercent}%`).join(' and ')}.`,
    },
    { item: '28(c) – (d)', label: 'Tax deferred, or deferred tax now due, under S. 599(4A)', entry: BLANK },
    { item: '28(e)', label: 'Amount of tax payable for this period', entry: figure(summary.taxEur), note: 'All of it, even what you already paid.' },
    {
      item: '28(f) – (g)',
      label: 'Surcharges for filing late (S. 1084), or for Local Property Tax',
      entry: BLANK,
      note: `Only when sending the return after ${longDate(summary.returnDue)}, or with LPT not up to date.`,
    },
    {
      item: '28(h)',
      label: 'Amount of tax paid directly to the Collector-General for this period',
      entry: known ? figure(paidAmount) : noTax ? figure(0) : { text: 'What you paid (below)' },
      note: 'What you paid with CGT payslips A and B for the year.',
    },
    {
      item: balance >= 0 ? '28(i)(i)' : '28(i)(ii)',
      label: balance >= 0 ? 'Balance of tax payable for this period' : 'Balance of tax overpaid for this period',
      entry: known || noTax ? figure(Math.abs(balance)) : { text: 'Item (e) less item (h)' },
    },
  ];
  return (
    <SectionCard
      title="Item 28: Self-Assessment – Capital Gains Tax"
      notes={[needed ? `fill it in: it's after ${longDate(until)}` : `not needed if you send the return by ${longDate(until)}`, 'page 6']}
    >
      <p className="cgt-nothing">
        {needed
          ? `Sent after ${longDate(until)}, the return needs your own self-assessment: fill in item 28, €0 where there's nothing, and sign it on page 7.`
          : `Send the return by ${longDate(until)} and Revenue works out the self-assessment for you; the figures are here either way.`}
      </p>
      <Items items={items} numbered />
      <div className="control cgt-paid no-print">
        <label className="control-label" htmlFor="cg1-paid">
          CGT you paid for {summary.year} (€)
        </label>
        <input
          id="cg1-paid"
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
          {summary.lossesUsedEur > 0 ? 'losses from earlier years and the €1,270 exemption cover' : 'the €1,270 exemption covers'} the gains. The
          return is still needed: the sales go on it.
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
              December&apos;s losses lower the year&apos;s CGT by <strong>{euro(-summary.laterPaymentEur)}</strong>: the return claims it back.
            </>
          ) : (
            <>
              <strong>{euro(summary.laterPaymentEur)}</strong> for December&apos;s sales {due(summary.laterDue)} by {longDate(summary.laterDue)} (CGT
              payslip B).
            </>
          )}
        </li>
        <li>Not paid yet? Pay through myAccount&apos;s Payments, or ROS. Interest is charged from the due date.</li>
      </ul>
    </SectionCard>
  );
}

function AlsoOnTheForm({ year }: { year: number }) {
  return (
    <SectionCard title="Also on the form" notes={['not worked out here']}>
      <ul className="cgt-list">
        <li>
          Your <strong>Tax Reference Number</strong> (your PPS number) at the top of each page, and your name and address on page 1.
        </li>
        <li>
          <strong>Sign</strong> the declaration on page 1, and the self-assessment on page 7 when you fill in item 28.
        </li>
        <li>
          <strong>Bank details</strong> (page 5): only for a refund.
        </li>
        <li>
          <strong>RSU vests</strong> were taxed through your payroll as pay: they don&apos;t go on Form CG1. Only the sales do.
        </li>
        <li>
          <strong>Dividends</strong>, e.g. from a money market fund in your Fidelity account, are income, not capital gains: they go on an income tax
          return, not on Form CG1. Ask Revenue where a US fund&apos;s go.
        </li>
        <li>
          Filing a Form 11 for {year} anyway? The same figures go in its panel L instead:{' '}
          <Link to={`/cgt/form11?year=${year}`}>Form 11 worksheet</Link>.
        </li>
      </ul>
    </SectionCard>
  );
}

/** Form CG1, the capital gains tax return, for a tax year: item by item, ready to copy (or print and keep). */
export default function FormCg1() {
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

  // shares sold this year that came from an RSU vest or ESPP purchase (items 4, 5)
  const employerIds = new Set(transactions.filter((t) => t.source === 'RSU' || t.source === 'ESPP').map((t) => t.id));
  const fromEmployer = !!summary?.disposals.some((d) => d.matches.some((m) => employerIds.has(m.purchaseId)));
  const numbered = summary?.year === FORM_YEAR;

  return (
    <div className="tool-page cgt-form11 cgt-cg1">
      <header className="page-header">
        <div className="page-icon" aria-hidden>
          <FileText size={22} />
        </div>
        <div className="page-heading">
          <div className="page-eyebrow">CGT calculator</div>
          <h1>Form CG1{summary ? ` for ${summary.year}` : ''}</h1>
          <p className="page-description">
            The capital gains tax return, for when capital gains are all you have to declare: item by item, what to enter and what to leave blank.
          </p>
        </div>
      </header>
      {overview && (
        <div className="page-controls no-print">
          <div className="control">
            <label className="control-label" htmlFor="cg1-year">
              Tax year
            </label>
            <select
              id="cg1-year"
              className="form-select form-select-sm"
              value={String(overview.summary.year)}
              onChange={(e) => setYear(e.target.value)}
            >
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
              Send it by <strong>{longDate(summary.returnDue)}</strong>: after that, a surcharge of 5% of the tax (within two months) or 10%. The form
              takes whole euro, in the Self column.{' '}
              {numbered
                ? `Item numbers are those of Form CG1 ${FORM_YEAR}.`
                : `Item numbers are left out: they are those of Form CG1 ${FORM_YEAR}, and the ${summary.year} form may number them differently.`}{' '}
              Blank boxes stay blank.
            </div>
          </div>
          {summary.disposalCount === 0 ? (
            <div className="state-card">
              <Info size={28} aria-hidden />
              <div>
                <div className="state-title">No sales in {summary.year}</div>
                <div className="state-text">
                  Nothing to declare on Form CG1 without a sale. Add them under <Link to="/cgt/transactions">Purchases &amp; sales</Link>, or{' '}
                  <Link to="/cgt/import">import a statement</Link>.
                </div>
              </div>
            </div>
          ) : (
            <>
              <SectionCard title="Capital Gains: items 1 to 9" notes={[`1 January – 31 December ${summary.year}`, 'pages 2 and 3']}>
                <Items items={disposals(summary, fromEmployer)} numbered={numbered} />
              </SectionCard>
              <SectionCard title="Gains, losses, net chargeable gains: items 10 to 27" notes={['pages 3 to 5']}>
                <Items items={gains(summary)} numbered={numbered} />
              </SectionCard>
              <SelfAssessment key={summary.year} summary={summary} />
              <Payments summary={summary} />
              <RatesComparison entered={entered} ecb={ecb} atEcb={atEcb} />
              <ComparedWorkings summary={summary} entered={entered} ecb={ecb} atEcb={atEcb} />
              <AlsoOnTheForm year={summary.year} />
            </>
          )}
        </>
      ) : (
        <LoadingState />
      )}
    </div>
  );
}
