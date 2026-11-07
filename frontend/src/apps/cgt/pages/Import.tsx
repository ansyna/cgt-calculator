import { CheckCircle2, FileUp } from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../../../platform/api';
import SectionCard from '../../../platform/components/SectionCard';
import StatementColumns from '../../../platform/components/StatementColumns';
import StatementTickers from '../../../platform/components/StatementTickers';
import { AWARD_HISTORY, LAYOUT_NOTES, readText, savedTickers, withTicker } from '../../../platform/statement';
import { shares, shortDate, type Transaction } from '../cgt';
import {
  guessMapping,
  isComplete,
  marketKey,
  problem,
  readCsv,
  toRequest,
  toRows,
  withMarketValue,
  type ImportRow,
  type Layout,
  type Mapping,
  type RowKind,
  type Table,
} from '../csvImport';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** As many rows as one import takes (CgtController.MAX_IMPORT). */
const MAX_ROWS = 2000;

const KINDS: [RowKind, string][] = [
  ['BUY', 'Purchase'],
  ['RSU', 'RSU vest'],
  ['ESPP', 'ESPP purchase'],
  ['SELL', 'Sale'],
  ['SKIP', 'Leave out'],
];

type Override = { kind?: RowKind; price?: string; eurRate?: string };

/** The server's errors by the file's line ("transactions[3].eurRate" → the 4th row sent), and the lines lacking a rate. */
function errorsByLine(error: unknown, sentLines: number[]): { byLine: Map<number, string[]>; needRate: Set<number> } {
  const byLine = new Map<number, string[]>();
  const needRate = new Set<number>();
  if (!(error instanceof ApiError)) return { byLine, needRate };
  for (const [field, messages] of Object.entries(error.errors)) {
    const index = /^transactions\[(\d+)\]\.(\w+)/.exec(field);
    const line = index ? sentLines[Number(index[1])] : undefined;
    if (line === undefined || !index) continue;
    if (index[2] === 'eurRate') needRate.add(line);
    byLine.set(line, [...(byLine.get(line) ?? []), ...messages.map((m) => m.replace(/^Row \d+: /, ''))]);
  }
  return { byLine, needRate };
}

