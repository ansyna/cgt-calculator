import { api } from './api';
import type { Schemas } from './types';

/** Sentry settings from /api/config; an empty DSN means error reporting is off. */
type SentryConfig = Schemas['SentrySettings'];

type Reporter = { captureException: (error: unknown, hint?: { extra?: Record<string, unknown> }) => unknown };

let reporter: Reporter | null = null;

const SECRET_PARAM = /((?:^|[?&])(?:token|key|apikey)=)[^&#\s"]*/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Masks one-time tokens in links (reset, confirmation, invitation) and email addresses. */
export function scrub(text: string): string {
  return text.replace(SECRET_PARAM, '$1***').replace(EMAIL, '[email]');
}

/** Element attributes that hold text shown to people, e.g. aria-label="Delete Jane Doe". */
const LABEL_ATTRIBUTE = /\[(aria-label|title|alt|placeholder|name|value)="[^"]*"\]/g;

/**
 * Click and typing breadcrumbs describe the element, labels included: those can name people (an admin's "Delete
 * Jane Doe" button), so only the attribute names are kept.
 */
export function withoutLabels<T extends { category?: string; message?: string }>(breadcrumb: T): T {
  if (breadcrumb.category?.startsWith('ui.') && breadcrumb.message) {
    breadcrumb.message = breadcrumb.message.replace(LABEL_ATTRIBUTE, '[$1]');
  }
  return breadcrumb;
}

/** Scrubs every string in a report: page URL, breadcrumbs, messages and exception values. */
export function scrubAll<T>(value: T): T {
  if (typeof value === 'string') return scrub(value) as T;
  if (Array.isArray(value)) return value.map(scrubAll) as T;
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) (value as Record<string, unknown>)[key] = scrubAll(item);
  }
  return value;
}

/** Starts reporting errors to Sentry when the server has a DSN; the SDK is only downloaded then. */
export async function startMonitoring(): Promise<void> {
  let sentry: SentryConfig | undefined;
  try {
    sentry = (await api<Schemas['ClientConfig']>('/config')).sentry;
  } catch {
    return;
  }
  if (!sentry?.dsn) return;
  const Sentry = await import('./sentry');
  Sentry.init({
    dsn: sentry.dsn,
    environment: sentry.environment || undefined,
    release: sentry.release || undefined,
    // nothing about the person: no user details, cookies, headers or request bodies
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [] },
    beforeSend: (event) => scrubAll(event),
    beforeBreadcrumb: (breadcrumb) => scrubAll(withoutLabels(breadcrumb)),
  });
  reporter = Sentry;
}

/** Reports an error caught by the app itself (uncaught ones are reported automatically). */
export function reportError(error: unknown, extra?: Record<string, unknown>) {
  reporter?.captureException(error, extra ? { extra } : undefined);
}
