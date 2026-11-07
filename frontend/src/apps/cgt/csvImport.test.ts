import { describe, expect, it } from 'vitest';
import type { Transaction } from './cgt';
import { classify, fields, guessMapping, marketKey, parseDate, parseNumber, problem, readCsv, toRequest, toRows, withMarketValue } from './csvImport';

/** A Fidelity account history export (Accounts_History.csv): account lines above, disclaimers below. */
const FIDELITY = `
Brokerage

Run Date,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
09/17/2025,YOU SOLD ACME CORP COM (ACME) (Cash),ACME,ACME CORP COM,Cash,-10,117.12,,0.05,,1171.15,09/19/2025
09/15/2025,DIVIDEND RECEIVED ACME CORP COM (ACME) (Cash),ACME,ACME CORP COM,Cash,0,,,,,12.50,
08/15/2025,YOU BOUGHT ESPP### AS OF 08-15-25 ACME CORP COM (ACME) (Cash),ACME,ACME CORP,Cash,25,95.20,,,,0.00,
06/02/2025,SHARES DEPOSITED Conversion ACME CORP (ACME) (Cash),ACME,ACME CORP,Cash,40,,,,,0.00,
05/01/2025,REINVESTMENT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash),SPAXX**,FIDELITY GOVERNMENT MONEY MARKET,Cash,1.23,1,,,,-1.23,
04/01/2025,YOU BOUGHT COFFEE HOLDING CO (JVA) (Cash),JVA,"COFFEE HOLDING CO, INC",Cash,200,"1,050.10",4.95,,,-210024.95,04/03/2025


"The data and information in this spreadsheet is provided to you solely for your use and is not for distribution."
"Date downloaded 10/21/2025 3:14 pm"
`;

/** A Fidelity stock plan account history: companies by name, amounts instead of prices, cash journals and a money fund. */
const STOCK_PLAN = `Transaction date,Transaction type,Investment name,Shares,Amount
Dec-31-2025,REINVESTMENT REINVEST @ $1.000,FID TREASURY ONLY MMKT FUND CL OUS,0.23,-$0.23
Dec-31-2025,DIVIDEND RECEIVED,FID TREASURY ONLY MMKT FUND CL OUS,-,$0.23
Sep-17-2025,JOURNALED RSU IRL,-,-,-$500.00
Sep-16-2025,YOU SOLD EXEC ON MULT EXCHG DETAILS ON REQUEST AVERAGE PRICE TRADE,ACME INC CL A,-12.00,$510.30
Sep-15-2025,YOU BOUGHT RSU####,ACME INC CL A,25.00,$0.00
Aug-14-2025,JOURNALED CASH WITHDRAWAL,-,-,-$900.00
Aug-13-2025,YOU SOLD,ACME INC CL A,-20.00,$900.00
Feb-05-2025,EXCHANGED TO FYIXX,FID TREASURY ONLY MMKT FUND CL OUS,-,$0.00

"Unless noted otherwise, all values displayed in the amount column are USD"

Stock plan account history as of OCT/21/2026
`;

/** Fidelity's award history: awards granted and paid out, without prices or sales. */
const AWARDS = `Transaction Date,Transaction Type,Award ID,Plan Name,Grant Date,Quantity,Net Proceeds
2025-09-15,Award paid out,RSU0001,Restricted Stock Units,2025-01-10,25.000 units,13.000 shares
2025-01-22,Award granted,RSU0001,Restricted Stock Units,2025-01-10,"400.000 units","400.000 units"
`;

const RECORDED: Transaction = {
  id: 9, kind: 'BUY', date: '2025-08-15', symbol: 'ACME', quantity: 25, price: 95.2, currency: 'USD', fees: 0, eurRate: 1.16,
  source: 'ESPP', note: null, eurValue: 2051.72, ecbRate: null, ecbRateDate: null, enteredIn: 'CGT' as const, name: null,
};

