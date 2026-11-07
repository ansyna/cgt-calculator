import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVESTOR, loggedInAs, renderApp } from '../../test/helpers';
import type { Transaction } from './cgt';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })));
afterEach(() => vi.unstubAllGlobals());

const FIDELITY = `Brokerage

Run Date,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
09/17/2025,YOU SOLD ACME CORP COM (ACME) (Cash),ACME,ACME CORP COM,Cash,-10,117.12,,0.05,,1171.15,09/19/2025
09/15/2025,DIVIDEND RECEIVED ACME CORP COM (ACME) (Cash),ACME,ACME CORP COM,Cash,0,,,,,12.50,
08/15/2025,YOU BOUGHT ESPP### AS OF 08-15-25 ACME CORP COM (ACME) (Cash),ACME,ACME CORP,Cash,25,95.20,,,,0.00,
06/02/2025,SHARES DEPOSITED Conversion ACME CORP (ACME) (Cash),ACME,ACME CORP,Cash,40,,,,,0.00,

"Date downloaded 10/21/2025 3:14 pm"
`;

/** A server whose imports answer in turn (then succeed). */
function server(options: { existing?: Transaction[]; importAnswers?: { status: number; body: unknown }[] } = {}) {
  const sent: { transactions: Record<string, unknown>[] }[] = [];
  const answers = [...(options.importAnswers ?? [])];
  const fetchMock = loggedInAs(INVESTOR, (url, init) => {
    if (url === '/api/cgt/transactions') return { body: options.existing ?? [] };
    if (url === '/api/cgt/transactions/import') {
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      return answers.shift() ?? { status: 201, body: { imported: body.transactions.length } };
    }
    return undefined;
  });
  return { fetchMock, sent };
}

function choose(text: string, name = 'Accounts_History.csv') {
  const input = screen.getByLabelText('CSV statement');
  fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } });
}

const importButton = () => screen.getByRole('button', { name: /^Import \d+ transactions?$/ });

