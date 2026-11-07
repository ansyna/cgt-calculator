import { ArrowLeftRight, Pencil, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../../platform/api';
import { useConfirm } from '../../../platform/components/ConfirmDialog';
import { useParam } from '../../../platform/components/Controls';
import FieldErrors from '../../../platform/components/FieldErrors';
import SectionCard from '../../../platform/components/SectionCard';
import { ErrorState, LoadingState } from '../../../platform/components/States';
import { saveSetting, setting } from '../../../platform/settings';
import { CURRENCIES, useEcbRate } from '../../../platform/market';
import { euro, shares, shortDate, type Transaction, type TransactionRequest } from '../cgt';

const CURRENCY_KEY = 'cgt.currency';

/** What the list can show: everything, or one type of trade. */
const TYPES: [string, string, (t: Transaction) => boolean][] = [
  ['', 'All', () => true],
  ['purchases', 'Purchases', (t) => t.kind === 'BUY'],
  ['sales', 'Sales', (t) => t.kind === 'SELL'],
  ['rsu', 'RSU vests', (t) => t.kind === 'BUY' && t.source === 'RSU'],
  ['espp', 'ESPP purchases', (t) => t.kind === 'BUY' && t.source === 'ESPP'],
];

/** "1.1712", as many decimals as it has up to six. */
const rateText = (rate: number) => rate.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** The rate a trade was entered with set against the ECB's of its day: how far apart, when they differ (by 0.05% or more). */
function rateDifference(t: Transaction): number | null {
  if (t.currency === 'EUR' || t.ecbRate == null || t.ecbRate === 0) return null;
  const apart = t.eurRate / t.ecbRate - 1;
  return Math.abs(apart) >= 0.0005 ? apart : null;
}

/** The ECB's reference rate of a trade's day, the day it's of when that's another (a weekend's: the Friday's). */
function EcbRateCell({ t }: { t: Transaction }) {
  if (t.currency === 'EUR') return <td>—</td>;
  if (t.ecbRate == null) {
    return (
      <td className="text-muted" title="Not looked up yet: filled in once the ECB can be reached">
        Not yet
      </td>
    );
  }
  const apart = rateDifference(t);
  return (
    <td>
      {rateText(t.ecbRate)}
      {t.ecbRateDate && t.ecbRateDate !== t.date && <small className="d-block text-muted">of {shortDate(t.ecbRateDate)}</small>}
      {apart !== null && (
        <small className="d-block text-warning-emphasis">
          the rate used is {Math.abs(apart * 100).toLocaleString('en-IE', { maximumFractionDigits: 2 })}% {apart > 0 ? 'higher' : 'lower'}
        </small>
      )}
    </td>
  );
}

interface Form {
  kind: 'BUY' | 'SELL';
  date: string;
  symbol: string;
  quantity: string;
  price: string;
  currency: string;
  fees: string;
  /** The currency the fees are in: the trade's, or another one (converted at the ECB's rates). */
  feeCurrency: string;
  eurRate: string;
  source: 'BUY' | 'RSU' | 'ESPP';
  note: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): Form {
  const currency = setting<string>(CURRENCY_KEY, 'USD');
  return {
    kind: 'BUY',
    date: today(),
    symbol: '',
    quantity: '',
    price: '',
    currency,
    fees: '',
    feeCurrency: currency,
    eurRate: '',
    source: 'BUY',
    note: '',
  };
}

function formOf(t: Transaction): Form {
  return {
    kind: t.kind,
    date: t.date,
    symbol: t.symbol,
    quantity: String(t.quantity),
    price: String(t.price),
    currency: t.currency,
    fees: t.fees ? String(t.fees) : '',
    feeCurrency: t.currency,
    eurRate: t.currency === 'EUR' ? '' : String(t.eurRate),
    source: t.source ?? 'BUY',
    note: t.note ?? '',
  };
}

/** A number typed with a comma or a point; null when empty. */
function number(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  return trimmed === '' ? null : Number(trimmed);
}

/** @param fees the fees in the trade's currency */
function requestOf(form: Form, fees: number | null): TransactionRequest {
  const currency = form.currency.trim().toUpperCase();
  return {
    kind: form.kind,
    date: form.date,
    symbol: form.symbol,
    quantity: number(form.quantity) ?? 0,
    price: number(form.price) ?? 0,
    currency,
    fees,
    eurRate: currency === 'EUR' ? null : number(form.eurRate),
    source: form.kind === 'BUY' ? form.source : null,
    note: form.note.trim() || null,
  };
}

const SOURCES: [Form['source'], string][] = [
  ['BUY', 'Bought'],
  ['RSU', 'RSU vest'],
  ['ESPP', 'ESPP purchase'],
];

const KNOWN_CURRENCY = new Set(CURRENCIES.map(([code]) => code));

/** The currencies to choose from, with one recorded before that isn't in the list; by code alone where space is short. */
function currencyOptions(current: string[], codesOnly = false) {
  const extra = current.filter((c) => c && !KNOWN_CURRENCY.has(c)).map((c): [string, string] => [c, c]);
  return [...CURRENCIES, ...extra].map(([code, name]) => (
    <option key={code} value={code}>
      {codesOnly || code === name ? code : `${code} – ${name}`}
    </option>
  ));
}

function TransactionForm({ editing, onSaved, onCancel }: { editing: Transaction | null; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<Form>(() => (editing ? formOf(editing) : emptyForm()));
  // the rate typed by the user, as opposed to the ECB's filled in
  const [ownRate, setOwnRate] = useState(editing !== null && editing.currency !== 'EUR');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const ecb = useEcbRate(form.currency, form.date);
  const foreign = form.currency.trim().toUpperCase() !== 'EUR';
  const shownRate = ownRate ? form.eurRate : ecb.rate ? String(ecb.rate.rate) : '';
  const set = (changes: Partial<Form>) => setForm((f) => ({ ...f, ...changes }));
  const unit = form.currency.trim().toUpperCase() || 'currency';

  // a new currency for the trade; the fees follow it unless they were given in another one
  const setCurrency = (f: Form, currency: string): Form => ({
    ...f,
    currency,
    feeCurrency: f.feeCurrency === f.currency ? currency : f.feeCurrency,
  });

  // the fees in the trade's currency: as typed, or converted at the ECB's rates of the day (undefined: no rate)
  const feeEcb = useEcbRate(form.feeCurrency === unit ? 'EUR' : form.feeCurrency, form.date);
  const typedFees = number(form.fees);
  const tradeRate = unit === 'EUR' ? 1 : number(shownRate);
  const feeRate = form.feeCurrency === 'EUR' ? 1 : (feeEcb.rate?.rate ?? null);
  const fees: number | null | undefined =
    typedFees === null || form.feeCurrency === unit
      ? typedFees
      : tradeRate && feeRate
        ? Math.round(((typedFees * tradeRate) / feeRate) * 100) / 100
        : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (fees === undefined) throw new Error(`No ECB rate for ${form.feeCurrency} on that day: enter the fees in ${unit}.`);
      const body = requestOf({ ...form, eurRate: shownRate }, fees);
      await api(editing ? `/cgt/transactions/${editing.id}` : '/cgt/transactions', { method: editing ? 'PUT' : 'POST', body });
      saveSetting(CURRENCY_KEY, body.currency);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const valued = form.kind === 'BUY' && form.source !== 'BUY';
  return (
    <SectionCard title={editing ? 'Change the transaction' : 'Record a purchase or sale'}>
      <FieldErrors error={error} />
      <form className="cgt-form" onSubmit={submit}>
        <fieldset className="cgt-kind">
          <legend className="form-label">Type</legend>
          {(['BUY', 'SELL'] as const).map((kind) => (
            <label key={kind} className={`btn btn-sm ${form.kind === kind ? 'btn-primary' : 'btn-outline-primary'}`}>
              <input type="radio" className="visually-hidden" name="kind" checked={form.kind === kind} onChange={() => set({ kind })} />
              {kind === 'BUY' ? 'Purchase' : 'Sale'}
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor="cgt-date" className="form-label">
            Date
          </label>
          <input id="cgt-date" type="date" className="form-control" max={today()} value={form.date} onChange={(e) => set({ date: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="cgt-symbol" className="form-label">
            Ticker
          </label>
          <input
            id="cgt-symbol"
            className="form-control cgt-upper"
            placeholder="e.g. AAPL"
            maxLength={20}
            autoCapitalize="characters"
            required
            value={form.symbol}
            onChange={(e) => set({ symbol: e.target.value.toUpperCase() })}
          />
        </div>
        <div>
          <label htmlFor="cgt-quantity" className="form-label">
            Shares
          </label>
          <input id="cgt-quantity" className="form-control" inputMode="decimal" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="cgt-currency" className="form-label">
            Currency
          </label>
          <select id="cgt-currency" className="form-select" value={unit} onChange={(e) => setForm((f) => setCurrency(f, e.target.value))}>
            {currencyOptions([unit])}
          </select>
        </div>
        <div className="cgt-wide">
          <label htmlFor="cgt-price" className="form-label">
            Price a share ({unit})
          </label>
          <input id="cgt-price" className="form-control cgt-price-input" inputMode="decimal" value={form.price} onChange={(e) => set({ price: e.target.value })} required />
          <div className="form-text">
            {valued
              ? `The market value on the ${form.source === 'ESPP' ? 'purchase' : 'vest'} day, usually the close: check it against ${form.source === 'ESPP' ? 'the purchase confirmation' : 'your payslip'}.`
              : 'The price you got a share, as on the contract note.'}
          </div>
        </div>
        <div>
          <label htmlFor="cgt-fees" className="form-label">
            Fees
          </label>
          <div className="input-group">
            <input id="cgt-fees" className="form-control" inputMode="decimal" placeholder="0" value={form.fees} onChange={(e) => set({ fees: e.target.value })} />
            <select aria-label="Fees currency" className="form-select cgt-fee-currency" value={form.feeCurrency} onChange={(e) => set({ feeCurrency: e.target.value })}>
              {currencyOptions([form.feeCurrency, unit], true)}
            </select>
          </div>
          {typedFees !== null && form.feeCurrency !== unit && (
            <div className="form-text">
              {fees === undefined
                ? !tradeRate
                  ? `Needs the ${unit} per euro rate to convert`
                  : feeEcb.missing
                    ? `No ECB rate for ${form.feeCurrency} that day`
                    : 'Converting…'
                : `= ${fees} ${unit} at the ECB's rates of the day`}
            </div>
          )}
        </div>
        {foreign && (
          <div>
            <label htmlFor="cgt-rate" className="form-label">
              {unit} per euro
            </label>
            <input
              id="cgt-rate"
              className="form-control"
              inputMode="decimal"
              value={shownRate}
              onChange={(e) => {
                setOwnRate(true);
                set({ eurRate: e.target.value });
              }}
              aria-describedby="cgt-rate-help"
            />
            <div id="cgt-rate-help" className="form-text">
              {ownRate ? (
                <>
                  Your rate.{' '}
                  <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setOwnRate(false)}>
                    Use the ECB's
                  </button>
                </>
              ) : ecb.rate ? (
                `The ECB's rate of ${shortDate(ecb.rate.date)}`
              ) : ecb.missing ? (
                'No ECB rate found: enter the rate of the day'
              ) : (
                "The ECB's rate of the day"
              )}
            </div>
          </div>
        )}
        {form.kind === 'BUY' && (
          <div>
            <label htmlFor="cgt-source" className="form-label">
              Acquired as
            </label>
            <select id="cgt-source" className="form-select" value={form.source} onChange={(e) => set({ source: e.target.value as Form['source'] })}>
              {SOURCES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="cgt-wide">
          <label htmlFor="cgt-note" className="form-label">
            Note
          </label>
          <input id="cgt-note" className="form-control" maxLength={200} value={form.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
        <div className="cgt-actions cgt-wide">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : form.kind === 'BUY' ? 'Add purchase' : 'Add sale'}
          </button>
          {editing && (
            <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </SectionCard>
  );
}

/** Deletes the transactions of a period at once, e.g. to import its statement again. */
function DeletePeriod({ transactions, onDeleted }: { transactions: Transaction[]; onDeleted: (deleted: number, from: string, to: string) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const years = [...new Set(transactions.map((t) => t.date.slice(0, 4)))].sort().reverse();
  const valid = from !== '' && to !== '' && from <= to;
  const count = valid ? transactions.filter((t) => t.date >= from && t.date <= to).length : 0;

  const run = async () => {
    const sure = await confirm({
      title: `Delete ${count} ${count === 1 ? 'transaction' : 'transactions'}?`,
      message: `Every purchase and sale from ${shortDate(from)} to ${shortDate(to)}. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!sure) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await api<{ deleted: number }>('/cgt/transactions', { method: 'DELETE', params: { from, to } });
      setFrom('');
      setTo('');
      onDeleted(result.deleted, from, to);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SectionCard title="Delete a period" notes={['to import its statement again']}>
      {dialog}
      {years.length > 0 && (
        <div className="cgt-years mb-2" role="group" aria-label="Whole year">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              className={`btn btn-sm ${from === `${y}-01-01` && to === `${y}-12-31` ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => {
                setFrom(`${y}-01-01`);
                setTo(`${y}-12-31`);
              }}
            >
              {y}
            </button>
          ))}
        </div>
      )}
      <div className="cgt-period">
        <div>
          <label htmlFor="cgt-delete-from" className="form-label">
            From
          </label>
          <input id="cgt-delete-from" type="date" className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cgt-delete-to" className="form-label">
            To
          </label>
          <input id="cgt-delete-to" type="date" className="form-control" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button type="button" className="btn btn-outline-danger align-self-end" disabled={deleting || count === 0} onClick={run}>
          <Trash2 size={16} aria-hidden /> {deleting ? 'Deleting…' : `Delete ${count} ${count === 1 ? 'transaction' : 'transactions'}`}
        </button>
      </div>
      {from !== '' && to !== '' && from > to && <div className="cgt-row-error mt-2">The last day can&apos;t be before the first.</div>}
      {error && (
        <div className="alert alert-danger mt-2 mb-0" role="alert">
          {error}
        </div>
      )}
      <p className="cgt-note">
        Purchases and sales from the first day to the last, both included. Sales after the period may lack their purchases until you
        import it again.
      </p>
    </SectionCard>
  );
}

/** The CGT calculator's purchases and sales: what the CGT is worked out from. */
export default function Transactions() {
  const [reloads, setReloads] = useState(0);
  const [state, setState] = useState<{ reloads: number; data: Transaction[] | null; error: string | null } | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [deleted, setDeleted] = useState<{ count: number; from: string; to: string } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const formTop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<Transaction[]>('/cgt/transactions')
      .then((data) => !cancelled && setState({ reloads, data, error: null }))
      .catch((e: Error) => !cancelled && setState({ reloads, data: null, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  const saved = () => {
    setEditing(null);
    setFormKey((k) => k + 1);
    setReloads((n) => n + 1);
  };

  const edit = (t: Transaction) => {
    setEditing(t);
    setFormKey((k) => k + 1);
    formTop.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const remove = async (t: Transaction) => {
    const sure = await confirm({
      title: `Delete this ${t.kind === 'BUY' ? 'purchase' : 'sale'}?`,
      message: `${shares(t.quantity)} ${t.symbol} on ${shortDate(t.date)}.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!sure) return;
    setRemoveError(null);
    try {
      await api(`/cgt/transactions/${t.id}`, { method: 'DELETE' });
      if (editing?.id === t.id) setEditing(null);
      setReloads((n) => n + 1);
    } catch (e) {
      setRemoveError((e as Error).message);
    }
  };

  const list = state?.data ? [...state.data].reverse() : [];
  // the list filtered: by type, and by share (its ticker, or its name)
  const [type, setType] = useParam('type');
  const [stock, setStock] = useParam('stock');
  const [, setSearchParams] = useSearchParams();
  const typeOf = TYPES.find(([value]) => value === type) ?? TYPES[0];
  const stocks = [...new Map(list.map((t) => [t.symbol, t.name ?? null])).entries()].sort(([a], [b]) => a.localeCompare(b));
  // and by day: from one, to another (both included)
  const [from, setFrom] = useParam('from');
  const [to, setTo] = useParam('to');
  const shown = list.filter((t) => typeOf[2](t) && (!stock || t.symbol === stock) && (!from || t.date >= from) && (!to || t.date <= to));
  const filtered = !!(type || stock || from || to);
  return (
    <div className="tool-page">
      <header className="page-header">
        <div className="page-icon" aria-hidden>
          <ArrowLeftRight size={22} />
        </div>
        <div className="page-heading">
          <div className="page-eyebrow">CGT calculator</div>
          <h1>Purchases &amp; sales</h1>
          <p className="page-description">
            Every purchase and sale of your own shares, RSU vests and ESPP purchases included. The <Link to="/cgt">tax year</Link> is worked out
            from them. Many at once: <Link to="/cgt/import">import a statement</Link>.
          </p>
        </div>
      </header>
      {dialog}
      {removeError && (
        <div className="alert alert-danger" role="alert">
          {removeError}
        </div>
      )}
      {deleted && (
        <div className="alert alert-success" role="status">
          {deleted.count} {deleted.count === 1 ? 'transaction' : 'transactions'} from {shortDate(deleted.from)} to {shortDate(deleted.to)}{' '}
          deleted. <Link to="/cgt/import">Import the statement</Link> again.
        </div>
      )}
      <div ref={formTop}>
        <TransactionForm key={formKey} editing={editing} onSaved={saved} onCancel={saved} />
      </div>
      {!state ? (
        <LoadingState />
      ) : state.error ? (
        <ErrorState message={state.error} />
      ) : list.length === 0 ? (
        <div className="state-card">
          <ArrowLeftRight size={28} aria-hidden />
          <div>
            <div className="state-title">Nothing recorded yet</div>
            <div className="state-text">Start with the purchases of the shares you hold or sold, then the sales.</div>
          </div>
        </div>
      ) : (
        <SectionCard
          title="Recorded"
          notes={[filtered ? `${shown.length} of ${list.length}` : `${list.length} ${list.length === 1 ? 'transaction' : 'transactions'}`, 'newest first']}
        >
          <div className="cgt-filters">
            <div className="control">
              <label className="control-label" htmlFor="cgt-filter-type">
                Show
              </label>
              <select id="cgt-filter-type" className="form-select form-select-sm" value={typeOf[0]} onChange={(e) => setType(e.target.value)}>
                {TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="control">
              <label className="control-label" htmlFor="cgt-filter-stock">
                Share
              </label>
              <select id="cgt-filter-stock" className="form-select form-select-sm" value={stock} onChange={(e) => setStock(e.target.value)}>
                <option value="">All shares</option>
                {stocks.map(([symbol, name]) => (
                  <option key={symbol} value={symbol}>
                    {name ? `${symbol} · ${name}` : symbol}
                  </option>
                ))}
              </select>
            </div>
            <div className="control">
              <label className="control-label" htmlFor="cgt-filter-from">
                Date from
              </label>
              <input
                id="cgt-filter-from"
                type="date"
                className="form-control form-control-sm"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="control">
              <label className="control-label" htmlFor="cgt-filter-to">
                Date to
              </label>
              <input
                id="cgt-filter-to"
                type="date"
                className="form-control form-control-sm"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            {filtered && (
              <button
                type="button"
                className="btn btn-link btn-sm align-self-end"
                onClick={() =>
                  // all at once (one after the other, each would put the others back)
                  setSearchParams((params) => {
                    for (const name of ['type', 'stock', 'from', 'to']) params.delete(name);
                    return params;
                  })
                }
              >
                Show all
              </button>
            )}
          </div>
          {shown.length === 0 && <p className="cgt-nothing">None matches these filters.</p>}
          <div className="table-wrap">
            <table className="data-table cgt-transactions">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Type</th>
                  <th scope="col">Shares</th>
                  <th scope="col">Price</th>
                  <th scope="col">Fees</th>
                  <th scope="col">In euro</th>
                  <th scope="col" title="The rate the trade was entered with: its euro figures are worked out at it">
                    Rate used
                  </th>
                  <th scope="col" title="The ECB's reference rate of the trade's day (the last before it on a weekend or holiday)">
                    ECB rate
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">{shortDate(t.date)}</th>
                    <td>
                      {t.kind === 'BUY' ? (t.source === 'RSU' ? 'RSU vest' : t.source === 'ESPP' ? 'ESPP' : 'Purchase') : 'Sale'}
                    </td>
                    <td>
                      {shares(t.quantity)} {t.symbol}
                    </td>
                    <td>
                      {t.price.toLocaleString('en-IE', { maximumFractionDigits: 6 })} {t.currency}
                    </td>
                    <td>{t.fees ? `${t.fees.toLocaleString('en-IE', { minimumFractionDigits: 2 })} ${t.currency}` : '—'}</td>
                    <td>{euro(t.eurValue)}</td>
                    <td>{t.currency === 'EUR' ? '—' : `${rateText(t.eurRate)} ${t.currency}/€`}</td>
                    <EcbRateCell t={t} />
                    <td className="cgt-row-actions">
                      <button type="button" className="btn btn-icon" aria-label={`Change ${t.symbol} on ${shortDate(t.date)}`} onClick={() => edit(t)}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" className="btn btn-icon" aria-label={`Delete ${t.symbol} on ${shortDate(t.date)}`} onClick={() => remove(t)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
      {list.length > 0 && (
        <DeletePeriod
          transactions={list}
          onDeleted={(count, from, to) => {
            setDeleted({ count, from, to });
            setEditing(null);
            setFormKey((k) => k + 1);
            setReloads((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
