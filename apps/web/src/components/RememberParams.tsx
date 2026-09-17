/**
 * Remembers a URL-driven page's sort and filters, and puts them back when the page is opened
 * again without them (from the menu, or Back after converting an opening).
 *
 * It wraps the page rather than living inside it so the page renders once, with the restored
 * URL, instead of fetching with the defaults first and then again.
 *
 * Restoring is decided once, on arrival. Deciding on every render would bring cleared filters
 * straight back, because clearing them changes the URL before the cleared state is saved.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { restoreParams, saveParams, type RememberedParams } from '../preferences.js';

export function RememberParams({ spec, children }: { spec: RememberedParams; children: ReactNode }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const [pending, setPending] = useState(() => restoreParams(spec, params));
  const current = params.toString();

  useEffect(() => {
    if (pending === null) saveParams(spec, params);
    // The latch is released once, after the redirect it caused has landed — which is not
    // something render can know, so this one is an effect on purpose.
    // oxlint-disable-next-line react/set-state-in-effect
    else if (current === pending) setPending(null);
  }, [spec, params, current, pending]);

  if (pending !== null && current !== pending) {
    return <Navigate replace to={{ pathname: location.pathname, search: `?${pending}`, hash: location.hash }} state={location.state} />;
  }
  return children;
}