describe('CGT calculator: importing a statement', () => {
  it("reads Fidelity's export, asks for what's missing and imports all at once", async () => {
    const { sent } = server();
    renderApp('/cgt/import');
    await screen.findByRole('heading', { level: 1, name: 'Import a statement' });
    choose(FIDELITY);
    await screen.findByText("Read as Fidelity's account history", { exact: false });
    const preview = within(screen.getByRole('table'));
    // the dividend is left out (hidden until asked for); the shares deposited need their price
    expect(preview.queryByText(/DIVIDEND/)).toBeNull();
    expect((preview.getByLabelText('Import line 7 as') as HTMLSelectElement).value).toBe('RSU');
    // the vest's market value that day: asked for
    // the vest's and the ESPP purchase's market values that day: asked for
    expect(await screen.findByText('2 rows need a price (or leave them out)')).toBeTruthy();
    expect(preview.getByText(/Enter the vest day's market value/)).toBeTruthy();
    expect(preview.getByText(/You paid 95.2 USD a share, after the discount/)).toBeTruthy();
    expect(importButton().hasAttribute('disabled')).toBe(true);

    fireEvent.change(preview.getByLabelText('Price a share on line 7 (USD)'), { target: { value: '101,50' } });
    expect(importButton().hasAttribute('disabled')).toBe(true);
    fireEvent.change(preview.getByLabelText('Price a share on line 6 (USD)'), { target: { value: '112' } });
    expect(importButton().textContent).toBe('Import 3 transactions');
    fireEvent.click(importButton());
    await screen.findByText(/3 transactions imported/);
    expect(sent).toEqual([
      {
        transactions: [
          { kind: 'SELL', date: '2025-09-17', symbol: 'ACME', quantity: 10, price: 117.12, currency: 'USD', fees: 0.05, eurRate: null, source: null, note: 'Imported: YOU SOLD ACME CORP COM (ACME) (Cash)' },
          { kind: 'BUY', date: '2025-08-15', symbol: 'ACME', quantity: 25, price: 112, currency: 'USD', fees: null, eurRate: null, source: 'ESPP', note: 'Imported: YOU BOUGHT ESPP### AS OF 08-15-25 ACME CORP COM (ACME) (Cash); paid 95.2 USD a share' },
          { kind: 'BUY', date: '2025-06-02', symbol: 'ACME', quantity: 40, price: 101.5, currency: 'USD', fees: null, eurRate: null, source: 'RSU', note: 'Imported: SHARES DEPOSITED Conversion ACME CORP (ACME) (Cash)' },
        ],
      },
    ]);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('leaves out rows already recorded, and any row on request', async () => {
    const recorded: Transaction = {
      id: 9, kind: 'BUY', date: '2025-08-15', symbol: 'ACME', quantity: 25, price: 95.2, currency: 'USD', fees: 0, eurRate: 1.16,
      source: 'ESPP', note: null, eurValue: 2051.72, ecbRate: null, ecbRateDate: null, enteredIn: 'CGT' as const, name: null,
    };
    server({ existing: [recorded] });
    renderApp('/cgt/import');
    await screen.findByRole('heading', { level: 1, name: 'Import a statement' });
    await waitFor(() => undefined);
    choose(FIDELITY);
    await screen.findByText('2 to import', { exact: false });
    fireEvent.click(screen.getByLabelText('Show the rows left out'));
    expect(screen.getByText('Already recorded')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Import line 7 as'), { target: { value: 'SKIP' } });
    expect(importButton().textContent).toBe('Import 1 transaction');
    expect(importButton().hasAttribute('disabled')).toBe(false);
  });

  it("shows the server's objections on their lines of the file, and takes a rate the ECB doesn't have", async () => {
    const { sent } = server({
      importAnswers: [
        {
          status: 422,
          body: {
            message: '2 rows can\'t be recorded.',
            errors: {
              'transactions[0].eurRate': ["Row 1: The ECB has no USD rate for that day, or couldn't be reached: enter the rate (USD per euro)."],
              'transactions[1].eurRate': ["Row 2: The ECB has no USD rate for that day, or couldn't be reached: enter the rate (USD per euro)."],
            },
          },
        },
      ],
    });
    renderApp('/cgt/import');
    await screen.findByRole('heading', { level: 1, name: 'Import a statement' });
    choose(FIDELITY);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Import line 7 as'), { target: { value: 'SKIP' } });
    // the ESPP purchase's market value that day
    fireEvent.change(screen.getByLabelText('Price a share on line 6 (USD)'), { target: { value: '112' } });
    expect(importButton().hasAttribute('disabled')).toBe(false);
    fireEvent.click(importButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was imported. Fix the rows marked below');
    // the rows sent were lines 4 and 6 of the file
    const lineOf = (n: string) => within(screen.getByRole('table')).getByRole('rowheader', { name: n }).closest('tr') as HTMLElement;
    expect(lineOf('4').textContent).toContain('The ECB has no USD rate for that day');
    expect(lineOf('4').textContent).not.toContain('Row 1');
    fireEvent.change(within(lineOf('4')).getByLabelText('USD per euro on 17 Sept 2025'), { target: { value: '1,1712' } });
    // the other line keeps its field while the first is typed
    fireEvent.change(within(lineOf('6')).getByLabelText('USD per euro on 15 Aug 2025'), { target: { value: '1.1702' } });
    fireEvent.click(importButton());
    await screen.findByText(/2 transactions imported/);
    expect(sent[1].transactions.map((t) => t.eurRate)).toEqual([1.1712, 1.1702]);
  });

  it('asks for the columns of a layout it does not know', async () => {
    server();
    renderApp('/cgt/import');
    await screen.findByRole('heading', { level: 1, name: 'Import a statement' });
    choose('When,Company,How many,Cost each,Fee\n2025-01-02,ACME,5,10,1\n2025-03-04,ACME,-5,12,1', 'other.csv');
    await screen.findByText('Pick the columns', { exact: false });
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/^Ticker/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Shares'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Price a share'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Fees (if any)'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('All in'), { target: { value: 'eur' } });
    const preview = within(await screen.findByRole('table'));
    expect((preview.getByLabelText('Import line 2 as') as HTMLSelectElement).value).toBe('BUY');
    expect((preview.getByLabelText('Import line 3 as') as HTMLSelectElement).value).toBe('SELL');
    expect(importButton().textContent).toBe('Import 2 transactions');
  });

  it('says when nothing in the file is new', async () => {
    const base = { currency: 'USD', fees: 0, eurRate: 1.16, ecbRate: null, ecbRateDate: null, note: null, eurValue: 0, enteredIn: 'CGT' as const, name: null } as const;
    server({
      existing: [
        { ...base, id: 1, kind: 'SELL', date: '2025-09-17', symbol: 'ACME', quantity: 10, price: 117.12, source: null },
        { ...base, id: 2, kind: 'BUY', date: '2025-08-15', symbol: 'ACME', quantity: 25, price: 95.2, source: 'ESPP' },
        { ...base, id: 3, kind: 'BUY', date: '2025-06-02', symbol: 'ACME', quantity: 40, price: 101.5, source: 'RSU' },
      ],
    });
    renderApp('/cgt/import');
    await screen.findByRole('heading', { level: 1, name: 'Import a statement' });
    await waitFor(() => undefined);
    choose(FIDELITY);
    await screen.findByText('Nothing new to import', { exact: false });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull();
  });

  it("reads Fidelity's stock plan history: asks each company's ticker once, and remembers it", async () => {
    const plan = `Transaction date,Transaction type,Investment name,Shares,Amount
Sep-17-2025,JOURNALED RSU IRL,-,-,-$500.00
Sep-16-2025,YOU SOLD EXEC ON MULT EXCHG DETAILS ON REQUEST AVERAGE PRICE TRADE,ACME INC CL A,-12.00,$510.30
Sep-15-2025,YOU BOUGHT RSU####,ACME INC CL A,25.00,$0.00
Sep-30-2025,REINVESTMENT REINVEST @ $1.000,FID TREASURY ONLY MMKT FUND CL OUS,0.08,-$0.08

Stock plan account history as of OCT/21/2026
`;
    const { sent } = server();
    const { unmount } = renderApp('/cgt/import');
    await screen.findByRole('heading', { level: 1, name: 'Import a statement' });
    choose(plan, 'Transaction_history.csv');
    await screen.findByText("Read as Fidelity's stock plan account history", { exact: false });
    expect(screen.getByText('Give the ticker above')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Ticker for ACME INC CL A'), { target: { value: 'acme' } });
    // the vest's price is its market value that day: asked for; the sale's comes from the amount
    expect(await screen.findByText("Enter the vest day's market value (on your payslip, or the release details)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Price a share on line 4 (USD)'), { target: { value: '41' } });
    fireEvent.click(importButton());
    await screen.findByText(/2 transactions imported/);
    expect(sent[0].transactions).toEqual([
      { kind: 'SELL', date: '2025-09-16', symbol: 'ACME', quantity: 12, price: 42.525, currency: 'USD', fees: null, eurRate: null, source: null, note: 'Imported: YOU SOLD EXEC ON MULT EXCHG DETAILS ON REQUEST AVERAGE PRICE TRADE' },
      { kind: 'BUY', date: '2025-09-15', symbol: 'ACME', quantity: 25, price: 41, currency: 'USD', fees: null, eurRate: null, source: 'RSU', note: 'Imported: YOU BOUGHT RSU####' },
    ]);

    unmount();
    renderApp('/cgt/import');
    await screen.findByRole('heading', { level: 1, name: 'Import a statement' });
    choose(plan, 'Transaction_history.csv');
    expect(((await screen.findByLabelText('Ticker for ACME INC CL A')) as HTMLInputElement).value).toBe('ACME');
  });

  it("explains Fidelity's award history, and points to the stock plan history", async () => {
    server();
    renderApp('/cgt/import');
    await screen.findByRole('heading', { level: 1, name: 'Import a statement' });
    choose('Transaction Date,Transaction Type,Award ID,Plan Name,Grant Date,Quantity,Net Proceeds\n2025-09-15,Award paid out,RSU0001,Restricted Stock Units,2025-01-10,25.000 units,13.000 shares');
    const alert = (await screen.findByRole('alert')).textContent;
    expect(alert).toContain("That's Fidelity's award history");
    expect(alert).toContain('stock plan account history');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says when a file has no rows', async () => {
    server();
    renderApp('/cgt/import');
    await screen.findByRole('heading', { level: 1, name: 'Import a statement' });
    choose('just a title line');
    expect((await screen.findByRole('alert')).textContent).toContain('No rows found');
  });
});
