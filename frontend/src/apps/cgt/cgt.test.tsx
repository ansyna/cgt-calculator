import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVESTOR, loggedInAs, renderApp } from '../../test/helpers';
import type { Overview, Transaction } from './cgt';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })));
afterEach(() => vi.unstubAllGlobals());

const sidebar = () => within(screen.getByRole('navigation', { name: 'Tools' }));

function overview(changes: Partial<Overview['summary']> = {}): Overview {
  return {
    years: [2026, 2025],
    lossesBefore: 0,
    holdings: [{ symbol: 'ACME', quantity: 40, costEur: 400 }],
    summary: {
      year: 2025,
      disposalCount: 1,
      considerationEur: 2400.4,
      initialPeriod: { gainsEur: 1790, lossesEur: 0 },
      laterPeriod: { gainsEur: 0, lossesEur: 0 },
      gainsEur: 1790,
      lossesEur: 0,
      lossesBroughtForwardEur: 500,
      lossesUsedEur: 500,
      chargeableGainEur: 1290,
      exemptionEur: 1270,
      taxableGainEur: 20,
      taxEur: 6.6,
      initialPaymentEur: 6.6,
      initialDue: '2025-12-15',
      laterPaymentEur: 0,
      laterDue: '2026-01-31',
      returnDue: '2026-10-31',
      lossesCarriedForwardEur: 0,
      gainsByRate: [{ ratePercent: 33, amountEur: 1790 }],
      form11: {
        gainsNetOfLossesEur: 1790,
        currentLossesCarriedForwardEur: 0,
        earlierLossesCarriedForwardEur: 0,
        initialNetGainEur: 20,
        laterNetGainEur: 0,
        netGainsByRate: [{ ratePercent: 33, initialNetGainEur: 20, laterNetGainEur: 0 }],
        sharesAcquired: 0,
        sharesAcquiredEur: 0,
      },
      problems: [],
      disposals: [
        {
          saleId: 2,
          date: '2025-06-02',
          symbol: 'ACME',
          quantity: 60,
          proceedsEur: 2400,
          feesEur: 10,
          costEur: 600,
          gainEur: 1790,
          restrictedLossUsedEur: 0,
          restrictedLossLostEur: 0,
          restrictedLossEur: 0,
          allowableEur: 1790,
          ratePercent: 33,
          unmatchedQuantity: 0,
          matches: [{ purchaseId: 1, purchased: '2020-02-03', quantity: 60, costEur: 600, rule: 'FIRST_IN_FIRST_OUT' }],
        },
      ],
      ...changes,
    },
  };
}

const PURCHASE: Transaction = {
  id: 1, kind: 'BUY', date: '2020-02-03', symbol: 'ACME', quantity: 100, price: 10, currency: 'EUR', fees: 0, eurRate: 1,
  source: 'RSU', note: null, eurValue: 1000, ecbRate: null, ecbRateDate: null, enteredIn: 'CGT' as const, name: null,
};
const SALE: Transaction = {
  id: 2, kind: 'SELL', date: '2025-06-02', symbol: 'ACME', quantity: 60, price: 40, currency: 'USD', fees: 10, eurRate: 1.17,
  source: null, note: null, eurValue: 2051.28, ecbRate: null, ecbRateDate: null, enteredIn: 'CGT' as const, name: null,
};

