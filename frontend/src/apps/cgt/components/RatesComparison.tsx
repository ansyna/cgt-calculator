import { Fragment } from 'react';
import { SegmentedControl, useParam } from '../../../platform/components/Controls';
import SectionCard from '../../../platform/components/SectionCard';
import { euro, shares, shortDate, type Disposal, type YearSummary } from '../cgt';
import { useOverview } from '../useOverview';

/**
 * A return worksheet's rates: each trade at the rate it was entered with (what the money came to, a broker's say), or
 * at the ECB's of its day (Revenue's rule: the rate of the day bought or sold). The trades stay as entered either way:
 * only the worksheet's figures change.
 */
export function RatesControl() {
  return (
    <SegmentedControl
      name="rates"
      label="Exchange rates"
      options={[
        ['', 'As entered'],
        ['ECB', 'ECB rate of the day'],
      ]}
      fallback=""
    />
  );
}

/** The year at both rates: the one the worksheet uses (as the control has it), and each to compare. */
export function useComparedOverviews(year: string) {
  const [rates] = useParam('rates');
  const entered = useOverview(year);
  const ecb = useOverview(year, 'ECB');
  const atEcb = rates === 'ECB';
  return { chosen: atEcb ? ecb : entered, entered: entered.overview?.summary ?? null, ecb: ecb.overview?.summary ?? null, atEcb };
}

const LINES: [string, (s: YearSummary) => number][] = [
  ['What the shares sold for', (s) => s.considerationEur],
  ['Gains', (s) => s.gainsEur],
  ['Losses', (s) => s.lossesEur],
  ['Gains after the losses', (s) => s.form11.gainsNetOfLossesEur],
  ['Net chargeable gain', (s) => s.taxableGainEur],
  ['Tax', (s) => s.taxEur],
];

/** The year's figures at the rates entered and at the ECB's, side by side. */
export function RatesComparison({ entered, ecb, atEcb }: { entered: YearSummary | null; ecb: YearSummary | null; atEcb: boolean }) {
  if (!entered || !ecb || entered.year !== ecb.year || entered.disposalCount === 0) return null;
  return (
    <SectionCard title="The rates entered and the ECB's" notes={[`the return uses ${atEcb ? 'the ECB rates' : 'the rates entered'}`, 'the trades stay as entered']}>
      <p className="cgt-nothing">
        Revenue converts each purchase and sale at the rate of its own day; the ECB&apos;s reference rate is the usual one for it. A rate taken
        from the euro that reached your account is a broker&apos;s, often of a later day.
      </p>
      <div className="table-wrap">
        <table className="data-table cgt-rates-compared" aria-label="The rates entered and the ECB's">
          <thead>
            <tr>
              <th scope="col">{entered.year}</th>
              <th scope="col" className={atEcb ? undefined : 'cgt-rates-used'}>
                At the rates entered
              </th>
              <th scope="col" className={atEcb ? 'cgt-rates-used' : undefined}>
                At the ECB rates
              </th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {LINES.map(([label, f]) => {
              const apart = f(ecb) - f(entered);
              return (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{euro(f(entered))}</td>
                  <td>{euro(f(ecb))}</td>
                  <td>{Math.abs(apart) < 0.005 ? '—' : `${apart > 0 ? '+' : '−'}${euro(Math.abs(apart))}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function Figures({ d }: { d: Disposal | undefined }) {
  if (!d) {
    return (
      <>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
      </>
    );
  }
  return (
    <>
      <td>{euro(d.proceedsEur)}</td>
      <td>{d.feesEur ? euro(d.feesEur) : '—'}</td>
      <td>{euro(d.costEur)}</td>
      <td className={d.allowableEur < 0 ? 'text-danger' : ''}>{euro(d.allowableEur)}</td>
    </>
  );
}

/** Each sale worked out at the rates entered and at the ECB's: what it sold for, its fees, its cost, its gain or loss. */
export function ComparedWorkings({ summary, entered, ecb, atEcb }: { summary: YearSummary; entered: YearSummary | null; ecb: YearSummary | null; atEcb: boolean }) {
  if (summary.disposals.length === 0) return null;
  const byId = (s: YearSummary | null) => new Map((s?.year === summary.year ? s.disposals : []).map((d) => [d.saleId, d]));
  const asEntered = byId(entered);
  const atTheEcb = byId(ecb);
  return (
    <SectionCard title="Workings" notes={['keep them with your records', `the return uses ${atEcb ? 'the ECB rates' : 'the rates entered'}`]}>
      <div className="table-wrap">
        <table className="data-table cgt-workings">
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                Sale
              </th>
              <th scope="colgroup" colSpan={4} className={atEcb ? undefined : 'cgt-rates-used'}>
                At the rates entered
              </th>
              <th scope="colgroup" colSpan={4} className={atEcb ? 'cgt-rates-used' : undefined}>
                At the ECB rates
              </th>
              <th scope="col" rowSpan={2}>
                Shares sold were bought
              </th>
            </tr>
            <tr>
              {['entered', 'ECB'].map((group) => (
                <Fragment key={group}>
                  <th scope="col">Sold for</th>
                  <th scope="col">Fees</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Gain or loss</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.disposals.map((d) => (
              <tr key={d.saleId}>
                <th scope="row">
                  {shortDate(d.date)}, {shares(d.quantity)} {d.symbol}
                </th>
                <Figures d={asEntered.get(d.saleId)} />
                <Figures d={atTheEcb.get(d.saleId)} />
                <td>
                  {d.matches.map((m) => `${shares(m.quantity)} on ${shortDate(m.purchased)}`).join('; ')}
                  {d.unmatchedQuantity > 0 && <span className="text-danger"> {shares(d.unmatchedQuantity)} without a purchase</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
