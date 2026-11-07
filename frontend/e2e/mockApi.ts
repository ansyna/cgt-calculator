import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8'));

export interface MockApi {
  /** Every API request made, as "path?query". */
  requests: string[];
  /** The user's settings on their account (`/api/settings`), kept across reloads. */
  settings: Record<string, unknown>;
  /** The purchases and sales recorded. */
  transactions: Record<string, unknown>[];
}

const PURCHASE = {
  id: 1,
  kind: 'BUY',
  date: '2020-02-03',
  symbol: 'ACME',
  quantity: 100,
  price: 10,
  currency: 'EUR',
  fees: 0,
  eurRate: 1,
  source: 'RSU',
  note: null,
  eurValue: 1000,
  ecbRate: null,
  ecbRateDate: null,
  enteredIn: 'CGT',
  name: null,
};
const SALE = {
  id: 2,
  kind: 'SELL',
  date: '2025-06-02',
  symbol: 'ACME',
  quantity: 60,
  price: 40,
  currency: 'USD',
  fees: 10,
  eurRate: 1.17,
  source: null,
  note: null,
  eurValue: 2051.28,
  ecbRate: 1.1693,
  ecbRateDate: '2025-06-02',
  enteredIn: 'CGT',
  name: null,
};

/** A year's CGT: one sale of 60 ACME, partly covered by the exemption. */
function overview(year: number) {
  return {
    years: [2026, 2025],
    lossesBefore: 0,
    holdings: [{ symbol: 'ACME', quantity: 40, costEur: 400 }],
    summary: {
      year,
      disposalCount: year === 2025 ? 1 : 0,
      considerationEur: year === 2025 ? 2041.28 : 0,
      initialPeriod: { gainsEur: year === 2025 ? 1431.28 : 0, lossesEur: 0 },
      laterPeriod: { gainsEur: 0, lossesEur: 0 },
      gainsEur: year === 2025 ? 1431.28 : 0,
      lossesEur: 0,
      lossesBroughtForwardEur: 0,
      lossesUsedEur: 0,
      chargeableGainEur: year === 2025 ? 1431.28 : 0,
      exemptionEur: year === 2025 ? 1270 : 0,
      taxableGainEur: year === 2025 ? 161.28 : 0,
      taxEur: year === 2025 ? 53.22 : 0,
      initialPaymentEur: year === 2025 ? 53.22 : 0,
      initialDue: `${year}-12-15`,
      laterPaymentEur: 0,
      laterDue: `${year + 1}-01-31`,
      returnDue: `${year + 1}-10-31`,
      lossesCarriedForwardEur: 0,
      gainsByRate: year === 2025 ? [{ ratePercent: 33, amountEur: 1431.28 }] : [],
      form11: {
        gainsNetOfLossesEur: year === 2025 ? 1431.28 : 0,
        currentLossesCarriedForwardEur: 0,
        earlierLossesCarriedForwardEur: 0,
        initialNetGainEur: year === 2025 ? 161.28 : 0,
        laterNetGainEur: 0,
        netGainsByRate: year === 2025 ? [{ ratePercent: 33, initialNetGainEur: 161.28, laterNetGainEur: 0 }] : [],
        sharesAcquired: 0,
        sharesAcquiredEur: 0,
      },
      problems: [],
      disposals:
        year === 2025
          ? [
              {
                saleId: 2,
                date: '2025-06-02',
                symbol: 'ACME',
                quantity: 60,
                proceedsEur: 2051.28,
                feesEur: 10,
                costEur: 600,
                gainEur: 1431.28,
                restrictedLossUsedEur: 0,
                restrictedLossLostEur: 0,
                restrictedLossEur: 0,
                allowableEur: 1431.28,
                ratePercent: 33,
                unmatchedQuantity: 0,
                matches: [{ purchaseId: 1, purchased: '2020-02-03', quantity: 60, costEur: 600, rule: 'FIRST_IN_FIRST_OUT' }],
              },
            ]
          : [],
    },
  };
}

/** Serves the calculator's API: a signed-in admin with one purchase and one sale of ACME, and the ECB's rates. */
export async function mockApi(page: Page, { signedIn = true, settings = {} as Record<string, unknown> } = {}): Promise<MockApi> {
  const api: MockApi = { requests: [], settings: { ...settings }, transactions: [PURCHASE, SALE] };
  // the refresh cookie: the app swaps it for an access token on start
  let session = signedIn;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    api.requests.push(url.pathname + url.search);
    if (url.pathname === '/api/config') return route.fulfill({ json: { contactEmail: 'admin@example.com', mailEnabled: true } });
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: fixture('me') });
    if (url.pathname === '/api/auth/login') {
      session = true;
      return route.fulfill({ json: { token: 'e2e-token', user: fixture('me') } });
    }
    if (url.pathname === '/api/auth/refresh') {
      return session
        ? route.fulfill({ json: { token: 'e2e-token', user: fixture('me') } })
        : route.fulfill({ status: 401, json: { message: 'Please log in again.' } });
    }
    if (url.pathname === '/api/auth/logout') {
      session = false;
      return route.fulfill({ status: 204 });
    }
    if (url.pathname === '/api/auth/password/forgot') {
      return route.fulfill({ json: { message: 'If that email has an account, a reset link is on its way.' } });
    }
    if (url.pathname === '/api/settings') return route.fulfill({ json: api.settings });
    if (url.pathname.startsWith('/api/settings/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/settings/'.length));
      const value = method === 'PUT' ? JSON.parse(route.request().postData() ?? '{}').value : null;
      if (value === null || value === undefined) {
        delete api.settings[key];
        return route.fulfill({ json: {} });
      }
      api.settings[key] = value;
      return route.fulfill({ json: { [key]: value } });
    }
    // the ECB's rate: 1.1712 dollars (and any other currency) to the euro
    if (url.pathname === '/api/market/rate') {
      return route.fulfill({ json: { date: url.searchParams.get('date'), rate: url.searchParams.get('currency') === 'EUR' ? 1 : 1.1712 } });
    }
    if (url.pathname === '/api/cgt/overview') return route.fulfill({ json: overview(Number(url.searchParams.get('year') ?? 2025)) });
    if (url.pathname === '/api/cgt/settings') return route.fulfill({ json: { lossesBefore: 0 } });
    if (url.pathname === '/api/cgt/transactions' && method === 'GET') return route.fulfill({ json: api.transactions });
    if (url.pathname === '/api/cgt/transactions' && method === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      const saved = {
        id: api.transactions.length + 1,
        note: null,
        name: null,
        ecbRate: null,
        ecbRateDate: null,
        enteredIn: 'CGT',
        fees: 0,
        source: null,
        ...body,
        eurRate: body.eurRate ?? 1.1712,
        eurValue: (body.quantity * body.price) / (body.eurRate ?? 1.1712),
      };
      api.transactions = [...api.transactions, saved];
      return route.fulfill({ status: 201, json: saved });
    }
    return route.fulfill({ status: 404, json: { message: 'Not found' } });
  });
  return api;
}
