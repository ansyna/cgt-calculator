import { Suspense, type JSX } from 'react';
import { LoadingState } from './components/States';

/** A page loaded on demand (see lazyPage), with the loading skeleton meanwhile. */
export function onDemand(element: JSX.Element) {
  return <Suspense fallback={<LoadingState />}>{element}</Suspense>;
}
