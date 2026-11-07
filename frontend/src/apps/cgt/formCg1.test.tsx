import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVESTOR, loggedInAs, renderApp } from '../../test/helpers';
import type { Overview, Transaction } from './cgt';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })));
afterEach(() => vi.unstubAllGlobals());

/**
 * 2025: an RSU vest of 150 ACME on 1 July, 70 sold to cover the tax the next day and 60 in August (gains 12.30 and
 * 262.80), and 40 of a 75-share October vest sold at a loss of 1.80; 500 of losses from earlier years.
 */
function overview(changes: Partial<Overview['summary']> = {}): Overview {
  const sale = (saleId: number, date: string, quantity: number, proceedsEur: number, costEur: number, purchaseId: number, purchased: string) => ({
    saleId, date, symbol: 'ACME', quantity, proceedsEur, feesEur: 0, costEur, gainEur: proceedsEur - costEur,
    restrictedLossUsedEur: 0, restrictedLossLostEur: 0, restrictedLossEur: 0, allowableEur: Math.round((proceedsEur - costEur) * 100) / 100,
    ratePercent: 33, unmatchedQuantity: 0, matches: [{ purchaseId, purchased, quantity, costEur, rule: 'FOUR_WEEKS' as const }],
  });
  return {
    years: [2026, 2025],
    lossesBefore: 500,
    holdings: [],
    summary: {
      year: 2025,
      disposalCount: 3,
      considerationEur: 6136.2,
      initialPeriod: { gainsEur: 275.1, lossesEur: 1.8 },
      laterPeriod: { gainsEur: 0, lossesEur: 0 },
      gainsEur: 275.1,
      lossesEur: 1.8,
      lossesBroughtForwardEur: 500,
      lossesUsedEur: 273.3,
      chargeableGainEur: 0,
      exemptionEur: 0,
      taxableGainEur: 0,
      taxEur: 0,
      initialPaymentEur: 0,
      initialDue: '2025-12-15',
      laterPaymentEur: 0,
      laterDue: '2026-01-31',
      returnDue: '2026-10-31',
      lossesCarriedForwardEur: 226.7,
      gainsByRate: [{ ratePercent: 33, amountEur: 275.1 }],
      form11: {
        gainsNetOfLossesEur: 273.3,
        currentLossesCarriedForwardEur: 0,
        earlierLossesCarriedForwardEur: 226.7,
        initialNetGainEur: 0,
        laterNetGainEur: 0,
        netGainsByRate: [{ ratePercent: 33, initialNetGainEur: 0, laterNetGainEur: 0 }],
        sharesAcquired: 2,
        sharesAcquiredEur: 7379.83,
      },
      problems: [],
      disposals: [
        sale(11, '2025-06-17', 70, 2520.4, 2508.1, 1, '2025-06-16'),
        sale(12, '2025-08-13', 60, 2412.6, 2149.8, 1, '2025-06-16'),
        sale(13, '2025-09-16', 40, 1203.2, 1205, 2, '2025-09-15'),
      ],
      ...changes,
    },
  };
}

const VEST: Transaction = {
  id: 1, kind: 'BUY', date: '2025-06-16', symbol: 'ACME', quantity: 150, price: 39.8, currency: 'USD', fees: 0, eurRate: 1.18,
  source: 'RSU', note: null, eurValue: 5059.32, ecbRate: null, ecbRateDate: null, enteredIn: 'CGT' as const, name: null,
};

function server(summary: Partial<Overview['summary']> = {}, transactions: Transaction[] = [VEST]) {
  return loggedInAs(INVESTOR, (url) => {
    if (url.startsWith('/api/cgt/overview')) return { body: overview(summary) };
    if (url === '/api/cgt/transactions') return { body: transactions };
    return undefined;
  });
}

/** What an item says to enter, by its number and question. */
function entry(line: string, label: string | RegExp): string {
  const row = screen
    .getAllByRole('rowheader', { name: line })
    .map((header) => header.closest('tr') as HTMLElement)
    .find((tr) => (typeof label === 'string' ? tr.textContent?.includes(label) : label.test(tr.textContent ?? '')));
  if (!row) throw new Error(`no item ${line} ${label}`);
  return row.querySelectorAll('td')[1].textContent ?? '';
}

