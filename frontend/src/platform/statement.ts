/**
 * Reading a broker's CSV statement into purchases and sales, in the browser (nothing is sent until the user
 * imports). Fidelity's exports are recognised by their column names (the account history, and the stock plan
 * account history, which names companies instead of tickers and gives amounts instead of prices); for any other
 * layout the user picks the columns. Used by the apps that import statements.
 */
import { saveSetting, setting } from './settings';

export interface Table {
  header: string[];
  /** Data rows, with their line number in the file (from 1). */
  rows: { line: number; cells: string[] }[];
}

export type DateOrder = 'MDY' | 'DMY' | 'YMD';

/** Which column holds what (an index into the header, -1 for none). */
export interface Mapping {
  date: number;
  action: number;
  symbol: number;
  /** The company's name, when there's no ticker column (the user gives each company's ticker). */
  company: number;
  quantity: number;
  price: number;
  /** The trade's amount, when there's no price column: the price is the amount a share. */
  amount: number;
  /** Fee and commission columns, added up. */
  fees: number[];
  currency: number;
  dateOrder: DateOrder;
  /** When there's no currency column. */
  defaultCurrency: string;
}

export type RowKind = 'BUY' | 'RSU' | 'ESPP' | 'SELL' | 'SKIP';

/** The exports recognised by their columns. */
export type Layout = 'fidelity-history' | 'fidelity-stock-plan' | 'fidelity-awards' | 'other';

/** A row of the statement, read. */
export interface StatementRow {
  line: number;
  kind: RowKind;
  /** Why a row is skipped, or what to check. */
  note: string | null;
  action: string;
  date: string | null;
  /** The ticker; empty until given when the statement names companies instead. */
  symbol: string;
  /** The company's name in the statement, when it has no ticker column. */
  company: string;
  quantity: number | null;
  /** Per share: the price column's, or the amount a share. */
  price: number | null;
  /** Whether the price came from the amount (for a sale, what was received after fees). */
  priceFromAmount: boolean;
  fees: number;
  currency: string;
}

