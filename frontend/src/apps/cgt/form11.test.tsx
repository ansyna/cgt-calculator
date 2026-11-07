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

/** What a line says to enter, by its number and question. */
function entry(line: string, label: string | RegExp): string {
  const row = screen
    .getAllByRole('rowheader', { name: line })
    .map((header) => header.closest('tr') as HTMLElement)
    .find((tr) => (typeof label === 'string' ? tr.textContent?.includes(label) : label.test(tr.textContent ?? '')));
  if (!row) throw new Error(`no line ${line} ${label}`);
  return row.querySelectorAll('td')[1].textContent ?? '';
}

describe('CGT calculator: the Form 11 worksheet', () => {
  it("gives panel L and M's lines of the 2025 form, in whole euro, and what to leave blank", async () => {
    server();
    renderApp('/cgt/form11?year=2025');
    await screen.findByRole('heading', { level: 1, name: 'Form 11 for 2025' });
    await screen.findAllByText('Probably T (Self)');
    expect(entry('801(a)', 'No. of Disposals')).toBe('3');
    expect(entry('801(a)', 'Aggregate Consideration')).toBe('€6,136');
    expect(entry('801(l)', 'Total Consideration')).toBe('€6,136');
    expect(entry('802', 'connected parties')).toBe('Leave blank');
    // the shares sold came from an RSU vest
    expect(entry('804', 'original acquisitions')).toBe('Probably T (Self)');
    expect(entry('805', 'market value')).toBe('Probably T (Self)');
    expect(entry('810', 'Chargeable gains in the year')).toBe('€275');
    expect(entry('811', 'Losses in the year')).toBe('€2');
    expect(entry('814', 'net of allowable current year losses')).toBe('€273');
    expect(entry('817', 'unused Loss(es) from prior year(s)')).toBe('€273');
    // the earlier losses take the whole gain: no exemption, no net gain, nothing for lines 824 and 825
    expect(entry('818', 'Personal Exemption')).toBe('Leave blank');
    expect(entry('819', 'Net Chargeable Gain')).toBe('Leave blank');
    expect(entry('822', 'Unused Loss(es) from prior year(s) for carry forward to 2026')).toBe('€227');
    expect(entry('823', 'Total Unused Loss(es) for carry forward to 2026')).toBe('€227');
    expect(entry('824(a)', '1 January – 30 November 2025')).toBe('Not needed: no net gain');
    // panel M: the two vests
    expect(entry('827(a)', 'Number of Assets')).toBe('2');
    expect(entry('827(a)', 'Shares (quoted and unquoted): Consideration')).toBe('€7,380');
    // the workings
    // no tax: nothing to pay, and nothing paid to enter
    expect(screen.getByText(/No CGT to pay for 2025: losses from earlier years and the €1,270 exemption cover the gains/)).toBeTruthy();
    expect(entry('937(h)', 'paid directly')).toBe('Leave blank');
    const workings = within(screen.getByRole('region', { name: 'Workings' }));
    expect(workings.getByRole('rowheader', { name: '17 Jun 2025, 70 ACME' }).closest('tr')?.textContent).toContain('€12.30');
  });

  it('splits the net gain between the payment periods, and works out the balance from what was paid', async () => {
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
    renderApp('/cgt/form11?year=2025');
    await screen.findByRole('heading', { level: 1, name: 'Form 11 for 2025' });
    expect(entry('818', 'Personal Exemption')).toBe('€1,270');
    expect(entry('819', 'Net Chargeable Gain')).toBe('€2,030');
    expect(entry('824(a)', '1 January – 30 November 2025')).toBe('€1,030');
    expect(entry('825(a)', '1 December – 31 December 2025')).toBe('€1,000');
    // not from an employer: nothing to tick
    expect(entry('804', 'original acquisitions')).toBe('Leave blank');
    expect(entry('827(a)', 'Number of Assets')).toBe('Leave blank');

    expect(entry('937(a)', 'chargeable gains arising')).toBe('€3,300');
    expect(entry('937(b)', 'tax chargeable')).toBe('€670');
    expect(entry('937(e)', 'tax payable')).toBe('€670');
    expect(entry('937(i)(i)', 'Balance of tax payable')).toBe('Line (e) less line (h)');
    fireEvent.change(screen.getByLabelText('CGT you paid for 2025 (€)'), { target: { value: '339,90' } });
    await waitFor(() => expect(entry('937(h)', 'paid directly')).toBe('€340'));
    expect(entry('937(i)(i)', 'Balance of tax payable')).toBe('€330');
    expect(screen.getByText(/for the sales of January to November was due by 15 December 2025/)).toBeTruthy();
  });

  it('has a line for each rate in 2026: 33% up to 6 October, 31% from 7 October', async () => {
    server(
      {
        year: 2026, lossesBroughtForwardEur: 0, lossesUsedEur: 0, chargeableGainEur: 5500, exemptionEur: 1270, taxableGainEur: 4230,
        taxEur: 1315.9, initialPaymentEur: 1005.9, laterPaymentEur: 310, lossesCarriedForwardEur: 0,
        initialDue: '2026-12-15', laterDue: '2027-01-31', returnDue: '2027-10-31',
        gainsByRate: [{ ratePercent: 33, amountEur: 2000 }, { ratePercent: 31, amountEur: 4000 }],
        form11: {
          gainsNetOfLossesEur: 5500, currentLossesCarriedForwardEur: 0, earlierLossesCarriedForwardEur: 0, initialNetGainEur: 3230,
          laterNetGainEur: 1000,
          netGainsByRate: [{ ratePercent: 33, initialNetGainEur: 230, laterNetGainEur: 0 }, { ratePercent: 31, initialNetGainEur: 3000, laterNetGainEur: 1000 }],
          sharesAcquired: 0, sharesAcquiredEur: 0,
        },
        disposals: [],
      },
      [],
    );
    renderApp('/cgt/form11?year=2026');
    await screen.findByRole('heading', { level: 1, name: 'Form 11 for 2026' });
    // the 2026 form isn't numbered here: the lines by their questions
    const line = (label: string) =>
      [...document.querySelectorAll('tr')].find((tr) => tr.querySelector('td')?.textContent?.includes(label))?.querySelectorAll('td')[1].textContent;
    expect(line('30 November 2026, to be charged at 33%')).toBe('€230');
    expect(line('31 December 2026, to be charged at 33%')).toBe('Leave blank');
    expect(line('30 November 2026, to be charged at 31%')).toBe('€3,000');
    expect(line('31 December 2026, to be charged at 31%')).toBe('€1,000');
    expect(screen.getByText(/The 2025 form has no 31% line/)).toBeTruthy();
    expect(screen.getByText('Line 819 at 33% and 31%.')).toBeTruthy();
  });

  it('copies a figure as the form takes it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      server();
      renderApp('/cgt/form11?year=2025');
      await screen.findByRole('heading', { level: 1, name: 'Form 11 for 2025' });
      fireEvent.click(screen.getAllByRole('button', { name: 'Copy line 801(a)' })[1]);
      expect(writeText).toHaveBeenCalledWith('6136');
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    }
  });

  it("leaves line numbers out for another year's form", async () => {
    server({ year: 2024, returnDue: '2025-10-31' });
    renderApp('/cgt/form11?year=2024');
    await screen.findByRole('heading', { level: 1, name: 'Form 11 for 2024' });
    expect(screen.getByText(/Line numbers are left out/)).toBeTruthy();
    expect(screen.queryAllByRole('rowheader', { name: '810' })).toHaveLength(0);
    expect(screen.getByText('Chargeable gains in the year before S. 604A relief')).toBeTruthy();
  });
});