describe('CGT calculator: the Form CG1 worksheet', () => {
  afterEach(() => vi.useRealTimers());

  it("gives Form CG1 2025's items, in whole euro, what to tick and what to leave blank", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
    server();
    renderApp('/cgt/cg1?year=2025');
    await screen.findByRole('heading', { level: 1, name: 'Form CG1 for 2025' });
    await screen.findAllByText('Tick ☒ Self');
    // quoted shares: the consideration only (the form has no number of disposals for them)
    expect(entry('1(a)', 'Aggregate Consideration')).toBe('€6,136');
    expect(screen.queryByText(/No. of Disposals/)).toBeNull();
    expect(entry('1(l)', 'Total Consideration')).toBe('€6,136');
    expect(entry('2', 'connected parties')).toBe('Leave blank');
    // the shares sold came from an RSU vest
    expect(entry('4', 'original acquisitions')).toBe('Tick ☒ Self');
    expect(entry('5', 'market value')).toBe('Tick ☒ Self');
    expect(entry('6(a) – (f)', 'Claim to Reliefs - Self')).toBe('Leave blank');
    expect(entry('10', 'Chargeable gains in the year')).toBe('€275');
    expect(entry('11', 'Losses in the year')).toBe('€2');
    expect(entry('14', 'net of allowable current year losses')).toBe('€273');
    expect(entry('17', 'unused Loss(es) from prior year(s)')).toBe('€273');
    // the earlier losses take the whole gain: no exemption, a net chargeable gain of nothing
    expect(entry('18', 'Personal Exemption')).toBe('Leave blank');
    expect(entry('19', 'Net Chargeable Gain')).toBe('€0');
    expect(entry('22', 'Unused Loss(es) from prior year(s) for carry forward to 2026')).toBe('€227');
    expect(entry('23', 'Total Unused Loss(es) for carry forward to 2026')).toBe('€227');
    expect(entry('24(a)', '1 January – 30 November 2025')).toBe('€0');
    expect(entry('25(a)', '1 December – 31 December 2025')).toBe('€0');
    // no panel M on Form CG1
    expect(screen.queryByText(/Panel M|Number of Assets/)).toBeNull();
    // after 31 August 2026: the self-assessment is the user's, €0 where there's nothing
    expect(screen.getByText(/the return needs your own self-assessment: fill in item 28/)).toBeTruthy();
    expect(entry('28(a)', 'chargeable gains arising')).toBe('€0');
    expect(entry('28(b)', 'tax chargeable')).toBe('€0');
    expect(entry('28(e)', 'tax payable')).toBe('€0');
    expect(entry('28(h)', 'paid directly')).toBe('€0');
    expect(entry('28(i)(i)', 'Balance of tax payable')).toBe('€0');
    expect(screen.getByText(/No CGT to pay for 2025: losses from earlier years and the €1,270 exemption cover the gains/)).toBeTruthy();
    const workings = within(screen.getByRole('region', { name: 'Workings' }));
    expect(workings.getByRole('rowheader', { name: '17 Jun 2025, 70 ACME' }).closest('tr')?.textContent).toContain('€12.30');
    expect(screen.getAllByRole('link', { name: 'Form 11 worksheet' }).map((l) => l.getAttribute('href'))).toContain('/cgt/form11?year=2025');
  });

  it('splits the net gain between the payment periods, and works out the balance from what was paid', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));
    server(
      {
        lossesBroughtForwardEur: 0, lossesUsedEur: 0, chargeableGainEur: 3300, exemptionEur: 1270, taxableGainEur: 2030, taxEur: 669.9,
        initialPaymentEur: 339.9, laterPaymentEur: 330, lossesCarriedForwardEur: 0,
        form11: {
          gainsNetOfLossesEur: 3300, currentLossesCarriedForwardEur: 0, earlierLossesCarriedForwardEur: 0, initialNetGainEur: 1030,
          laterNetGainEur: 1000, netGainsByRate: [{ ratePercent: 33, initialNetGainEur: 1030, laterNetGainEur: 1000 }],
          sharesAcquired: 0, sharesAcquiredEur: 0,
        },
      },
      [],
    );
    renderApp('/cgt/cg1?year=2025');
    await screen.findByRole('heading', { level: 1, name: 'Form CG1 for 2025' });
    expect(entry('18', 'Personal Exemption')).toBe('€1,270');
    expect(entry('19', 'Net Chargeable Gain')).toBe('€2,030');
    expect(entry('24(a)', '1 January – 30 November 2025')).toBe('€1,030');
    expect(entry('25(a)', '1 December – 31 December 2025')).toBe('€1,000');
    // not from an employer: nothing to tick
    expect(entry('4', 'original acquisitions')).toBe('Leave blank');
    // before 31 August: Revenue can work it out
    expect(screen.getByText(/Send the return by 31 August 2026 and Revenue works out the self-assessment for you/)).toBeTruthy();
    // the net chargeable gain, after the losses and the exemption (item 19)
    expect(entry('28(a)', 'chargeable gains arising')).toBe('€2,030');
    expect(entry('28(b)', 'tax chargeable')).toBe('€670');
    expect(entry('28(e)', 'tax payable')).toBe('€670');
    expect(entry('28(i)(i)', 'Balance of tax payable')).toBe('Item (e) less item (h)');
    fireEvent.change(screen.getByLabelText('CGT you paid for 2025 (€)'), { target: { value: '339,90' } });
    await waitFor(() => expect(entry('28(h)', 'paid directly')).toBe('€340'));
    expect(entry('28(i)(i)', 'Balance of tax payable')).toBe('€330');
  });

  it('needs no items 24 and 25 after an overall loss', async () => {
    server({
      gainsEur: 100, lossesEur: 400, lossesBroughtForwardEur: 0, lossesUsedEur: 0, chargeableGainEur: 0, lossesCarriedForwardEur: 300,
      form11: {
        gainsNetOfLossesEur: 0, currentLossesCarriedForwardEur: 300, earlierLossesCarriedForwardEur: 0, initialNetGainEur: 0, laterNetGainEur: 0,
        netGainsByRate: [{ ratePercent: 33, initialNetGainEur: 0, laterNetGainEur: 0 }], sharesAcquired: 0, sharesAcquiredEur: 0,
      },
    });
    renderApp('/cgt/cg1?year=2025');
    await screen.findByRole('heading', { level: 1, name: 'Form CG1 for 2025' });
    expect(entry('21', 'Current Year Loss(es) for carry forward to 2026')).toBe('€300');
    expect(entry('24(a)', '1 January – 30 November 2025')).toBe('Not needed: an overall loss');
    expect(entry('25(a)', '1 December – 31 December 2025')).toBe('Not needed: an overall loss');
  });

  it("leaves item numbers out for another year's form, and has nothing to declare without a sale", async () => {
    server({ year: 2024, returnDue: '2025-10-31' });
    renderApp('/cgt/cg1?year=2024');
    await screen.findByRole('heading', { level: 1, name: 'Form CG1 for 2024' });
    expect(screen.getByText(/Item numbers are left out/)).toBeTruthy();
    expect(screen.queryAllByRole('rowheader', { name: '10' })).toHaveLength(0);
    expect(screen.getByText('Chargeable gains in the year before S. 604A relief')).toBeTruthy();
  });

  it("works the return out at the ECB rates as well, the two side by side, the trades as entered", async () => {
    // at the ECB's: the August sale €10 higher, so the year's consideration and gains too
    const atEcb = overview();
    atEcb.summary = {
      ...atEcb.summary,
      considerationEur: 6146.2,
      gainsEur: 285.1,
      form11: { ...atEcb.summary.form11, gainsNetOfLossesEur: 283.3 },
      disposals: atEcb.summary.disposals.map((d) => (d.saleId === 12 ? { ...d, proceedsEur: 2422.6, allowableEur: 272.8 } : d)),
    };
    const asked: string[] = [];
    loggedInAs(INVESTOR, (url) => {
      if (url.startsWith('/api/cgt/overview')) {
        asked.push(url);
        return { body: url.includes('rates=ECB') ? atEcb : overview() };
      }
      if (url === '/api/cgt/transactions') return { body: [VEST] };
      return undefined;
    });
    renderApp('/cgt/cg1?year=2025');
    await screen.findByRole('heading', { level: 1, name: 'Form CG1 for 2025' });
    // the rates entered, to begin with
    expect(entry('1(a)', 'Aggregate Consideration')).toBe('€6,136');
    const compared = within(await screen.findByRole('table', { name: "The rates entered and the ECB's" }));
    expect(compared.getByRole('rowheader', { name: 'What the shares sold for' }).closest('tr')!.textContent).toBe('What the shares sold for€6,136.20€6,146.20+€10.00');
    expect(compared.getByRole('rowheader', { name: 'Net chargeable gain' }).closest('tr')!.textContent).toContain('—');
    const workings = within(screen.getByRole('region', { name: 'Workings' }));
    expect(workings.getByRole('rowheader', { name: '13 Aug 2025, 60 ACME' }).closest('tr')!.textContent).toContain('€262.80€2,422.60');

    // the return at the ECB rates
    fireEvent.click(screen.getByRole('radio', { name: 'ECB rate of the day' }));
    await waitFor(() => expect(entry('1(a)', 'Aggregate Consideration')).toBe('€6,146'));
    expect(entry('10', 'Chargeable gains in the year')).toBe('€285');
    expect(screen.getAllByText(/the return uses the ECB rates/, { selector: '.section-notes' })).toHaveLength(2);
    expect(asked.some((u) => u.includes('rates=ECB'))).toBe(true);
  });

  it('has nothing to declare in a year without a sale', async () => {
    server({ disposalCount: 0, disposals: [] });
    renderApp('/cgt/cg1?year=2025');
    expect(await screen.findByText('No sales in 2025')).toBeTruthy();
  });
});
