// Only what the app uses, so the rest of the SDK (replay, tracing, feedback) stays out of the download.
export { captureException, init } from '@sentry/browser';
