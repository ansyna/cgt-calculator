import type { DateOrder, Mapping, Table } from '../statement';

/** Which column of a statement holds what: picked by the user when the columns aren't recognised. */
export default function StatementColumns({ table, mapping, onChange }: { table: Table; mapping: Mapping; onChange: (m: Mapping) => void }) {
  const options = (
    <>
      <option value={-1}>—</option>
      {table.header.map((name, i) => (
        <option key={i} value={i}>
          {name || `Column ${i + 1}`}
        </option>
      ))}
    </>
  );
  const pick = (key: 'date' | 'action' | 'symbol' | 'company' | 'quantity' | 'price' | 'amount' | 'currency', label: string, required = true) => (
    <div className="control">
      <label className="control-label" htmlFor={`import-${key}`}>
        {label}
        {!required && ' (if any)'}
      </label>
      <select id={`import-${key}`} className="form-select form-select-sm" value={mapping[key]} onChange={(e) => onChange({ ...mapping, [key]: Number(e.target.value) })}>
        {options}
      </select>
    </div>
  );
  return (
    <div className="statement-columns">
      {pick('date', 'Date')}
      {pick('action', 'Action or type', false)}
      {pick('symbol', 'Ticker', mapping.company < 0)}
      {mapping.symbol < 0 && pick('company', 'Company name')}
      {pick('quantity', 'Shares')}
      {pick('price', 'Price a share', mapping.amount < 0)}
      {mapping.price < 0 && pick('amount', 'Amount')}
      <div className="control">
        <label className="control-label" htmlFor="import-fees">
          Fees (if any)
        </label>
        <select
          id="import-fees"
          className="form-select form-select-sm"
          value={mapping.fees.length === 1 ? mapping.fees[0] : mapping.fees.length === 0 ? -1 : 'several'}
          onChange={(e) => onChange({ ...mapping, fees: Number(e.target.value) >= 0 ? [Number(e.target.value)] : [] })}
        >
          {mapping.fees.length > 1 && <option value="several">{mapping.fees.map((i) => table.header[i]).join(' + ')}</option>}
          {options}
        </select>
      </div>
      {pick('currency', 'Currency', false)}
      {mapping.currency < 0 && (
        <div className="control">
          <label className="control-label" htmlFor="import-default-currency">
            All in
          </label>
          <input
            id="import-default-currency"
            className="form-control form-control-sm statement-upper"
            maxLength={3}
            value={mapping.defaultCurrency}
            onChange={(e) => onChange({ ...mapping, defaultCurrency: e.target.value.toUpperCase() })}
          />
        </div>
      )}
      <div className="control">
        <label className="control-label" htmlFor="import-date-order">
          Dates
        </label>
        <select
          id="import-date-order"
          className="form-select form-select-sm"
          value={mapping.dateOrder}
          onChange={(e) => onChange({ ...mapping, dateOrder: e.target.value as DateOrder })}
        >
          <option value="MDY">Month first (10/03/2025 is 3 October)</option>
          <option value="DMY">Day first (10/03/2025 is 10 March)</option>
          <option value="YMD">Year first (2025-10-03)</option>
        </select>
      </div>
    </div>
  );
}