describe('reading a broker statement', () => {
  it("finds Fidelity's table below the account lines and leaves out the notes after it", () => {
    const table = readCsv(FIDELITY);
    expect(table.header[0]).toBe('Run Date');
    expect(table.rows.map((r) => r.line)).toEqual([5, 6, 7, 8, 9, 10]);
    const { mapping, layout, complete } = guessMapping(table);
    expect(layout).toBe('fidelity-history');
    expect(complete).toBe(true);
    expect(mapping).toMatchObject({ date: 0, action: 1, symbol: 2, quantity: 5, price: 6, fees: [7, 8], currency: -1, dateOrder: 'MDY', defaultCurrency: 'USD' });
  });

  it('turns its rows into purchases and sales, and says why others are left out', () => {
    const table = readCsv(FIDELITY);
    const rows = toRows(table, guessMapping(table).mapping, []);
    expect(rows.map((r) => [r.kind, r.symbol, r.date, r.quantity, r.price, r.fees])).toEqual([
      ['SELL', 'ACME', '2025-09-17', 10, 117.12, 0.05],
      ['SKIP', 'ACME', '2025-09-15', 0, null, 0],
      ['ESPP', 'ACME', '2025-08-15', 25, 95.2, 0],
      ['RSU', 'ACME', '2025-06-02', 40, null, 0],
      ['SKIP', 'SPAXX', '2025-05-01', 1.23, 1, 0],
      ['BUY', 'JVA', '2025-04-01', 200, 1050.1, 4.95],
    ]);
    expect(rows[1].note).toBe('Not a purchase or sale');
    expect(rows[4].note).toBe('Cash (money market), not shares');
    // shares deposited without a price: an RSU vest to check, whose price is needed
    expect(rows[3].note).toContain('usually an RSU vest');
    expect(problem(rows[3])).toBe('Enter the market value');
    expect(problem(rows[0])).toBeNull();
  });

  it('marks rows already recorded', () => {
    const table = readCsv(FIDELITY);
    const rows = toRows(table, guessMapping(table).mapping, [RECORDED]);
    expect(rows[2]).toMatchObject({ kind: 'SKIP', duplicate: true, note: 'Already recorded' });
    expect(rows[0].duplicate).toBe(false);
    // an ESPP purchase recorded at its market value instead of the price paid is still the same purchase
    const atMarketValue = toRows(table, guessMapping(table).mapping, [{ ...RECORDED, price: 112 }]);
    expect(atMarketValue[2]).toMatchObject({ kind: 'SKIP', duplicate: true });
    // its ticker written with the exchange: the same trade
    const withExchange = toRows(table, guessMapping(table).mapping, [{ ...RECORDED, symbol: `NASDAQ:${RECORDED.symbol}` }]);
    expect(withExchange[2]).toMatchObject({ kind: 'SKIP', duplicate: true });
  });

  it('makes the requests the API takes, the rate left to the ECB', () => {
    const table = readCsv(FIDELITY);
    const rows = toRows(table, guessMapping(table).mapping, []);
    expect(toRequest(rows[0])).toEqual({
      kind: 'SELL', date: '2025-09-17', symbol: 'ACME', quantity: 10, price: 117.12, currency: 'USD', fees: 0.05, eurRate: null,
      source: null, note: 'Imported: YOU SOLD ACME CORP COM (ACME) (Cash)',
    });
    expect(toRequest(rows[2])).toMatchObject({ kind: 'BUY', source: 'ESPP', fees: null });
    expect(toRequest({ ...rows[3], price: 101.5 })).toMatchObject({ kind: 'BUY', source: 'RSU', price: 101.5 });
  });

  it('reads other layouts by their column names, day first when the dates say so', () => {
    const table = readCsv(['Date,Product,Ticker,Quantity,Price,Currency,Transaction costs', '25-03-2025,Acme,ACME,5,"1.234,50",EUR,"-2,00"', '02-04-2025,Acme,ACME,-5,"1.300,00",EUR,'].join('\n'));
    const { mapping, layout, complete } = guessMapping(table);
    expect(layout).toBe('other');
    expect(complete).toBe(true);
    expect(mapping.dateOrder).toBe('DMY');
    expect(mapping.currency).toBe(5);
    expect(mapping.fees).toEqual([6]);
    // no action column: the quantity's sign tells purchases from sales
    expect(toRows(table, mapping, []).map((r) => [r.kind, r.date, r.price, r.currency, r.fees])).toEqual([
      ['BUY', '2025-03-25', 1234.5, 'EUR', 2],
      ['SELL', '2025-04-02', 1300, 'EUR', 0],
    ]);
  });

  it('reads a file saved by Excel (it starts with a byte order mark)', () => {
    expect(readCsv('\uFEFFDate,Ticker,Quantity,Price\n2025-01-02,ACME,1,10').header[0]).toBe('Date');
  });

  it("reads Fidelity's stock plan history: tickers given by company, prices from the amounts", () => {
    const table = readCsv(STOCK_PLAN);
    expect(table.rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    const { mapping, layout, complete } = guessMapping(table);
    expect(layout).toBe('fidelity-stock-plan');
    expect(complete).toBe(true);
    expect(mapping).toMatchObject({ date: 0, action: 1, symbol: -1, company: 2, quantity: 3, price: -1, amount: 4 });

    // before the ticker is given, the company's rows need it
    const untold = toRows(table, mapping, []);
    expect(untold[3]).toMatchObject({ kind: 'SELL', symbol: '', company: 'ACME INC CL A' });
    expect(problem(untold[3])).toBe('Give the ticker');

    const rows = toRows(table, mapping, [], { 'ACME INC CL A': 'acme' });
    expect(rows.map((r) => [r.kind, r.symbol, r.date, r.quantity, r.price])).toEqual([
      ['SKIP', '', '2025-12-31', 0.23, 1],
      ['SKIP', '', '2025-12-31', null, null],
      ['SKIP', '', '2025-09-17', null, null],
      ['SELL', 'ACME', '2025-09-16', 12, 42.525],
      ['RSU', 'ACME', '2025-09-15', 25, null],
      ['SKIP', '', '2025-08-14', null, null],
      ['SELL', 'ACME', '2025-08-13', 20, 45],
      ['SKIP', '', '2025-02-05', null, null],
    ]);
    expect(rows[0].note).toBe('Cash (money market), not shares');
    // the vest's tax journal names no company: not a sale
    expect(rows[2].note).toBe('No company');
    expect(rows[3].note).toBe('Price from the amount received, after fees');
    // the vest's $0.00 isn't a price: its market value that day is needed
    expect(rows[4].note).toContain('RSU vest');
    expect(problem(rows[4])).toBe('Enter the market value');
    expect(problem(rows[3])).toBeNull();
    expect(toRequest(rows[3])).toMatchObject({ kind: 'SELL', symbol: 'ACME', quantity: 12, price: 42.525, currency: 'USD', fees: null });
  });

  it("asks for a vest's market value that day, its price left to enter", () => {
    const table = readCsv(STOCK_PLAN);
    const vest = toRows(table, guessMapping(table).mapping, [], { 'ACME INC CL A': 'ACME' })[4];
    expect(marketKey(vest)).toBe('ACME|2025-09-15');
    expect(withMarketValue(vest)).toMatchObject({ price: null, note: "Enter the vest day's market value (on your payslip, or the release details)" });
    expect(problem(withMarketValue(vest))).toBe('Enter the market value');
    // sales, and vests with a price, are left as they are
    const sale = toRows(table, guessMapping(table).mapping, [], { 'ACME INC CL A': 'ACME' })[3];
    expect(marketKey(sale)).toBeNull();
    expect(withMarketValue(sale)).toBe(sale);
    expect(marketKey({ ...vest, price: 40 })).toBeNull();
  });

  it("asks for an ESPP purchase's market value that day, the price paid kept apart: none imported without it", () => {
    const table = readCsv(FIDELITY);
    const espp = toRows(table, guessMapping(table).mapping, [])[2];
    expect(espp).toMatchObject({ kind: 'ESPP', price: 95.2 });
    expect(marketKey(espp)).toBe('ACME|2025-08-15');
    const asked = withMarketValue(espp);
    expect(asked).toMatchObject({ price: null, paid: 95.2, note: expect.stringContaining('You paid 95.2 USD a share') });
    expect(asked.note).toContain('The cost is the market value that day');
    expect(problem(asked)).toBe('Enter the market value');
    // the market value entered: the cost, the price paid in the note
    const valued = { ...asked, price: 112 };
    expect(problem(valued)).toBeNull();
    expect(toRequest(valued)).toMatchObject({ price: 112, source: 'ESPP', note: expect.stringContaining('paid 95.2 USD a share') });
  });

  it("knows Fidelity's award history, which has no prices or sales", () => {
    const { layout, complete } = guessMapping(readCsv(AWARDS));
    expect(layout).toBe('fidelity-awards');
    expect(complete).toBe(false);
  });

  it('says when the columns must be picked', () => {
    const { complete } = guessMapping(readCsv('When,What,How many\n2025-01-01,X,1'));
    expect(complete).toBe(false);
  });
});

describe('statement values', () => {
  it('reads quoted fields with commas and quotes', () => {
    expect(fields('a,"b, c","say ""hi""", d ')).toEqual(['a', 'b, c', 'say "hi"', 'd']);
  });

  it('reads dates in the usual ways', () => {
    expect(parseDate('09/17/2025', 'MDY')).toBe('2025-09-17');
    expect(parseDate('10/03/2025', 'DMY')).toBe('2025-03-10');
    expect(parseDate('2025-09-17T14:00:00', 'MDY')).toBe('2025-09-17');
    expect(parseDate('Sep-17-2025', 'MDY')).toBe('2025-09-17');
    expect(parseDate('Sep 17, 2025', 'MDY')).toBe('2025-09-17');
    expect(parseDate('17 Sep 2025', 'MDY')).toBe('2025-09-17');
    expect(parseDate('09/17/25 3:14 pm', 'MDY')).toBe('2025-09-17');
    expect(parseDate('02/30/2025', 'MDY')).toBeNull();
    expect(parseDate('Pending', 'MDY')).toBeNull();
  });

  it('reads numbers with currency signs, thousands and brackets', () => {
    expect(parseNumber('$1,050.10')).toBe(1050.1);
    expect(parseNumber('(12.34)')).toBe(-12.34);
    expect(parseNumber('-10')).toBe(-10);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('--')).toBeNull();
    expect(parseNumber('n/a')).toBeNull();
  });

  it('tells purchases, sales, vests and ESPP from the action', () => {
    expect(classify('YOU SOLD ACME', -1, 'ACME').kind).toBe('SELL');
    expect(classify('YOU BOUGHT ESPP### ACME', 1, 'ACME').kind).toBe('ESPP');
    expect(classify('RSU RELEASE', 1, 'ACME').kind).toBe('RSU');
    expect(classify('YOU BOUGHT FEE-FREE FUND', 1, 'FFF').kind).toBe('BUY');
    expect(classify('REINVESTMENT ACME', 1, 'ACME')).toEqual({ kind: 'BUY', note: 'Dividend reinvested: a purchase' });
    expect(classify('FOREIGN TAX PAID', 0, 'ACME').kind).toBe('SKIP');
    expect(classify('TRANSFERRED FROM TO BROKERAGE', 10, 'ACME').kind).toBe('SKIP');
    expect(classify('YOU SOLD', -1, '').kind).toBe('SKIP');
    // by company name, when there are no tickers
    expect(classify('YOU SOLD', -1, '', 'ACME INC CL A').kind).toBe('SELL');
    expect(classify('YOU BOUGHT RSU####', 25, '', 'ACME INC CL A').kind).toBe('RSU');
    expect(classify('JOURNALED RSU IRL', null, '', 'ACME INC CL A').kind).toBe('SKIP');
    expect(classify('REINVESTMENT', 1, '', 'FID TREASURY ONLY MMKT FUND').kind).toBe('SKIP');
  });
});
