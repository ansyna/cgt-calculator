/** Market data for the calculator's pages (from /api/market): the ECB's exchange rates, and the currencies to choose from. */
import { useEffect, useState } from 'react';
import { api } from './api';
import type { Schemas } from './types';

/** An ECB rate: units of the currency per euro, and the day it's the rate of. */
export type Rate = Schemas['Rate'];

/** The currencies the ECB publishes a euro reference rate for, and the euro. */
export const CURRENCIES: [code: string, name: string][] = [
  ['EUR', 'Euro'],
  ['USD', 'US dollar'],
  ['GBP', 'Pound sterling'],
  ['CHF', 'Swiss franc'],
  ['JPY', 'Japanese yen'],
  ['CAD', 'Canadian dollar'],
  ['AUD', 'Australian dollar'],
  ['NZD', 'New Zealand dollar'],
  ['SEK', 'Swedish krona'],
  ['NOK', 'Norwegian krone'],
  ['DKK', 'Danish krone'],
  ['PLN', 'Polish zloty'],
  ['CZK', 'Czech koruna'],
  ['HUF', 'Hungarian forint'],
  ['RON', 'Romanian leu'],
  ['ISK', 'Icelandic krona'],
  ['TRY', 'Turkish lira'],
  ['HKD', 'Hong Kong dollar'],
  ['SGD', 'Singapore dollar'],
  ['CNY', 'Chinese yuan'],
  ['INR', 'Indian rupee'],
  ['KRW', 'South Korean won'],
  ['ILS', 'Israeli shekel'],
  ['ZAR', 'South African rand'],
  ['BRL', 'Brazilian real'],
  ['MXN', 'Mexican peso'],
  ['IDR', 'Indonesian rupiah'],
  ['MYR', 'Malaysian ringgit'],
  ['PHP', 'Philippine peso'],
  ['THB', 'Thai baht'],
];

/** The ECB's rate for a currency on a day (units per euro); none for the euro itself, missing when the ECB has none. */
export function useEcbRate(currency: string, date: string): { rate: Rate | null; missing: boolean } {
  const code = currency.trim().toUpperCase();
  const key = `${code}|${date}`;
  const [state, setState] = useState<{ key: string; rate: Rate | null } | null>(null);
  const wanted = /^[A-Z]{3}$/.test(code) && code !== 'EUR' && /^\d{4}-\d{2}-\d{2}$/.test(date);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    api<Rate>('/market/rate', { params: { currency: code, date } })
      .then((rate) => !cancelled && setState({ key, rate }))
      .catch(() => !cancelled && setState({ key, rate: null }));
    return () => {
      cancelled = true;
    };
  }, [wanted, code, date, key]);

  if (!wanted || state?.key !== key) return { rate: null, missing: false };
  return { rate: state.rate, missing: state.rate === null };
}