/** A CSV line's fields; quoted fields may hold commas and doubled quotes. */
export function fields(line: string, separator = ','): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === separator) {
      out.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** A column name without case, currency marks and punctuation: "Price ($)" → "price". */
function normal(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAMES = {
  date: ['run date', 'trade date', 'transaction date', 'activity date', 'date'],
  action: ['action', 'transaction type', 'activity', 'transaction', 'type'],
  symbol: ['symbol', 'ticker'],
  company: ['investment name', 'security name', 'security', 'investment', 'stock name', 'company'],
  quantity: ['quantity', 'shares', 'qty', 'number of shares'],
  price: ['price', 'share price', 'price per share', 'execution price'],
  amount: ['amount', 'net amount', 'proceeds'],
  fees: ['commission', 'commissions', 'fees', 'fee', 'fees and commissions', 'transaction costs', 'costs'],
  currency: ['currency'],
};
const ALL_NAMES = new Set(Object.values(NAMES).flat());

/**
 * The statement's table: the header is the first line naming at least three known columns (brokers put account
 * details above it), else the first line; lines after it without three values (notes, disclaimers) are left out.
 */
export function readCsv(text: string): Table {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let headerAt = lines.findIndex((line, i) => i < 40 && fields(line).filter((f) => ALL_NAMES.has(normal(f))).length >= 3);
  if (headerAt < 0) headerAt = lines.findIndex((line) => line.trim() !== '');
  if (headerAt < 0) return { header: [], rows: [] };
  const header = fields(lines[headerAt]);
  const rows: Table['rows'] = [];
  for (let i = headerAt + 1; i < lines.length; i++) {
    const cells = fields(lines[i]);
    if (cells.filter((c) => c !== '').length >= 3) rows.push({ line: i + 1, cells });
  }
  return { header, rows };
}

function column(header: string[], names: string[]): number {
  const normals = header.map(normal);
  for (const name of names) {
    const at = normals.indexOf(name);
    if (at >= 0) return at;
  }
  return -1;
}

/** Day first or month first, from the dates themselves (a part over 12 settles it); month first when unsure. */
export function guessDateOrder(values: string[]): DateOrder {
  for (const value of values) {
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(value.trim())) return 'YMD';
    const parts = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(value.trim());
    if (parts && Number(parts[1]) > 12) return 'DMY';
    if (parts && Number(parts[2]) > 12) return 'MDY';
  }
  return 'MDY';
}

/** Which export it is, by its columns. */
function layoutOf(header: string[]): Layout {
  const names = header.map(normal);
  const has = (...wanted: string[]) => wanted.every((name) => names.includes(name));
  if (has('award id') || has('plan name', 'grant date')) return 'fidelity-awards';
  if (has('run date', 'action', 'symbol')) return 'fidelity-history';
  if (has('transaction date', 'transaction type', 'investment name', 'shares', 'amount')) return 'fidelity-stock-plan';
  return 'other';
}

/** Whether the columns needed are there: a date, shares, a ticker or a company, a price or an amount. */
export function isComplete(mapping: Mapping): boolean {
  return mapping.date >= 0 && mapping.quantity >= 0 && (mapping.symbol >= 0 || mapping.company >= 0) && (mapping.price >= 0 || mapping.amount >= 0);
}

/** The columns found by name, and which export this is. */
export function guessMapping(table: Table): { mapping: Mapping; layout: Layout; complete: boolean } {
  const { header } = table;
  const fees = NAMES.fees.map((name) => column(header, [name])).filter((at, i, all) => at >= 0 && all.indexOf(at) === i);
  const symbol = column(header, NAMES.symbol);
  const price = column(header, NAMES.price);
  const mapping: Mapping = {
    date: column(header, NAMES.date),
    action: column(header, NAMES.action),
    symbol,
    company: symbol >= 0 ? -1 : column(header, NAMES.company),
    quantity: column(header, NAMES.quantity),
    price,
    amount: price >= 0 ? -1 : column(header, NAMES.amount),
    fees,
    currency: column(header, NAMES.currency),
    dateOrder: 'MDY',
    defaultCurrency: 'USD',
  };
  const layout = layoutOf(header);
  if (layout === 'other' && mapping.date >= 0) mapping.dateOrder = guessDateOrder(table.rows.map((r) => r.cells[mapping.date] ?? ''));
  return { mapping, layout, complete: isComplete(mapping) };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(year: number, month: number, day: number): string | null {
  const full = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(full, month - 1, day));
  if (date.getUTCFullYear() !== full || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** "10/03/2025", "2025-10-03", "Oct-03-2025", "3 Oct 2025", "Oct 3, 2025" → "2025-10-03"; null when not a date. */
export function parseDate(text: string, order: DateOrder): string | null {
  const value = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(value.split(/\s+/)[0]);
  if (m) return order === 'DMY' ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  m = /^([a-z]{3})[a-z]*[\s.-]+(\d{1,2}),?[\s-]+(\d{4})$/i.exec(value);
  if (m && MONTHS.includes(m[1].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  m = /^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s-]+(\d{4})$/i.exec(value);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return null;
}

/** A ticker as trades are compared, wherever they were entered: upper case, no exchange prefix ("NASDAQ:"), "BRK.B" as "BRK-B". */
export function tickerKey(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return s.slice(s.indexOf(':') + 1).replace(/\./g, '-');
}

/** "$1,050.10", "(12.34)", "-10", "1.234,56" → numbers; null when empty or not a number. */
export function parseNumber(text: string): number | null {
  let value = text.trim().replace(/[$€£\s]|USD|EUR|GBP/g, '');
  if (value === '' || value === '--' || value === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  // "1.234,56", "2,5432": a comma after the last point is the decimal one, unless it's one comma before three digits
  // ("1,234", a thousand)
  const commas = value.split(',').length - 1;
  if (value.includes(',') && value.lastIndexOf(',') > value.lastIndexOf('.') && (value.includes('.') || (commas === 1 && !/,\d{3}$/.test(value)))) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else {
    value = value.replace(/,/g, '');
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return negative ? -number : number;
}

/** Money market funds and cash that brokers list as positions: not shares. */
const CASH = /^(SPAXX|FDRXX|FZFXX|FYIXX|FCASH|SPRXX|CORE|CASH)$/;
const CASH_NAMES = /MONEY MARKET|\bMMKT\b|CASH RESERVES|TREASURY ONLY|GOVERNMENT CASH/;

/**
 * What a row is, from its action text (or, without one, the sign of its quantity).
 *
 * @param company the company's name, when the statement has no tickers
 */
export function classify(action: string, quantity: number | null, symbol: string, company = ''): { kind: RowKind; note: string | null } {
  const a = action.toUpperCase();
  if (!symbol && !company) return { kind: 'SKIP', note: 'No company' };
  if (CASH.test(symbol) || CASH_NAMES.test(company.toUpperCase())) return { kind: 'SKIP', note: 'Cash (money market), not shares' };
  if (!action) {
    if (quantity === null || quantity === 0) return { kind: 'SKIP', note: 'No shares' };
    return quantity < 0 ? { kind: 'SELL', note: null } : { kind: 'BUY', note: null };
  }
  if (/SOLD|\bSELL\b|\bSALE\b/.test(a)) return { kind: 'SELL', note: null };
  // cash moved between accounts, e.g. "JOURNALED RSU IRL" (the tax of a vest): not shares
  if (/\b(JOURNALED|JOURNAL|TRANSFER|TRANSFERRED|WIRE|EXCHANGED)\b/.test(a)) return { kind: 'SKIP', note: 'Not a purchase or sale' };
  if (/ESPP|STOCK PURCHASE PLAN|EMPLOYEE STOCK PURCHASE/.test(a)) return { kind: 'ESPP', note: null };
  if (/\bRSU\b|RESTRICTED STOCK|\bRELEASE|\bVEST/.test(a)) return { kind: 'RSU', note: null };
  if (/BOUGHT|\bBUY\b|\bPURCHASE/.test(a)) return { kind: 'BUY', note: null };
  if (/REINVEST/.test(a)) return { kind: 'BUY', note: 'Dividend reinvested: a purchase' };
  if (/\b(DIVIDENDS?|INTEREST|TAX|WITHHOLDING|FEES?|JOURNALED|JOURNAL|TRANSFER|TRANSFERRED|CONTRIBUTION|DISTRIBUTION|REDEMPTION|WIRE|ADJUSTMENT)\b/.test(a)) {
    return { kind: 'SKIP', note: 'Not a purchase or sale' };
  }
  if (/DEPOSIT|CONVERSION/.test(a) && (quantity ?? 0) > 0) {
    return { kind: 'RSU', note: 'Shares deposited: usually an RSU vest. Check the type; the price is the market value that day' };
  }
  return { kind: 'SKIP', note: 'Not a purchase or sale' };
}

/** The statement's rows as purchases and sales (or rows to leave out, with why). */
export function statementRows(table: Table, mapping: Mapping, tickers: Record<string, string> = {}): StatementRow[] {
  const cell = (cells: string[], at: number) => (at >= 0 ? (cells[at] ?? '') : '');
  return table.rows.map(({ line, cells }) => {
    const action = cell(cells, mapping.action);
    const companyCell = cell(cells, mapping.company);
    const company = companyCell === '-' ? '' : companyCell;
    const symbol = (mapping.symbol >= 0 ? cell(cells, mapping.symbol) : (tickers[company] ?? '')).replace(/\*+$/, '').trim().toUpperCase();
    const signed = parseNumber(cell(cells, mapping.quantity));
    const quantity = signed === null ? null : Math.abs(signed);
    // without a price column, the amount a share (for a sale, what was received after fees)
    const amount = parseNumber(cell(cells, mapping.amount));
    const fromAmount = mapping.price < 0 && amount !== null && amount !== 0 && quantity ? Math.round((Math.abs(amount) / quantity) * 1e6) / 1e6 : null;
    const price = mapping.price >= 0 ? parseNumber(cell(cells, mapping.price)) : fromAmount;
    const fees = mapping.fees.reduce((sum, at) => sum + Math.abs(parseNumber(cell(cells, at)) ?? 0), 0);
    const currency = (cell(cells, mapping.currency) || mapping.defaultCurrency).toUpperCase();
    const date = parseDate(cell(cells, mapping.date), mapping.dateOrder);
    let { kind, note } = classify(action, signed, symbol, company);
    if (kind !== 'SKIP' && !date) ({ kind, note } = { kind: 'SKIP', note: 'No date' });
    else if (kind !== 'SKIP' && !quantity) ({ kind, note } = { kind: 'SKIP', note: 'No shares' });
    return { line, kind, note, action, date, symbol, company, quantity, price, priceFromAmount: fromAmount !== null, fees: Math.round(fees * 100) / 100, currency };
  });
}

/** Fidelity's award history: shares paid out, without prices or sales. Why it can't be imported, and what to take. */
export const AWARD_HISTORY =
  "That's Fidelity's award history: it lists the shares each award paid out, but not their prices or the sales. " +
  'Choose the stock plan account history instead (its columns are Transaction date, Transaction type, Investment name, Shares and Amount).';

export const LAYOUT_NOTES: Record<Exclude<Layout, 'fidelity-awards' | 'other'>, string> = {
  'fidelity-history': "Read as Fidelity's account history",
  'fidelity-stock-plan': "Read as Fidelity's stock plan account history",
};

/** The ticker given for each company named in a statement, remembered on the account for the next one. */
const TICKERS_KEY = 'statement.tickers';

export function savedTickers(): Record<string, string> {
  const saved = setting<unknown>(TICKERS_KEY, {});
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
  return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** The tickers with one company's given (or taken away, when empty), saved. */
export function withTicker(tickers: Record<string, string>, company: string, ticker: string): Record<string, string> {
  const next = { ...tickers, [company]: ticker.trim().toUpperCase() };
  if (!next[company]) delete next[company];
  saveSetting(TICKERS_KEY, next);
  return next;
}

/** The file's text (FileReader where File.text() is missing, as in older browsers). */
export function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
