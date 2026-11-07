import { useEffect, useState } from 'react';
import { api } from '../../platform/api';
import type { Overview } from './cgt';

/**
 * The CGT overview of a tax year (by default the latest with sales); `reload` asks for it again. While a new year
 * loads, the last answer isn't shown for it. `rates` "ECB": each trade at the ECB's rate of its day (the trades as entered).
 */
export function useOverview(year: string, rates = ''): { overview: Overview | null; error: string | null; loading: boolean; reload: () => void } {
  const [reloads, setReloads] = useState(0);
  const request = `${year}|${rates}|${reloads}`;
  // the answer and the request it answers: an older one is never shown for a new year
  const [state, setState] = useState<{ request: string; data: Overview | null; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Overview>('/cgt/overview', { params: { ...(year ? { year } : {}), ...(rates ? { rates } : {}) } })
      .then((data) => !cancelled && setState({ request, data, error: null }))
      .catch((e: Error) => !cancelled && setState({ request, data: null, error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [year, rates, request]);

  return {
    overview: state?.data ?? null,
    error: state?.error ?? null,
    loading: state?.request !== request && !state?.data,
    reload: () => setReloads((n) => n + 1),
  };
}
