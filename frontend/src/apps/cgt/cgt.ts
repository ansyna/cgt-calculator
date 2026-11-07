import type { Schemas } from '../../platform/types';

export type Transaction = Schemas['CgtTransactionDto'];
export type TransactionRequest = Schemas['CgtTransactionRequest'];
export type Overview = Schemas['CgtOverview'];
export type YearSummary = Schemas['YearSummary'];
export type Disposal = Schemas['Disposal'];
export type Holding = Schemas['Holding'];
export type { Rate } from '../../platform/market';
export { CURRENCIES } from '../../platform/market';

const euros = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const wholeEuros = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const dates = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDates = new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "€1,234.56" */
export function euro(amount: number): string {
  return euros.format(amount);
}

/** "€1,235": the form's amounts are in whole euro. */
export function wholeEuro(amount: number): string {
  return wholeEuros.format(Math.round(amount));
}

/** "15 December 2025" from "2025-12-15". */
export function longDate(isoDate: string): string {
  return dates.format(new Date(`${isoDate}T00:00:00Z`));
}

/** "15 Dec 2025" */
export function shortDate(isoDate: string): string {
  return shortDates.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Shares, without trailing zeros: "10", "0.75". */
export function shares(quantity: number): string {
  return quantity.toLocaleString('en-IE', { maximumFractionDigits: 6 });
}