describe('CGT calculator: tax year', () => {
  it('shows what to pay by when, the return figures, the sales and the shares held', async () => {
    const fetchMock = loggedInAs(INVESTOR, (url) => (url.startsWith('/api/cgt/overview') ? { body: overview() } : undefined));
    renderApp('/cgt');
    await screen.findByRole('heading', { level: 1, name: 'Tax year 2025' });
    expect(screen.getByText('Pay by 15 December 2025').closest('.stat-card')?.textContent).toContain('€6.60');
    expect(screen.getByText('Pay by 31 January 2026')).toBeTruthy();

    // Form CG1 and Form 11 have their own pages, CG1 first
    const form = within(screen.getByRole('region', { name: 'Form CG1 or Form 11' }));
    expect(form.getByText(/1 sale for €2,400; net chargeable gain €20/)).toBeTruthy();
    const links = form.getAllByRole('link');
    expect(links.map((l) => [l.textContent?.trim(), l.getAttribute('href')])).toEqual([
      ['Fill in Form CG1, item by item', '/cgt/cg1?year=2025'],
      ['Fill in Form 11, line by line', '/cgt/form11?year=2025'],
    ]);

    const sales = within(screen.getByRole('region', { name: 'Sales in 2025' }));
    expect(sales.getByText('60 ACME')).toBeTruthy();
    expect(sales.getByText('60 bought 3 Feb 2020, cost €600.00 (the earliest still held)', { exact: false })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Shares held now' })).getByText('€10.00')).toBeTruthy();

    // another year
    fireEvent.change(screen.getByLabelText('Tax year'), { target: { value: '2026' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/cgt/overview?year=2026')).toBe(true));
    expect(screen.getByTestId('location').textContent).toBe('/cgt?year=2026');
  });

  it('says a December loss makes a refund, and warns when figures are missing', async () => {
    loggedInAs(INVESTOR, (url) =>
      url.startsWith('/api/cgt/overview')
        ? { body: overview({ laterPaymentEur: -330, problems: ['The sale of 8 ACME on 2025-06-02 is more than was bought (3 missing)'] }) }
        : undefined,
    );
    renderApp('/cgt');
    await screen.findByText('Refund due');
    expect(screen.getByRole('alert').textContent).toContain('3 missing');
  });

  it('points to recording purchases and sales when a year has none', async () => {
    loggedInAs(INVESTOR, (url) =>
      url.startsWith('/api/cgt/overview') ? { body: { ...overview({ disposalCount: 0, disposals: [] }), holdings: [] } } : undefined,
    );
    renderApp('/cgt');
    await screen.findByText('No sales in 2025');
    expect(screen.queryByText(/Pay by/)).toBeNull();
    const empty = screen.getByText('No sales in 2025').closest('.state-card') as HTMLElement;
    expect(within(empty).getByRole('link', { name: 'Purchases & sales' }).getAttribute('href')).toBe('/cgt/transactions');
  });

  it('saves losses from earlier years and works the year out again', async () => {
    let saved: unknown = null;
    const fetchMock = loggedInAs(INVESTOR, (url, init) => {
      if (url === '/api/cgt/settings') {
        saved = JSON.parse(String(init?.body));
        return { status: 204 };
      }
      return url.startsWith('/api/cgt/overview') ? { body: overview() } : undefined;
    });
    renderApp('/cgt');
    await screen.findByRole('heading', { level: 1, name: 'Tax year 2025' });
    fireEvent.change(screen.getByLabelText('Unused losses (€)'), { target: { value: '1200,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toEqual({ lossesBefore: 1200.5 }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/cgt/overview'))).toHaveLength(2));
  });

  it('has its own menu', async () => {
    loggedInAs(INVESTOR, (url) => (url.startsWith('/api/cgt/overview') ? { body: overview() } : undefined));
    renderApp('/cgt');
    await screen.findByRole('heading', { level: 1, name: 'Tax year 2025' });
    expect(sidebar().getByRole('link', { name: 'Tax year' }).getAttribute('href')).toBe('/cgt');
    // the CG1 worksheet above Form 11's
    const links = sidebar().getAllByRole('link').map((l) => l.textContent?.trim());
    expect(links.indexOf('Form CG1 worksheet')).toBe(links.indexOf('Form 11 worksheet') - 1);
    expect(sidebar().getByRole('link', { name: 'Form CG1 worksheet' }).getAttribute('href')).toBe('/cgt/cg1');
    expect(sidebar().getByRole('link', { name: 'Form 11 worksheet' }).getAttribute('href')).toBe('/cgt/form11');
    expect(sidebar().getByRole('link', { name: 'Purchases & sales' }).getAttribute('href')).toBe('/cgt/transactions');
    expect(screen.queryByRole('combobox', { name: /ticker/i })).toBeNull();
  });
});

describe('CGT calculator: purchases and sales', () => {
  function server(handlers: { rate?: (url: string) => { status?: number; body?: unknown } } = {}) {
    let transactions = [PURCHASE, SALE];
    const sent: { url: string; method: string; body: unknown }[] = [];
    const fetchMock = loggedInAs(INVESTOR, (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/market/rate')) return handlers.rate ? handlers.rate(url) : { body: { date: '2025-09-17', rate: 1.1712 } };
      if (url === '/api/cgt/transactions' && method === 'GET') return { body: transactions };
      if (url.startsWith('/api/cgt/transactions?') && method === 'DELETE') {
        sent.push({ url, method, body: null });
        const query = new URL(url, 'http://localhost').searchParams;
        const inPeriod = (t: Transaction) => t.date >= (query.get('from') ?? '') && t.date <= (query.get('to') ?? '');
        const deleted = transactions.filter(inPeriod).length;
        transactions = transactions.filter((t) => !inPeriod(t));
        return { body: { deleted } };
      }
      if (url.startsWith('/api/cgt/transactions')) {
        sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (method === 'DELETE') {
          transactions = transactions.filter((t) => !url.endsWith(`/${t.id}`));
          return { status: 204 };
        }
        return { status: method === 'POST' ? 201 : 200, body: PURCHASE };
      }
      return undefined;
    });
    return { fetchMock, sent };
  }

  it('lists them newest first', async () => {
    server();
    renderApp('/cgt/transactions');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('th')?.textContent)).toEqual(['2 Jun 2025', '3 Feb 2020']);
    expect(rows[1].textContent).toContain('RSU vest');
    expect(rows[0].textContent).toContain('40 USD');
    expect(rows[0].textContent).toContain('€2,051.28');
  });

  it('filters them by type and by share, and shows the rate used beside the ECB rate of the day', async () => {
    // by day, as the server has them
    const trades: Transaction[] = [
      { ...PURCHASE, id: 3, date: '2025-05-06', symbol: 'RY.TO', name: null, source: null, currency: 'CAD', eurRate: 1.56, ecbRate: null, ecbRateDate: null },
      { ...SALE, id: 4, date: '2025-05-14', symbol: 'KO', name: null, currency: 'EUR', eurRate: 1, ecbRate: 1, ecbRateDate: '2025-05-14' },
      { ...PURCHASE, id: 1, date: '2025-06-16', symbol: 'GLOBX', name: 'Globex', currency: 'USD', eurRate: 1.1797, ecbRate: 1.1797, ecbRateDate: '2025-06-16' },
      { ...SALE, id: 2, date: '2025-07-05', symbol: 'GLOBX', name: 'Globex', currency: 'USD', eurRate: 1.18, ecbRate: 1.1774, ecbRateDate: '2025-07-04' },
    ];
    loggedInAs(INVESTOR, (url) => (url === '/api/cgt/transactions' ? { body: trades } : undefined));
    renderApp('/cgt/transactions');
    const table = await screen.findByRole('table');
    const dates = () => within(table).getAllByRole('row').slice(1).map((r) => r.querySelector('th')?.textContent);
    const row = (date: string) => within(table).getByRole('rowheader', { name: date }).closest('tr')!.textContent;
    expect(dates()).toEqual(['5 Jul 2025', '16 Jun 2025', '14 May 2025', '6 May 2025']);

    // the rate entered, and the ECB's of the day: a Saturday's is the Friday's, and a different one is pointed out
    expect(row('16 Jun 2025')).toContain('1.1797 USD/€');
    expect(row('5 Jul 2025')).toContain('1.18 USD/€');
    expect(row('5 Jul 2025')).toContain('1.1774of 4 Jul 2025');
    expect(row('5 Jul 2025')).toContain('the rate used is 0.22% higher');
    expect(row('16 Jun 2025')).not.toContain('higher');
    // not looked up yet; in euro, no rate
    expect(row('6 May 2025')).toContain('Not yet');
    expect(row('14 May 2025')).not.toContain('/€');

    // sales only
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'sales' } });
    expect(dates()).toEqual(['5 Jul 2025', '14 May 2025']);
    expect(screen.getByText('2 of 4 · newest first')).toBeTruthy();
    // and of one share, by its name
    fireEvent.change(screen.getByLabelText('Share'), { target: { value: 'GLOBX' } });
    expect(dates()).toEqual(['5 Jul 2025']);
    expect(within(screen.getByLabelText('Share')).getByRole('option', { name: 'GLOBX · Globex' })).toBeTruthy();
    // purchases of it: none of the RSU vests sold
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'rsu' } });
    expect(dates()).toEqual(['16 Jun 2025']);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(dates()).toHaveLength(4);

    // from one day to another, both included
    fireEvent.change(screen.getByLabelText('Date from'), { target: { value: '2025-05-14' } });
    expect(dates()).toEqual(['5 Jul 2025', '16 Jun 2025', '14 May 2025']);
    fireEvent.change(screen.getByLabelText('Date to'), { target: { value: '2025-06-16' } });
    expect(dates()).toEqual(['16 Jun 2025', '14 May 2025']);
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'sales' } });
    expect(dates()).toEqual(['14 May 2025']);
    fireEvent.change(screen.getByLabelText('Share'), { target: { value: 'GLOBX' } });
    expect(dates()).toEqual([]);
    expect(screen.getByText('None matches these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(dates()).toHaveLength(4);
    expect((screen.getByLabelText('Date from') as HTMLInputElement).value).toBe('');
  });

  it("records a foreign purchase at the ECB's rate of the day", async () => {
    const { sent } = server();
    renderApp('/cgt/transactions');
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2025-09-17' } });
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('Price a share (USD)'), { target: { value: '117,12' } });
    fireEvent.change(screen.getByLabelText('Acquired as'), { target: { value: 'ESPP' } });
    await screen.findByText("The ECB's rate of 17 Sept 2025");
    expect((screen.getByLabelText('USD per euro') as HTMLInputElement).value).toBe('1.1712');
    fireEvent.click(screen.getByRole('button', { name: 'Add purchase' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      url: '/api/cgt/transactions',
      method: 'POST',
      body: { kind: 'BUY', date: '2025-09-17', symbol: 'ACME', quantity: 10, price: 117.12, currency: 'USD', fees: null,
        eurRate: 1.1712, source: 'ESPP', note: null },
    });
    // the form is cleared for the next one
    await waitFor(() => expect((screen.getByLabelText('Ticker') as HTMLInputElement).value).toBe(''));
  });

  it('takes the ticker, price and currency typed, and converts fees paid in another currency', async () => {
    const { sent } = server();
    renderApp('/cgt/transactions');
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2025-10-04' } });
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'acme' } });
    // no suggestions or prices looked up: what's typed
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(screen.getByLabelText('Price a share (USD)'), { target: { value: '117.12' } });
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '10' } });
    // fees in euro, converted at the ECB's rate (1.1712 USD per euro)
    fireEvent.change(screen.getByLabelText('Fees'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Fees currency'), { target: { value: 'EUR' } });
    expect(await screen.findByText("= 5.86 USD at the ECB's rates of the day")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add purchase' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({ symbol: 'ACME', date: '2025-10-04', price: 117.12, currency: 'USD', fees: 5.86, eurRate: 1.1712 });
  });

  it('takes a rate typed by hand, and asks for one when the ECB has none', async () => {
    const { sent } = server({ rate: () => ({ status: 404, body: { message: 'none' } }) });
    renderApp('/cgt/transactions');
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'GBP' } });
    await screen.findByText('No ECB rate found: enter the rate of the day');
    fireEvent.click(screen.getByRole('radio', { name: 'Sale' }));
    expect(screen.queryByLabelText('Acquired as')).toBeNull();
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'ACME' } });
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Price a share (GBP)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('GBP per euro'), { target: { value: '0.86' } });
    expect(screen.getByText('Your rate.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add sale' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toMatchObject({ kind: 'SELL', currency: 'GBP', eurRate: 0.86, source: null });
  });

  it("shows the server's objections", async () => {
    loggedInAs(INVESTOR, (url, init) => {
      if (url === '/api/cgt/transactions' && (init?.method ?? 'GET') === 'GET') return { body: [] };
      if (url === '/api/cgt/transactions') {
        return { status: 422, body: { message: 'The given data was invalid.', errors: { date: ["The date can't be in the future."] } } };
      }
      return url.startsWith('/api/market/rate') ? { body: { date: '2025-09-17', rate: 1.17 } } : undefined;
    });
    renderApp('/cgt/transactions');
    await screen.findByText('Nothing recorded yet');
    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'ACME' } });
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/^Price a share/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add purchase' }));
    expect((await screen.findByRole('alert')).textContent).toContain("The date can't be in the future.");
  });

  it("deletes a period's transactions at once, to import it again", async () => {
    const { sent } = server();
    renderApp('/cgt/transactions');
    await screen.findByRole('table');
    const period = within(screen.getByRole('region', { name: 'Delete a period' }));
    expect(period.getByRole('button', { name: 'Delete 0 transactions' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(period.getByRole('button', { name: '2025' }));
    expect((period.getByLabelText('From') as HTMLInputElement).value).toBe('2025-01-01');
    expect((period.getByLabelText('To') as HTMLInputElement).value).toBe('2025-12-31');
    fireEvent.click(period.getByRole('button', { name: 'Delete 1 transaction' }));
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Delete 1 transaction?' }));
    expect(dialog.getByText("Every purchase and sale from 1 Jan 2025 to 31 Dec 2025. This can't be undone.")).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await screen.findByText(/1 transaction from 1 Jan 2025 to 31 Dec 2025 deleted/);
    expect(sent).toEqual([{ url: '/api/cgt/transactions?from=2025-01-01&to=2025-12-31', method: 'DELETE', body: null }]);
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2));

    // a last day before the first
    fireEvent.change(period.getByLabelText('From'), { target: { value: '2020-12-31' } });
    fireEvent.change(period.getByLabelText('To'), { target: { value: '2020-01-01' } });
    expect(period.getByText("The last day can't be before the first.")).toBeTruthy();
  });

  it('changes and deletes them', async () => {
    const { sent } = server();
    renderApp('/cgt/transactions');
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Change ACME on 3 Feb 2020' }));
    await screen.findByRole('heading', { name: 'Change the transaction' });
    expect((screen.getByLabelText('Shares') as HTMLInputElement).value).toBe('100');
    expect((screen.getByLabelText('Acquired as') as HTMLSelectElement).value).toBe('RSU');
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ url: '/api/cgt/transactions/1', method: 'PUT', body: { quantity: 90, currency: 'EUR', eurRate: null } });
    await screen.findByRole('heading', { name: 'Record a purchase or sale' });

    // an ESPP purchase's cost is the market value that day, not the discounted price paid
    fireEvent.click(screen.getByRole('button', { name: 'Change ACME on 3 Feb 2020' }));
    await screen.findByRole('heading', { name: 'Change the transaction' });
    fireEvent.change(screen.getByLabelText('Acquired as'), { target: { value: 'ESPP' } });
    expect(screen.getByText('The market value on the purchase day, usually the close: check it against the purchase confirmation.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Price a share (EUR)'), { target: { value: '11.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ method: 'PUT', body: { price: 11.5, source: 'ESPP' } });
    await screen.findByRole('heading', { name: 'Record a purchase or sale' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete ACME on 2 Jun 2025' }));
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Delete this sale?' }));
    expect(dialog.getByText('60 ACME on 2 Jun 2025.')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]).toMatchObject({ url: '/api/cgt/transactions/2', method: 'DELETE' });
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2));
  });
});
