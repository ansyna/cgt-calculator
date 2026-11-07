/**
 * A broker's statement read for the CGT calculator: purchases and sales, with those already recorded marked, and the
 * RSU vests and ESPP purchases whose market value that day (their cost for CGT) is to be entered.
 */
import {
  classify,
  fields,
  guessDateOrder,
  guessMapping,
  isComplete,
  parseDate,
  parseNumber,
  readCsv,
  statementRows,
  tickerKey,
  type DateOrder,
  type Layout,
  type Mapping,
  type RowKind,
  type StatementRow,
  type Table,
} from '../../platform/statement';
import type { Transaction, TransactionRequest } from './cgt';

export { classify, fields, guessDateOrder, guessMapping, isComplete, parseDate, parseNumber, readCsv };
export type { DateOrder, Layout, Mapping, RowKind, Table };

export interface ImportRow extends Omit<StatementRow, 'priceFromAmount'> {
  /** Units of the currency per euro, when typed for the row; otherwise the ECB's rate of the day. */
  eurRate: number | null;
  /** Already recorded: same day, type, company, shares and price. */
  duplicate: boolean;
  /** An ESPP purchase's price paid, when its price is the market value instead. */
  paid?: number;
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** The statement's rows as purchases and sales, with rows already recorded marked. */
export function toRows(table: Table, mapping: Mapping, existing: Transaction[], tickers: Record<string, string> = {}): ImportRow[] {
  return statementRows(table, mapping, tickers).map(({ priceFromAmount, ...read }) => {
    let { kind, note } = read;
    const { date, symbol, quantity, price } = read;
    if (kind === 'RSU' && price === null && !note) {
      note = 'RSU vest: the price is the market value a share on the vest day (on your payslip, or the release details)';
    } else if (kind === 'SELL' && priceFromAmount && !note) note = 'Price from the amount received, after fees';
    const duplicate =
      kind !== 'SKIP' &&
      symbol !== '' &&
      existing.some(
        (t) =>
          t.date === date &&
          tickerKey(t.symbol) === tickerKey(symbol) &&
          (t.kind === 'SELL') === (kind === 'SELL') &&
          same(t.quantity, quantity ?? -1) &&
          // a vest's or ESPP purchase's price may have become its market value: not compared
          (price === null || kind === 'RSU' || kind === 'ESPP' || same(t.price, price)),
      );
    if (duplicate) ({ kind, note } = { kind: 'SKIP', note: 'Already recorded' });
    return { ...read, kind, note, eurRate: null, duplicate };
  });
}

/**
 * The key of a row whose market value that day is wanted (the ticker and the day): an RSU vest without a price, and an
 * ESPP purchase, whose statement price is the discounted one paid.
 */
export function marketKey(row: ImportRow): string | null {
  const wanted = (row.kind === 'RSU' && row.price === null) || (row.kind === 'ESPP' && row.paid === undefined);
  return wanted && row.symbol && row.date ? `${row.symbol}|${row.date}` : null;
}

/**
 * The shares' cost for CGT: their market value on the day, which was taxed as income through payroll (an RSU vest's
 * whole value, an ESPP purchase's discount). A vest without a price, and an ESPP purchase (its statement price the
 * discounted one paid, kept as such), ask for it: neither is imported until the day's market value is entered.
 */
export function withMarketValue(row: ImportRow): ImportRow {
  if (marketKey(row) === null) return row;
  return row.kind === 'ESPP'
    ? {
        ...row,
        price: null,
        paid: row.price ?? undefined,
        note: `You paid ${row.price} ${row.currency} a share, after the discount. The cost is the market value that day (the discount was taxed through payroll): enter it, from the purchase confirmation`,
      }
    : { ...row, note: "Enter the vest day's market value (on your payslip, or the release details)" };
}

/** What's missing before a row can be imported: a ticker, or a price (usually a vest's). */
export function problem(row: ImportRow): string | null {
  if (row.kind === 'SKIP') return null;
  if (!row.symbol) return 'Give the ticker';
  if (row.price === null || row.price <= 0) return row.kind === 'RSU' || row.kind === 'ESPP' ? 'Enter the market value' : 'Enter the price';
  if (!/^[A-Z]{3}$/.test(row.currency)) return 'Unknown currency';
  return null;
}

export function toRequest(row: ImportRow): TransactionRequest {
  const buy = row.kind !== 'SELL';
  return {
    kind: buy ? 'BUY' : 'SELL',
    date: row.date ?? '',
    symbol: row.symbol,
    quantity: row.quantity ?? 0,
    price: row.price ?? 0,
    currency: row.currency,
    fees: row.fees || null,
    eurRate: row.currency === 'EUR' ? null : row.eurRate,
    source: row.kind === 'RSU' || row.kind === 'ESPP' ? row.kind : buy ? 'BUY' : null,
    note: `${row.action ? `Imported: ${row.action}` : 'Imported'}${row.paid !== undefined ? `; paid ${row.paid} ${row.currency} a share` : ''}`.slice(0, 200),
  };
}