function Preview({
  rows,
  rowErrors,
  needRate,
  showSkipped,
  onOverride,
}: {
  rows: ImportRow[];
  rowErrors: Map<number, string[]>;
  /** Lines whose rate the ECB doesn't have: a field to type it. */
  needRate: Set<number>;
  showSkipped: boolean;
  onOverride: (line: number, override: Override) => void;
}) {
  const shown = rows.filter((r) => showSkipped || r.kind !== 'SKIP' || rowErrors.has(r.line));
  return (
    <div className="table-wrap">
      <table className="data-table cgt-preview">
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Date</th>
            <th scope="col">Import as</th>
            <th scope="col">Shares</th>
            <th scope="col">Price</th>
            <th scope="col">Fees</th>
            <th scope="col">From the statement</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const missing = problem(row);
            const errors = rowErrors.get(row.line);
            return (
              <tr key={row.line} className={row.kind === 'SKIP' ? 'cgt-skipped' : errors || missing ? 'cgt-attention' : ''}>
                <th scope="row">{row.line}</th>
                <td>{row.date ? shortDate(row.date) : '—'}</td>
                <td>
                  <select
                    className="form-select form-select-sm"
                    aria-label={`Import line ${row.line} as`}
                    value={row.kind}
                    onChange={(e) => onOverride(row.line, { kind: e.target.value as RowKind })}
                  >
                    {KINDS.map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {row.quantity === null ? '—' : shares(row.quantity)} {row.symbol || row.company}
                </td>
                <td>
                  {row.kind === 'SKIP' ? (
                    row.price === null ? '—' : `${row.price} ${row.currency}`
                  ) : (
                    <div className="cgt-price">
                      <input
                        className={`form-control form-control-sm ${missing ? 'is-invalid' : ''}`}
                        aria-label={`Price a share on line ${row.line} (${row.currency})`}
                        inputMode="decimal"
                        value={row.price === null ? '' : String(row.price)}
                        onChange={(e) => onOverride(row.line, { price: e.target.value })}
                      />
                      <span>{row.currency}</span>
                    </div>
                  )}
                </td>
                <td>{row.fees ? `${row.fees} ${row.currency}` : '—'}</td>
                <td className="cgt-statement">
                  <span>{row.action}</span>
                  {row.note && <span className="cgt-row-note">{row.note}</span>}
                  {missing && row.kind !== 'SKIP' && <span className="cgt-row-error">{missing}</span>}
                  {errors?.map((e) => (
                    <span key={e} className="cgt-row-error">
                      {e}
                    </span>
                  ))}
                  {(needRate.has(row.line) || row.eurRate !== null) && row.kind !== 'SKIP' && (
                    <label className="cgt-rate">
                      {row.currency} per euro on {row.date ? shortDate(row.date) : 'the day'}
                      <input
                        className="form-control form-control-sm"
                        inputMode="decimal"
                        value={row.eurRate === null ? '' : String(row.eurRate)}
                        onChange={(e) => onOverride(row.line, { eurRate: e.target.value })}
                      />
                    </label>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Imports a broker's CSV statement: read in the browser, previewed, then recorded all at once. */
export default function Import() {
  const [file, setFile] = useState<{ name: string; table: Table } | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [layout, setLayout] = useState<Layout>('other');
  const [tickers, setTickers] = useState<Record<string, string>>(savedTickers);
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [existing, setExisting] = useState<Transaction[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [importError, setImportError] = useState<{ error: unknown; sentLines: number[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Transaction[]>('/cgt/transactions')
      .then((list) => !cancelled && setExisting(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [imported]);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    setReadError(null);
    setImportError(null);
    setImported(null);
    setOverrides({});
    setNeedRate(new Set());
    if (!chosen) return;
    if (chosen.size > MAX_FILE_BYTES) {
      setFile(null);
      setReadError('That file is over 5 MB: export a shorter period.');
      return;
    }
    const table = readCsv(await readText(chosen));
    if (table.rows.length === 0) {
      setFile(null);
      setReadError("No rows found: is it the CSV export of your statement (not the PDF)?");
      return;
    }
    const guess = guessMapping(table);
    if (guess.layout === 'fidelity-awards') {
      setFile(null);
      setReadError(AWARD_HISTORY);
      return;
    }
    setFile({ name: chosen.name, table });
    setMapping(guess.mapping);
    setLayout(guess.layout);
  };

  const giveTicker = (company: string, ticker: string) => {
    setImportError(null);
    setTickers(withTicker(tickers, company, ticker));
  };

  const typed = useMemo(() => {
    if (!file || !mapping) return [];
    return toRows(file.table, mapping, existing, tickers).map((row) => {
      const override = overrides[row.line];
      if (!override) return row;
      const price = override.price === undefined ? row.price : override.price.trim() === '' ? null : Number(override.price.replace(',', '.'));
      const rate = override.eurRate === undefined || override.eurRate.trim() === '' ? null : Number(override.eurRate.replace(',', '.'));
      return {
        ...row,
        kind: override.kind ?? row.kind,
        price: price === null || Number.isNaN(price) ? null : price,
        // an ESPP purchase's price typed is its market value; the statement's, the price paid
        paid: (override.kind ?? row.kind) === 'ESPP' && override.price !== undefined ? (row.price ?? undefined) : row.paid,
        eurRate: rate === null || Number.isNaN(rate) || rate <= 0 ? null : rate,
      };
    });
  }, [file, mapping, existing, overrides, tickers]);
  // a vest's price, unless typed, is its market value that day: asked for
  const rows = useMemo(
    () => typed.map((row) => (marketKey(row) === null || overrides[row.line]?.price !== undefined ? row : withMarketValue(row))),
    [typed, overrides],
  );

  const toImport = rows.filter((r) => r.kind !== 'SKIP');
  const needingWork = toImport.filter((r) => problem(r) !== null);
  const skipped = rows.length - toImport.length;
  const complete = mapping !== null && isComplete(mapping);
  // without a ticker column, each company named in a row that's kept
  const companies = mapping && mapping.symbol < 0 ? [...new Set(rows.filter((r) => r.kind !== 'SKIP' && r.company).map((r) => r.company))] : [];
  const noTickers = needingWork.filter((r) => !r.symbol).length;
  const { byLine: rowErrors, needRate: errorRates } = importError
    ? errorsByLine(importError.error, importError.sentLines)
    : { byLine: new Map<number, string[]>(), needRate: new Set<number>() };
  // once asked for, a rate field stays while it's being typed (the errors go when a row changes)
  const [needRate, setNeedRate] = useState<Set<number>>(new Set());
  const rateLines = new Set([...needRate, ...errorRates]);

  const override = (line: number, change: Override) => {
    if (errorRates.size > 0) setNeedRate(new Set([...needRate, ...errorRates]));
    setImportError(null);
    setOverrides((all) => ({ ...all, [line]: { ...all[line], ...change } }));
  };

  const run = async () => {
    const sentLines = toImport.map((r) => r.line);
    setImporting(true);
    setImportError(null);
    try {
      const result = await api<{ imported: number }>('/cgt/transactions/import', {
        method: 'POST',
        body: { transactions: toImport.map(toRequest) },
      });
      setImported(result.imported);
      setFile(null);
      setMapping(null);
      setOverrides({});
    } catch (e) {
      setImportError({ error: e, sentLines });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="tool-page">
      <header className="page-header">
        <div className="page-icon" aria-hidden>
          <FileUp size={22} />
        </div>
        <div className="page-heading">
          <div className="page-eyebrow">CGT calculator</div>
          <h1>Import a statement</h1>
          <p className="page-description">
            Your broker's CSV export, e.g. Fidelity's account history. It's read on this device; nothing is recorded until you
            import.
          </p>
        </div>
      </header>

      {imported !== null && (
        <div className="alert alert-success cgt-done" role="status">
          <CheckCircle2 size={18} aria-hidden />
          <span>
            {imported} {imported === 1 ? 'transaction' : 'transactions'} imported. See the <Link to="/cgt">tax year</Link> or{' '}
            <Link to="/cgt/transactions">all purchases &amp; sales</Link>.
          </span>
        </div>
      )}

      <SectionCard title="Choose the file">
        <label htmlFor="import-file" className="form-label">
          CSV statement
        </label>
        <input id="import-file" type="file" accept=".csv,text/csv" className="form-control" onChange={choose} />
        <p className="cgt-note">
          In Fidelity, open your account's activity or history and download it as CSV; for shares from your employer (RSUs,
          ESPP), download the stock plan account's transaction history, not the award history. Take the whole period since
          you first got the shares; rows already recorded are left out.
        </p>
        {readError && (
          <div className="alert alert-danger mt-3 mb-0" role="alert">
            {readError}
          </div>
        )}
      </SectionCard>

      {file && mapping && (
        <SectionCard
          title="Columns"
          notes={[layout !== 'fidelity-awards' && layout !== 'other' ? LAYOUT_NOTES[layout] : complete ? 'Found by their names: check them' : 'Pick the columns', file.name]}
        >
          <details open={!complete || layout === 'other'}>
            <summary className="cgt-summary">Columns used</summary>
            <StatementColumns table={file.table} mapping={mapping} onChange={(m) => setMapping(m)} />
          </details>
        </SectionCard>
      )}

      {file && mapping && complete && companies.length > 0 && (
        <StatementTickers companies={companies} tickers={tickers} onChange={giveTicker} />
      )}

      {file && mapping && complete && (
        <SectionCard
          title="Check and import"
          notes={[
            `${toImport.length} to import`,
            `${skipped} left out (dividends, cash, already recorded…)`,
            'the ECB rate of each day is used',
          ]}
        >
          {importError && (
            <div className="alert alert-danger" role="alert">
              Nothing was imported.{' '}
              {rowErrors.size > 0
                ? 'Fix the rows marked below, or leave them out.'
                : importError.error instanceof Error
                  ? importError.error.message
                  : String(importError.error)}
            </div>
          )}
          {toImport.length === 0 && !importError && (
            <p className="cgt-nothing">
              Nothing new to import: every row is already recorded, or isn't a purchase or sale.
            </p>
          )}
          <div className="form-check form-switch mb-2">
            <input id="show-skipped" type="checkbox" role="switch" className="form-check-input" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} />
            <label htmlFor="show-skipped" className="form-check-label">
              Show the rows left out
            </label>
          </div>
          {(toImport.length > 0 || showSkipped) && (
            <Preview rows={rows} rowErrors={rowErrors} needRate={rateLines} showSkipped={showSkipped} onOverride={override} />
          )}
          {toImport.length > 0 && (
            <div className="cgt-actions mt-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={importing || toImport.length === 0 || needingWork.length > 0 || toImport.length > MAX_ROWS}
                onClick={run}
              >
                {importing ? 'Importing…' : `Import ${toImport.length} ${toImport.length === 1 ? 'transaction' : 'transactions'}`}
              </button>
              {needingWork.length > 0 && (
                <span className="cgt-row-error align-self-center">
                  {noTickers > 0
                    ? `Give the ${companies.length === 1 ? 'ticker' : 'tickers'} above`
                    : `${needingWork.length} ${needingWork.length === 1 ? 'row needs' : 'rows need'} a price (or leave ${needingWork.length === 1 ? 'it' : 'them'} out)`}
                </span>
              )}
              {toImport.length > MAX_ROWS && (
                <span className="cgt-row-error align-self-center">At most {MAX_ROWS} rows at a time: export a shorter period</span>
              )}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
